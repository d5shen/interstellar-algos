import * as PerpUtils from "../eth/perp/PerpUtils"
import { Amm } from "../../types/ethers"
import { BigNumber } from "@ethersproject/bignumber"
import { BIG_ZERO, Side } from "../Constants"
import { Log } from "../Log"
import { Wallet } from "@ethersproject/wallet"
import Big from "big.js"
import { NonceService } from "../amm/AmmUtils"
import { PerpService } from "../eth/perp/PerpService"

export class Order {
    private readonly log = Log.getLogger(Order.name)
    private id: string
    private amm: Amm
    private pair: string
    private direction: Side
    private quantity: Big // should this be in notional or contracts?
    private filled: Big = BIG_ZERO
    private status: any // should be an enum PENDING, INFLIGHT, CANCELED, COMPLETED?
    private childOrders: Map<string, TradeRecord> // child order id -> TradeRecord

    constructor(readonly perpService: PerpService, amm: Amm, pair: string, direction: Side, quantity: Big) {
      this.amm = amm
      this.pair = pair
      this.direction = direction
      this.quantity = quantity
    }

    //TODO:
    //  ?
    /********************************************
     **  Trading functions
    ********************************************/
    private async sendChildOrder(wallet: Wallet, amm: Amm, pair: string, safeGasPrice: BigNumber, quoteAssetAmount: Big, baseAssetAmountLimit: Big, leverage: Big, side: Side, details: TradeRecord): Promise<PerpUtils.PositionChangedLog> {
        const nonceService = NonceService.get(wallet)
        const amount = quoteAssetAmount.div(leverage)
        this.log.jinfo({event: "TRADE:OpenPerpFiPosition:NonceMutex:Wait", details: details})
        const release = await nonceService.mutex.acquire()
        this.log.jinfo({event: "TRADE:OpenPerpFiPosition:NonceMutex:Acquired", details: details})
        let tx
        try {
            if (details) {
                details.ppGasPx = Big(safeGasPrice.toString())
                details.ppBaseAssetAmountLimit = baseAssetAmountLimit
                details.ppSentTimestamp = Date.now()
            }
            // send tx to trade
            tx = await this.perpService.openPosition(
                wallet,
                amm.address,
                side,
                amount,
                leverage,
                baseAssetAmountLimit,
                {
                    nonce: nonceService.get(),
                    gasPrice: safeGasPrice,
                },
            )
            nonceService.increment()
        } catch(e) {
            if (details) {
                details.ppState = "FAILED"
                details.onFail()
            }
            this.log.jerror({
                event: `${Side[side]}:TRADE:OpenPerpFiPosition:FAILED`,
                params: {
                    etype: "failed to create tx",
                    ammPair: pair,
                    details: details
                }
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
            const eventArgs = await this.perpService.getEventArgs(wallet, tx, txReceipt, 'PositionChanged')
            if (!eventArgs) {
              throw Error("transaction failed: " + JSON.stringify({transactionHash: tx.hash, transaction: tx, receipt: txReceipt}))
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
            // order.update(details)
            this.log.jinfo({
                event: `${Side[side]}:TRADE:OpenPerpFiPosition:PASSED`,
                params: {
                    ammPair: pair,
                    positionChangedLog,
                    details: details
                }
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
                    details: details
                }
            })
            throw e
        }
    }
}

const tradeLogger = Log.getLogger("Trade")
export class TradeRecord {
    tradeId: string | null = null
    state: string = "PENDING"
    pair: string | null = null
    side: Side | null = null
    // info at decision time
    timestamp: number | null = null
    size: Big = BIG_ZERO // quantity contracts
    notional: Big = BIG_ZERO
    price: Big | null = null
    // amm blockchain txn info
    ppState: string = "UNINIT"
    ppSentTimestamp: number | null = null // time when creating tx
    ppAckTimestamp: number | null = null // time when tx received by blockchain
    ppFillTimestamp: number | null = null // time when tx confirmed
    ppGasPx: Big = BIG_ZERO
    ppBaseAssetAmountLimit: Big | null = null
    ppExecSize: Big = BIG_ZERO
    ppExecPx: Big | null = null
    ppMaxSlip: Big = BIG_ZERO
    ppTxHash: string | null = null
    ppTxBlockNumber: number | null = null
    ppTxGasLimit: Big | null = null
    ppTxGasUsed: Big = BIG_ZERO
    ppTxStatus: number | undefined = undefined // false if txn reverted, true if successful
    ppPositionChangedLog: PerpUtils.PositionChangedLog | null = null

    constructor(obj: Partial<TradeRecord>) {
        Object.assign(this, obj)
    }

    onSuccess(): void {
        this.state = "PASSED"
        tradeLogger.info(`[${Side[this.side]}:TRADE:Final:Passed] ` + JSON.stringify(this))
    }

    onFail(): void {
        this.state = "FAILED"
        tradeLogger.info(`[${Side[this.side]}:TRADE:Final:Failed] ` + JSON.stringify(this))
    }
}
