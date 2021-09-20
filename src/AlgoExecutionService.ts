import "./init"
import * as AmmUtils from "./amm/AmmUtils"
import * as PerpUtils from "./eth/perp/PerpUtils"
import * as fs from "fs"
import { pollFrequency, configPath, slowPollFrequency, preflightCheck, tcp, userInputTopic, statusTopic, statusPort, userInputPort, initialTimeOut } from "./configs"
import { AlgoExecutor } from "./algo/AlgoExecutor"
import { AlgoFactory, AlgoType } from "./algo/AlgoFactory"
import { AmmConfig, BigKeys, BigTopLevelKeys } from "./amm/AmmConfigs"
import { BIG_10, BIG_ZERO, Side } from "./Constants"
import { Amm } from "../types/ethers"
import { BigNumber } from "@ethersproject/bignumber"
import { ERC20Service } from "./eth/ERC20Service"
import { EthMetadata, SystemMetadataFactory } from "./eth/SystemMetadataFactory"
import { EthService, EthServiceReadOnly } from "./eth/EthService"
import { EventEmitter } from "events"
import { GasService, NonceService } from "./amm/AmmUtils"
import { Log } from "./Log"
import { MaxUint256 } from "@ethersproject/constants"
import { OrderManager } from "./order/OrderManager"
import { PerpService } from "./eth/perp/PerpService"
import { PerpPositionService } from "./eth/perp/PerpPositionService"
import { ServerProfile } from "./eth/ServerProfile"
import { Service } from "typedi"
import { Socket, socket } from "zeromq"
import { Wallet } from "ethers"
import Big from "big.js"
import { Order, OrderStatus } from "./order/Order"
import { orderBy } from "lodash"

export class AmmProperties {
    readonly pair: string
    readonly quoteAsset: string
    price: Big
    baseAssetReserve: Big
    quoteAssetReserve: Big

    constructor(pair: string, quoteAsset: string, price: Big, baseAssetReserve: Big, quoteAssetReserve: Big) {
        this.pair = pair
        this.quoteAsset = quoteAsset
        this.price = price
        this.baseAssetReserve = baseAssetReserve
        this.quoteAssetReserve = quoteAssetReserve
    }
}

@Service()
export class AlgoExecutionService {
    protected readonly log = Log.getLogger(AlgoExecutionService.name)
    protected readonly wallet: Wallet
    protected readonly ethService: EthService
    protected readonly ethServiceReadOnly: EthServiceReadOnly
    protected readonly perpService: PerpService
    protected readonly perpServiceReadOnly: PerpService
    protected readonly erc20Service: ERC20Service
    protected readonly nonceService: NonceService
    protected readonly gasService: GasService
    protected readonly positionService: PerpPositionService
    protected readonly algoExecutor: AlgoExecutor

    protected readonly serverProfile: ServerProfile = new ServerProfile()
    protected readonly systemMetadataFactory: SystemMetadataFactory

    protected systemMetadata!: EthMetadata
    protected openAmms!: Amm[]
    protected initialized = false
    protected lastPrecheck = false
    protected pubSocket: Socket
    protected subSocket: Socket
    protected eventEmitter: EventEmitter
    protected amms = new Map<string, AmmProperties>() // key = AMM Contract Address
    protected pairs = new Map<string, string>() // key = pair -> address
    protected orderManagers = new Map<string, OrderManager>() // key = AMM Contract Address
    protected configs = new Map<string, AmmConfig>() // key = AMM Pair Name

    constructor() {
        this.systemMetadataFactory = new SystemMetadataFactory(this.serverProfile)

        this.ethService = new EthService(this.serverProfile)
        this.wallet = this.ethService.privateKeyToWallet(this.serverProfile.walletPrivateKey)
        this.perpService = new PerpService(this.ethService, this.systemMetadataFactory)

        this.ethServiceReadOnly = new EthServiceReadOnly(this.serverProfile)
        this.perpServiceReadOnly = new PerpService(this.ethServiceReadOnly, this.systemMetadataFactory)

        this.erc20Service = new ERC20Service(this.ethService, this.ethServiceReadOnly)

        this.gasService = new GasService(this.ethServiceReadOnly)
        this.nonceService = NonceService.getInstance(this.wallet)

        this.positionService = new PerpPositionService(this.wallet.address, this.perpService)
        this.algoExecutor = new AlgoExecutor(this.wallet, this.perpService, this.gasService)

        this.eventEmitter = new EventEmitter()

        fs.watchFile(configPath, (curr, prev) => this.configChanged(curr, prev))
    }

    async initialize(): Promise<void> {
        if (!this.initialized) {
            this.pubSocket = socket("pub")
            this.pubSocket.bind(`tcp://${tcp}:${statusPort}`)
            this.log.jinfo({ event: `status publisher bound to port ${statusPort}` })

            this.systemMetadata = await this.systemMetadataFactory.fetch()
            this.openAmms = await this.perpServiceReadOnly.getAllOpenAmms()
            this.log.jinfo({ event: "NonceService:Sync", nonce: await this.nonceService.sync() })
            this.log.jinfo({ event: "GasService:Sync", safeGas: (await this.gasService.sync()).toString() })
            this.loadConfigs()

            for (let amm of this.openAmms) {
                const ammState = await this.perpServiceReadOnly.getAmmStates(amm.address)
                const pair = AmmUtils.getAmmPair(ammState)
                const quoteAssetAddress = await amm.quoteAsset()
                this.pairs.set(pair, amm.address)
                if (!this.configs.has(pair)) {
                    this.configs.set(pair, new AmmConfig({}))
                }

                let ammProps = new AmmProperties(pair, quoteAssetAddress, AmmUtils.getAmmPrice(ammState), ammState.baseAssetReserve, ammState.quoteAssetReserve)
                this.amms.set(amm.address, ammProps)
                this.orderManagers.set(amm.address, new OrderManager(this.algoExecutor, pair))

                await this.approveAllowances(pair, quoteAssetAddress)
            }

            // need to use the non-readonly node for subscriptions, in case the RO node dies
            let amms = await this.perpService.getAllOpenAmms()
            amms.forEach((amm: Amm) => this.subscribeAmmReserves(amm))

            this.lastPrecheck = (await this.prechecks()).valueOf()
            this.initialized = true
        }
        return
    }

    async subscribeInput(): Promise<void> {
        this.subSocket = socket("sub")
        this.subSocket.connect(`tcp://${tcp}:${userInputPort}`)
        this.subSocket.subscribe(userInputTopic)
        this.log.jinfo({ event: `service subscriber connect to port ${userInputPort} on topic:${userInputTopic}` })
        this.subSocket.on("message", (topic, message) => {
            this.interpret(message.toString().trim())
        })
        this.pubSocket.send([statusTopic, "Algo Execution Service: ready for user input", true])
    }

    private interpret(msg: string) {
        if (msg.toLowerCase() == "all orders") {
            this.retriveOrders()
        } else if (msg.toLowerCase() == "completed orders") {
            this.retriveOrders(OrderStatus.COMPLETED)
        } else if (msg.toLowerCase() == "in progress orders") {
            this.retriveOrders(OrderStatus.IN_PROGRESS)
        } else if (msg.toLowerCase() == "cancelled orders") {
            this.retriveOrders(OrderStatus.CANCELED)
        } else if (msg.startsWith("cancel ")) {
            const cancelId = msg.split(" ")
            for (let i = 1; i < cancelId.length; i++) {
                this.cancelOrder(cancelId[i].trim())
            }
        } else {
            this.handleInput(msg)
        }
    }

    private cancelOrder(cancelId: string) {
        try {
            const pair = cancelId.split(".")[0]
            const manager = this.orderManagers.get(this.pairs.get(pair))
            const cancelStatus = manager.cancelOrder(cancelId)
            if (cancelStatus) {
                this.pubSocket.send([statusTopic, `order ${cancelId} is canceled successfully.`, true])
            } else {
                this.pubSocket.send([statusTopic, `order ${cancelId} could not be canceled.`, true])
            }
        } catch (e) {
            this.pubSocket.send([statusTopic, `order "${cancelId}"" could not be found. Use command "all orders" for reference`, true])
        }
    }

    private retriveOrders(status?: OrderStatus) {
        let orderString = "order info:"
        this.orderManagers.forEach((manager) => {
            const orders = manager.retriveOrders(status)
            orders.forEach((o) => {
                orderString = orderString + "\n" + o.toString()
            })
        })
        this.pubSocket.send([statusTopic, orderString, true])
    }

    protected loadConfigs() {
        try {
            let localConfigs = new Map<string, AmmConfig>()
            const configs = fs.readFileSync(configPath, "utf8")
            const data = JSON.parse(configs, (key, value) => {
                if (BigKeys.includes(key) || BigTopLevelKeys.includes(key)) {
                    return Big(value)
                }
                return value
            })

            this.log.jinfo({
                event: "LoadConfigs:OUTPUT",
                params: { data },
            })
            // if not found in the config, then set it back to the old value
            for (const key in data.ammConfigMap) {
                const config = new AmmConfig(data.ammConfigMap[key])
                localConfigs.set(key, config)
            }

            // only update the real configs if parsing succeeded
            this.configs = localConfigs
        } catch (e) {
            this.log.jerror({
                event: "LoadConfigs:FAILED",
                params: {
                    result: "CONFIGS NOT LOADED",
                    reason: e.toString(),
                    stackTrace: e.stack,
                },
            })
            throw e
        }
    }

    async approveAllowances(pair: string, quoteAssetAddress: string): Promise<void> {
        // Make sure the quote asset are approved, but only once!
        const clearingHouseAddr = this.systemMetadata.clearingHouseAddr
        const allowance = await this.erc20Service.allowance(quoteAssetAddress, this.wallet.address, clearingHouseAddr)
        const infiniteAllowance = await this.erc20Service.fromScaled(quoteAssetAddress, MaxUint256)
        const allowanceThreshold = infiniteAllowance.div(2)
        if (allowance.lt(allowanceThreshold)) {
            await this.erc20Service.approve(quoteAssetAddress, clearingHouseAddr, infiniteAllowance, this.wallet, {
                gasPrice: this.gasService.get(),
            })
            this.log.jinfo({
                event: "SetMaxAllowance",
                params: {
                    pair: pair,
                    quoteAssetAddress: quoteAssetAddress,
                    owner: this.wallet.address,
                    agent: clearingHouseAddr,
                },
            })
        }
        return
    }

    /******************************************
     **
     **  Public top-level script functions,
     **  All require initialize() call
     **
     ******************************************/

    async startInterval(): Promise<void> {
        try {
            await AmmUtils.createTimeout(() => this.initialize(), initialTimeOut * 60 * 1000, "AlgoExecutionService:initialize:TIMEOUT:120s")
        } catch (e) {
            this.log.error(e)
            process.exit(1)
        }
        await this.subscribeInput()
        await this.subscribe()
        await this.printPositions()
        await this.checkOrders()
        await this.startHeartBeat()
        await Promise.all([this.startPrechecks(), this.startExecution(), this.startSlowPolls()])
    }

    private async startHeartBeat(): Promise<void> {
        setInterval(async () => this.pubSocket.send([statusTopic, "", true]), 1000 * pollFrequency)
    }

    private async startExecution(): Promise<void> {
        setInterval(async () => await this.checkOrders(), 1000 * pollFrequency)
    }

    protected async startPrechecks(): Promise<void> {
        setInterval(async () => (this.lastPrecheck = (await this.prechecks()).valueOf()), 1000 * pollFrequency)
    }

    protected async startSlowPolls(): Promise<void> {
        setInterval(async () => {
            await this.printPositions()
            await this.syncNonce()
            await this.ethServiceReadOnly.checkBlockFreshness(preflightCheck.BLOCK_TIMESTAMP_FRESHNESS_THRESHOLD)
            this.log.jinfo({ listeners: this.eventEmitter.listenerCount("PositionChanged") })
        }, 1000 * slowPollFrequency) // slower than others
    }

    /******************************************
     **
     **  End public top-level script functions
     **
     ******************************************/

    protected configChanged(curr: fs.Stats, prev: fs.Stats): void {
        try {
            this.log.jinfo({ event: "ConfigChanged", params: { curr } })
            this.loadConfigs()
        } catch (e) {
            this.log.jerror({
                event: "ConfigChanged:FAILED",
                params: {
                    result: "NEW CONFIGS NOT LOADED",
                    reason: e.toString(),
                    stackTrace: e.stack,
                },
            })
        }
    }

    // TO-DO: better error handling, refined user entry
    protected handleInput(input: string): void {
        this.log.jinfo({ input })
        try {
            const tokens = input.split(" ")
            const algoType = AlgoType[tokens[0]]
            const pair = tokens[1]
            const side = Side[tokens[2]] // "BUY" or "SELL"
            const quantity = Big(tokens[3])
            if (quantity.lt(BIG_10)) {
                throw Error("Notional cannot be less than 10 USDC")
            }

            const settings = tokens.slice(4)
            const algoSettings = AlgoFactory.createSettings(algoType, settings)

            const ammAddress = this.pairs.get(pair)
            const ammConfig = this.configs.get(pair)
            const algo = AlgoFactory.createAlgo(this.algoExecutor, this.eventEmitter, ammAddress, pair, side, quantity, ammConfig, algoSettings, algoType)

            const orderManager = this.orderManagers.get(ammAddress)
            const order = orderManager.createOrder(side, quantity, algo)
            this.pubSocket.send([statusTopic, `Created order for input: [${input}], id: ${order.id}`, true])
        } catch (e) {
            this.log.jerror({
                Reason: "Bad Input",
                Error: e,
            })
            this.pubSocket.send([statusTopic, `Algo Execution Service: Bad Input: [${input}]`, true])
        }
    }

    private async subscribe(): Promise<void> {
        const contract = await this.perpService.createClearingHouse()
        this.log.jinfo({ event: "Contract", params: { address: contract.address } })

        try {
            contract.on("PositionChanged", (trader, ammAddress, margin, positionNotional, exchangedPositionSize, fee, positionSizeAfter, realizedPnl, unrealizedPnlAfter, badDebt, liquidationPenalty, spotPrice, fundingPayment) => {
                this.handlePositionChange(trader, ammAddress, margin, positionNotional, exchangedPositionSize, fee, positionSizeAfter, realizedPnl, unrealizedPnlAfter, badDebt, liquidationPenalty, spotPrice, fundingPayment)
                this.eventEmitter.emit("PositionChanged", trader, ammAddress, margin, positionNotional, exchangedPositionSize, fee, positionSizeAfter, realizedPnl, unrealizedPnlAfter, badDebt, liquidationPenalty, spotPrice, fundingPayment)
            })
        } catch (e) {
            this.log.jerror({
                event: "ListenPositionChanged:FAILED",
                params: {
                    reason: e.toString(),
                    stackTrace: e.stack,
                },
            })
        }
    }

    private async handlePositionChange(
        trader: string,
        ammAddress: string,
        margin: BigNumber,
        positionNotional: BigNumber,
        exchangedPositionSize: BigNumber,
        fee: BigNumber,
        positionSizeAfter: BigNumber,
        realizedPnl: BigNumber,
        unrealizedPnlAfter: BigNumber,
        badDebt: BigNumber,
        liquidationPenalty: BigNumber,
        spotPrice: BigNumber,
        fundingPayment: BigNumber
    ): Promise<void> {
        // spotPrice is the currentPrice up to at least 6 dps
        let newSpotPrice = PerpUtils.fromWei(spotPrice)

        // only print relevant PositionChanged events
        if (this.amms.has(ammAddress)) {
            let ammProps = this.amms.get(ammAddress)!
            this.log.jinfo({
                event: "PositionChanged",
                params: {
                    ammPair: ammProps.pair,
                    spotPrice: newSpotPrice, // current price
                    trader: trader,
                    amm: ammAddress,
                    margin: PerpUtils.fromWei(margin),
                    positionNotional: PerpUtils.fromWei(positionNotional), // in USDC, absolute value
                    exchangedPositionSize: PerpUtils.fromWei(exchangedPositionSize), // traded #contracts (signed), buy or sell obvious
                    fee: PerpUtils.fromWei(fee), // 10bps fee
                    positionSizeAfter: PerpUtils.fromWei(positionSizeAfter), // new position size, in #contracts (signed);
                    //    if 0: closed position; if equal exchangedPositionSize: opened position
                    price: newSpotPrice,
                },
            })
        }
    }

    private async subscribeAmmReserves(amm: Amm): Promise<void> {
        try {
            amm.on("ReserveSnapshotted", (quoteAssetReserve, baseAssetReserve, timestamp) => {
                this.handleReserveSnapshot(amm, quoteAssetReserve, baseAssetReserve, timestamp)
                this.eventEmitter.emit("ReserveSnapshotted", amm, quoteAssetReserve, baseAssetReserve, timestamp)
            })
        } catch (e) {
            this.log.jerror({
                event: "ListenReserveSnapshotted:FAILED",
                params: {
                    reason: e.toString(),
                    stackTrace: e.stack,
                },
            })
        }
    }

    private async handleReserveSnapshot(amm: Amm, quoteAssetReserve: BigNumber, baseAssetReserve: BigNumber, timestamp: BigNumber) {
        if (this.amms.has(amm.address)) {
            const newQuoteAssetReserve = PerpUtils.fromWei(quoteAssetReserve)
            const newBaseAssetReserve = PerpUtils.fromWei(baseAssetReserve)
            const ammPrice = newQuoteAssetReserve.div(newBaseAssetReserve)

            let ammProps = this.amms.get(amm.address)!
            this.log.jinfo({
                event: "ReserveSnapshotted",
                params: {
                    ammPair: ammProps.pair,
                    ammPrice: +ammPrice.round(5),
                    amm: amm.address,
                    quoteAssetReserve: newQuoteAssetReserve,
                    baseAssetReserve: newBaseAssetReserve,
                    timestamp: Big(timestamp.toString()),
                },
            })
            ammProps.quoteAssetReserve = newQuoteAssetReserve
            ammProps.baseAssetReserve = newBaseAssetReserve
            ammProps.price = ammPrice
        }
    }

    protected async prechecks(): Promise<Boolean> {
        let ok = true
        // Check xDai balance - needed for gas payments
        const xDaiBalance = await this.ethServiceReadOnly.getBalance(this.wallet.address)
        this.log.jinfo({
            event: "xDaiBalance",
            params: { balance: xDaiBalance.toFixed(4) },
        })
        if (xDaiBalance.lt(preflightCheck.XDAI_BALANCE_THRESHOLD)) {
            this.log.jwarn({
                event: "xDaiNotEnough",
                params: { balance: xDaiBalance.toFixed(4) },
            })
            ok = false
        }
        return ok
    }

    async processAmmCall(eventName: string, callback: (a: Amm) => Promise<any>): Promise<void> {
        await Promise.all(
            this.openAmms.map(async (amm: Amm) => {
                try {
                    callback(amm)
                } catch (e) {
                    this.log.jerror({
                        event: `${eventName}:FAILED`,
                        params: {
                            reason: e.toString(),
                            stackTrace: e.stack,
                        },
                    })
                    return
                }
            })
        )
    }

    private async checkOrders(): Promise<void> {
        // ask the order manager to check orders?
        await this.processAmmCall("OrderManager:CheckOrders", async (a: Amm) => {
            if (this.amms.has(a.address) && this.orderManagers.has(a.address)) {
                const o = this.orderManagers.get(a.address)
                o.checkOrders(this.amms.get(a.address))
            }
        })
        const safeGas = await this.gasService.sync()
        this.log.jinfo({ event: "SafeGas", params: safeGas.toString() })
    }

    private async syncNonce(): Promise<void> {
        // attempt to sync the nonce only if we're currently not in the middle of a trade
        if (!this.algoExecutor.awaitingTrade) {
            this.log.jinfo({ event: "NonceService:Sync", nonce: await this.nonceService.sync() })
        }
    }

    protected async printPositions(): Promise<void> {
        await this.processAmmCall("PrintPositions", async (a: Amm) => {
            if (this.amms.has(a.address)) {
                const v = this.amms.get(a.address)
                this.positionService.printPosition(a.address, v.pair)
            }
        })
        await this.calculateTotalValue()
    }

    private async calculateTotalValue(): Promise<void> {
        let totalPositionValue = BIG_ZERO
        for (let amm of this.openAmms) {
            if (this.amms.has(amm.address)) {
                if (totalPositionValue.eq(BIG_ZERO)) {
                    const quoteBalance = await this.erc20Service.balanceOf(this.amms.get(amm.address)!.quoteAsset, this.wallet.address)
                    totalPositionValue = totalPositionValue.add(quoteBalance)
                }
                const [position, unrealizedPnl] = await this.positionService.getPerpPositonWithUnrealizedPnl(amm.address)
                totalPositionValue = totalPositionValue.add(position.margin).add(unrealizedPnl)
            }
        }
        const perpFiValue = totalPositionValue

        // add xDai balance
        const xDaiBalance = await this.ethServiceReadOnly.getBalance(this.wallet.address)
        totalPositionValue = totalPositionValue.add(xDaiBalance)

        this.log.jinfo({
            event: "TotalAccountValue",
            params: {
                totalValue: +totalPositionValue.toFixed(2),
                xDai: +xDaiBalance.toFixed(2),
                perpFi: +perpFiValue.toFixed(2),
            },
        })
    }
}
