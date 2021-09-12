import "./init"
import * as AmmUtils from "./amm/AmmUtils"
import * as PerpUtils from "./eth/perp/PerpUtils"
import * as fs from "fs"
import { pollFrequency, configPath, slowPollFrequency, statsPath } from "./configs"
import { AmmConfig, BigKeys, BigTopLevelKeys } from "./amm/AmmConfigs"
import { StatsKeys } from "./amm/AmmStats"
import { BIG_ZERO, Side } from "./Constants"
import { Amm } from "../types/ethers"
import { BigNumber } from "@ethersproject/bignumber"
import { ERC20Service } from "./eth/ERC20Service"
import { EthMetadata, SystemMetadataFactory } from "./eth/SystemMetadataFactory"
import { EthService, EthServiceReadOnly } from "./eth/EthService"
import { GasService, NonceService } from "./amm/AmmUtils"
import { Log } from "./Log"
import { OrderManager } from "./order/OrderManager"
import { PerpService } from "./eth/perp/PerpService"
import { PerpPositionService } from "./eth/perp/PerpPositionService"
import { preflightCheck } from "./configs"
import { ServerProfile } from "./eth/ServerProfile"
import { Service } from "typedi"
import { Wallet } from "ethers"
import Big from "big.js"
import { TradeRecord } from "./order/Order"

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
    protected readonly walletReadOnly: Wallet
    protected readonly ethService: EthService
    protected readonly ethServiceReadOnly: EthServiceReadOnly
    protected readonly perpService: PerpService
    protected readonly perpServiceReadOnly: PerpService
    protected readonly erc20Service: ERC20Service
    protected readonly nonceService: NonceService
    protected readonly gasService: GasService
    protected readonly positionService: PerpPositionService

    protected readonly serverProfile: ServerProfile = new ServerProfile()
    protected readonly systemMetadataFactory: SystemMetadataFactory

    protected systemMetadata!: EthMetadata
    protected openAmms!: Amm[]
    protected initialized = false
    protected lastPrecheck = false
    protected amms = new Map<string, AmmProperties>() // key = AMM Contract Address
    protected orderManagers = new Map<string, OrderManager>() // key = AMM Contract Address
    protected configs = new Map<string, AmmConfig>() // key = AMM Pair Name

    constructor() {
        this.systemMetadataFactory = new SystemMetadataFactory(this.serverProfile)

        this.ethService = new EthService(this.serverProfile)
        this.wallet = this.ethService.privateKeyToWallet(this.serverProfile.walletPrivateKey)
        this.perpService = new PerpService(this.ethService, this.systemMetadataFactory)

        this.ethServiceReadOnly = new EthServiceReadOnly(this.serverProfile)
        this.walletReadOnly = this.ethServiceReadOnly.privateKeyToWallet(this.serverProfile.walletPrivateKey)
        this.perpServiceReadOnly = new PerpService(this.ethServiceReadOnly, this.systemMetadataFactory)

        this.erc20Service = new ERC20Service(this.ethService, this.ethServiceReadOnly)

        this.gasService = new GasService(this.ethServiceReadOnly)
        this.nonceService = NonceService.getInstance(this.walletReadOnly)

        fs.watchFile(configPath, (curr, prev) => this.configChanged(curr, prev))
    }

    async initialize(): Promise<void> {
        if (!this.initialized) {
            this.systemMetadata = await this.systemMetadataFactory.fetch()
            this.openAmms = await this.perpServiceReadOnly.getAllOpenAmms()
            await this.gasService.sync()
            await this.nonceService.sync()
            this.loadConfigs()
            const preloadStats = this.loadStats()

            for (let amm of this.openAmms) {
                const ammState = await this.perpServiceReadOnly.getAmmStates(amm.address)
                const pair = AmmUtils.getAmmPair(ammState)
                const quoteAssetAddress = await amm.quoteAsset()
                const ammConfig = this.configs.get(pair)

                if (ammConfig) {
                    const stats = preloadStats.get(pair)

                    let ammProps = new AmmProperties(pair, quoteAssetAddress, AmmUtils.getAmmPrice(ammState), ammState.baseAssetReserve, ammState.quoteAssetReserve)
                    this.amms.set(amm.address, ammProps)
                    this.orderManagers.set(amm.address, new OrderManager(this.wallet, amm, pair, this.perpService, this.gasService))
                }
            }

            // need to use the non-readonly node for subscriptions, in case the RO node dies
            let amms = await this.perpService.getAllOpenAmms()
            amms.forEach((amm: Amm) => this.subscribeAmmReserves(amm))

            this.lastPrecheck = (await this.prechecks()).valueOf()
            this.initialized = true
        }
        return
    }

    protected loadStats(): Map<string, Map<string, Array<Big>>> {
        try {
            // check if the stats file exists and is less than X minutes old
            let localStats = new Map<string, Map<string, Array<Big>>>()
            if (fs.existsSync(statsPath)) {
                const stats = fs.readFileSync(statsPath, "utf8")
                const data = JSON.parse(stats, (key, value) => {
                    if (key == "lastUpdated") {
                        return new Date(value)
                    } else if (StatsKeys.includes(key)) {
                        return (value as Array<string>).map((item) => Big(item))
                    }
                    return value
                })
                // no lastUpdated or more than 10 mins old, return empty
                if (!data.lastUpdated || Date.now() - data.lastUpdated > 1000 * 60 * 10) {
                    return localStats
                }

                for (const key in data) {
                    const pairStats = new Map<string, Array<Big>>()
                    StatsKeys.forEach((priceType) => pairStats.set(priceType, data[key][priceType]))
                    localStats.set(key, pairStats)
                }
                this.log.jinfo({
                    event: "LoadStats:Done",
                    params: { lastUpdated: data.lastUpdated },
                })
            }
            return localStats
        } catch (e) {
            this.log.jerror({
                event: "LoadStats:FAILED",
                params: {
                    result: "STATS NOT LOADED",
                    reason: e.toString(),
                    stackTrace: e.stack,
                },
            })
            return new Map<string, Map<string, Array<Big>>>()
        }
    }

    protected saveStats() {
        const record: Record<string, any> = { lastUpdated: Date.now() }
        this.amms.forEach((value: AmmProperties, key: string) => {
            //record[value.pair] = value.saveStats()?
        })
        this.log.jinfo({
            event: "SaveStats:OUTPUT",
            params: { lastUpdated: record.lastUpdated },
        })
        fs.writeFileSync(statsPath, JSON.stringify(record), "utf8")
    }

    protected loadConfigs() {
        // we do not want this to succeed in replacing ANY configs if there's even one problem
        try {
            let baseGasMultiplier = this.gasService.baseMultiplier

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
            baseGasMultiplier = data.baseGasMultiplier ?? baseGasMultiplier

            // only update the real configs if parsing succeeded
            this.gasService.baseMultiplier = baseGasMultiplier
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

    /******************************************
     **
     **  Public top-level script functions,
     **  All require initialize() call
     **
     ******************************************/

    async start(): Promise<void> {
        await this.initialize()
        await this.checkOrders()
    }

    async startInterval(): Promise<void> {
        try {
            await AmmUtils.createTimeout(() => this.initialize(), 90000, "AlgoExecutionService:initialize:TIMEOUT:90s")
        } catch (e) {
            this.log.error(e)
            process.exit(1)
        }
        await this.subscribe()
        await this.printPositions()
        await this.checkOrders()
        await Promise.all([this.startPrechecks(), this.startExecution(), this.startSlowPolls()])
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
            this.saveStats()
        }, 1000 * slowPollFrequency) // slower than others
    }

    async listen(): Promise<void> {
        await this.initialize()
        await this.subscribe()
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
            this.amms.forEach((value: AmmProperties, key: string) => {
                // do something with new configs
            })
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

    protected async subscribe(): Promise<void> {
        const contract = await this.perpService.createClearingHouse()
        this.log.jinfo({ event: "Contract", params: { address: contract.address } })

        try {
            contract.on("PositionChanged", (trader, ammAddress, margin, positionNotional, exchangedPositionSize, fee, positionSizeAfter, realizedPnl, unrealizedPnlAfter, badDebt, liquidationPenalty, spotPrice, fundingPayment) => {
                // can't have any awaits inside this event listener function to be logged
                // can only call one async function as an event handler to do something
                this.handlePositionChange(trader, ammAddress, margin, positionNotional, exchangedPositionSize, fee, positionSizeAfter, realizedPnl, unrealizedPnlAfter, badDebt, liquidationPenalty, spotPrice, fundingPayment)
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
                    price: ammProps.price,
                },
            })
        }
    }

    private async subscribeAmmReserves(amm: Amm): Promise<void> {
        try {
            amm.on("ReserveSnapshotted", (quoteAssetReserve, baseAssetReserve, timestamp) => {
                this.handleReserveSnapshot(amm, quoteAssetReserve, baseAssetReserve, timestamp)
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
    }

    private async syncNonce(): Promise<void> {
        // attempt to sync the nonce only if we're currently not in the middle of a trade
        let awaitingTrade = false
        this.amms.forEach((value, key) => {
            // check if any orders are in flight before syncing the nonce
        })
        if (!awaitingTrade) {
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

    public async sendChildOrder(amm: Amm, pair: string, safeGasPrice: BigNumber, quoteAssetAmount: Big, baseAssetAmountLimit: Big, leverage: Big, side: Side, details: TradeRecord): Promise<PerpUtils.PositionChangedLog> {
        const nonceService = NonceService.getInstance(this.wallet)
        const amount = quoteAssetAmount.div(leverage)
        this.log.jinfo({ event: "TRADE:OpenPerpFiPosition:NonceMutex:Wait", details: details })
        const release = await nonceService.mutex.acquire()
        this.log.jinfo({ event: "TRADE:OpenPerpFiPosition:NonceMutex:Acquired", details: details })
        let tx
        try {
            if (details) {
                details.ppGasPx = Big(safeGasPrice.toString())
                details.ppBaseAssetAmountLimit = baseAssetAmountLimit
                details.ppSentTimestamp = Date.now()
            }
            // send tx to trade
            tx = await this.perpService.openPosition(this.wallet, amm.address, side, amount, leverage, baseAssetAmountLimit, {
                nonce: nonceService.get(),
                gasPrice: safeGasPrice,
            })
            nonceService.increment()
        } catch (e) {
            if (details) {
                details.ppState = "FAILED"
                details.onFail()
            }
            this.log.jerror({
                event: `${Side[side]}:TRADE:OpenPerpFiPosition:FAILED`,
                params: {
                    etype: "failed to create tx",
                    ammPair: pair,
                    details: details,
                },
            })
            await nonceService.unlockedSync()
            throw e
        } finally {
            release()
        }
        if (details) {
            details.ppAckTimestamp = Date.now()
            details.ppState = "TX_RCVD"
            details.ppTxHash = tx.hash
            details.ppTxGasLimit = Big(tx.gasLimit.toString())
        }

        this.log.jinfo({
            event: `${Side[side]}:TRADE:OpenPerpFiPosition`,
            params: {
                ammPair: pair,
                details: details,
                quoteAssetAmount: +quoteAssetAmount,
                baseAssetAmountLimit: +baseAssetAmountLimit,
                leverage: leverage.toFixed(),
                txHash: tx.hash,
                gasPrice: tx.gasPrice.toString(),
                nonce: tx.nonce,
            },
        })

        try {
            // const txReceipt = await AmmUtils.createTimeout<any>(tx.wait, 60000, `${enterOrExit}:TRADE:OpenPerpFiPosition:TIMEOUT:60s`)
            // const event = txReceipt.events.filter((event: any) => event.event === "PositionChanged")[0]
            // const positionChangedLog = PerpUtils.toPositionChangedLog(event.args)
            const txReceipt = await this.perpService.ethService.waitForTransaction(tx.hash, 90000, `${Side[side]}:TRADE:OpenPerpFiPosition:TxnReceipt:TIMEOUT:90s`)
            const eventArgs = await this.perpService.getEventArgs(this.wallet, tx, txReceipt, "PositionChanged")
            if (!eventArgs) {
                throw Error("transaction failed: " + JSON.stringify({ transactionHash: tx.hash, transaction: tx, receipt: txReceipt }))
            }
            const positionChangedLog = PerpUtils.argsToPositionChangedLog(eventArgs)
            if (details) {
                details.ppFillTimestamp = Date.now()
                details.ppState = "TX_CONFIRMED"
                details.ppTxGasUsed = Big(txReceipt.gasUsed.toString())
                details.ppTxStatus = txReceipt.status
                details.ppTxBlockNumber = txReceipt.blockNumber
                details.ppPositionChangedLog = positionChangedLog
                details.ppExecSize = positionChangedLog.exchangedPositionSize
                details.ppExecPx = quoteAssetAmount.div(positionChangedLog.exchangedPositionSize).abs()
                details.onSuccess()
            }
            // should update the parent order with details
            // the details will be modified in memory, hence the original details obj pass into this funciton will also be modified
            // order.update(details)

            this.log.jinfo({
                event: `${Side[side]}:TRADE:OpenPerpFiPosition:PASSED`,
                params: {
                    ammPair: pair,
                    positionChangedLog,
                    details: details,
                },
            })
            return positionChangedLog
        } catch (e) {
            if (details) {
                details.ppState = "FAILED"
                details.onFail()
            }
            this.log.jerror({
                event: `${Side[side]}:TRADE:OpenPerpFiPosition:FAILED`,
                params: {
                    ammPair: pair,
                    details: details,
                },
            })
            throw e
        }
    }
}
