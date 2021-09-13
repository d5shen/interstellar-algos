import "./init"
import * as AmmUtils from "./amm/AmmUtils"
import * as PerpUtils from "./eth/perp/PerpUtils"
import { Amm } from "../types/ethers"
import { GasService, NonceService } from "./amm/AmmUtils"
import { Log } from "./Log"
import { PerpService } from "./eth/perp/PerpService"
import { BIG_10, Side } from "./Constants"
import { Wallet } from "ethers"
import Big from "big.js"
import { TradeRecord } from "./order/Order"

export class AlgoExecutor {
    private readonly log = Log.getLogger(AlgoExecutor.name)

    constructor(readonly wallet: Wallet, readonly perpService: PerpService, readonly gasService: GasService) {}

    /*
     *  quoteAssetAmount - notional to trade
     *  baseAssetAmountLimit - slippage tolerance
     *  leverage - up to 10x
     *  childOrder - pre-instantiated TradeRecord
     */
    public async sendChildOrder(amm: Amm, pair: string, side: Side, quoteAssetAmount: Big, baseAssetAmountLimit: Big, leverage: Big, childOrder: TradeRecord): Promise<PerpUtils.PositionChangedLog> {
        if (BIG_10.lt(leverage)) {
            throw new Error(`leverage maximum setting allowed is 10, current setting is ${leverage}`)
        }
        const safeGasPrice = this.gasService.get()
        const nonceService = NonceService.getInstance(this.wallet)
        const amount = quoteAssetAmount.div(leverage)
        this.log.jinfo({ event: "TRADE:sendChildOrder:NonceMutex:Wait", details: childOrder })
        const release = await nonceService.mutex.acquire()
        this.log.jinfo({ event: "TRADE:sendChildOrder:NonceMutex:Acquired", details: childOrder })
        let tx: any
        try {
            childOrder.ppGasPx = Big(safeGasPrice.toString())
            childOrder.ppBaseAssetAmountLimit = baseAssetAmountLimit
            childOrder.ppSentTimestamp = Date.now()
            // send tx to trade
            tx = await this.perpService.openPosition(this.wallet, amm.address, side, amount, leverage, baseAssetAmountLimit, {
                nonce: nonceService.get(),
                gasPrice: safeGasPrice,
            })
            nonceService.increment()
        } catch (e) {
            childOrder.ppState = "FAILED"
            childOrder.onFail()
            this.log.jerror({
                event: `${Side[side]}:TRADE:sendChildOrder:FAILED`,
                params: {
                    etype: "failed to create tx",
                    ammPair: pair,
                    details: childOrder,
                },
            })
            await nonceService.unlockedSync()
            throw e
        } finally {
            release()
        }

        childOrder.ppAckTimestamp = Date.now()
        childOrder.ppState = "TX_RCVD"
        childOrder.ppTxHash = tx.hash
        childOrder.ppTxGasLimit = Big(tx.gasLimit.toString())

        this.log.jinfo({
            event: `${Side[side]}:TRADE:sendChildOrder`,
            params: {
                ammPair: pair,
                details: childOrder,
                quoteAssetAmount: +quoteAssetAmount,
                baseAssetAmountLimit: +baseAssetAmountLimit,
                leverage: leverage.toFixed(),
                txHash: tx.hash,
                gasPrice: tx.gasPrice.toString(),
                nonce: tx.nonce,
            },
        })

        try {
            const txReceipt = await AmmUtils.createTimeout<any>(tx.wait, 90000, `${Side[side]}:TRADE:OpenPerpFiPosition:TIMEOUT:90s`)
            const event = txReceipt.events.filter((event: any) => event.event === "PositionChanged")[0]
            const positionChangedLog = PerpUtils.toPositionChangedLog(event.args)

            childOrder.ppFillTimestamp = Date.now()
            childOrder.ppState = "TX_CONFIRMED"
            childOrder.ppTxGasUsed = Big(txReceipt.gasUsed.toString())
            childOrder.ppTxStatus = txReceipt.status
            childOrder.ppTxBlockNumber = txReceipt.blockNumber
            childOrder.ppPositionChangedLog = positionChangedLog
            childOrder.ppExecSize = positionChangedLog.exchangedPositionSize
            childOrder.ppExecPrice = quoteAssetAmount.div(positionChangedLog.exchangedPositionSize).abs()
            childOrder.onSuccess()

            // TODO:
            // should update the parent order with details
            // the details will be modified in memory, hence the original details obj pass into this funciton will also be modified

            this.log.jinfo({
                event: `${Side[side]}:TRADE:sendChildOrder:PASSED`,
                params: {
                    ammPair: pair,
                    positionChangedLog,
                    details: childOrder,
                },
            })
            return positionChangedLog
        } catch (e) {
            childOrder.ppState = "FAILED"
            childOrder.onFail()

            this.log.jerror({
                event: `${Side[side]}:TRADE:sendChildOrder:FAILED`,
                params: {
                    ammPair: pair,
                    details: childOrder,
                },
            })
            throw e
        }
    }
}
