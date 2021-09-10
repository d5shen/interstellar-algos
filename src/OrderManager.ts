import * as PerpUtils from "./eth/perp/PerpUtils"
import { Amm } from "../types/ethers"
import { BigNumber } from "@ethersproject/bignumber"
import { Log } from "./Log"
import { NonceService } from "./amm/AmmUtils"
import { PerpService } from "./eth/perp/PerpService"
import { Side } from "./Constants"
import { TradeRecord } from "./Order"
import { Wallet } from "ethers"
import Big from "big.js"

export class OrderManager {

    // TODO:
    //   manage orders lol
    //   watch out for block reorgs...?

    private readonly log = Log.getLogger(OrderManager.name)
    private readonly nonceService: NonceService
    private readonly perpService: PerpService
    private readonly wallet: Wallet
    
    /********************************************
     **  Trading functions
     ********************************************/

    private async openPerpFiPosition(amm: Amm, pair: string, safeGasPrice: BigNumber, quoteAssetAmount: Big, baseAssetAmountLimit: Big, leverage: Big,
                                     side: Side, details: TradeRecord): Promise<PerpUtils.PositionChangedLog> {
        const amount = quoteAssetAmount.div(leverage)
        this.log.jinfo({event: "TRADE:OpenPerpFiPosition:NonceMutex:Wait", details: details})
        const release = await this.nonceService.mutex.acquire()
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
                this.wallet,
                amm.address,
                side,
                amount,
                leverage,
                baseAssetAmountLimit,
                {
                    nonce: this.nonceService.get(),
                    gasPrice: safeGasPrice,
                },
            )
            this.nonceService.increment()
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
            await this.nonceService.unlockedSync()
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
            const eventArgs = await this.perpService.getEventArgs(this.wallet, tx, txReceipt, 'PositionChanged')
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