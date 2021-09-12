import { AlgoExecutor } from "./AlgoExecutor"
import { BIG_ZERO, Side } from "./Constants"
import { Log } from "./Log"
import Big from "big.js"
import { Amm } from "../types/ethers"
import { TradeRecord } from "./order/Order"

export enum AlgoType {
    TWAP
}

export enum AlgoStatus {
    INITIALIZED,
    IN_PROGRESS,
    COMPLETED,
}

export abstract class Algo {
    private readonly log = Log.getLogger(Algo.name)

    protected lastTradeTime: number = 0 // initialize the lastTradeTime, epoch

    private _quantity: Big // the total quantity (either contract or total notional) needs to work on by Algo.
    protected readonly direction: Side
    protected remaingQuantity: Big
    protected status: AlgoStatus = AlgoStatus.INITIALIZED

    protected constructor(readonly algoExecutor: AlgoExecutor, readonly amm: Amm, readonly pair: string, quantity: Big, direction: Side) {
        this._quantity = quantity
        this.remaingQuantity = quantity
        this.direction = direction
        this.status = AlgoStatus.IN_PROGRESS
    }

    // TODO: below should be from algoExecutor.sendChildOrder or sth similar like that
    // TODO: maybe execute needs some arguments, at least it needs gas, leverage, childOrder object (TradeRecord)
    // TODO: the specific Algo's execute() function should be the one determining slippage
    // execute() accepts a pre-created childOrder TradeRecord, which will populate the rest of the fields in sendChildOrder()
    async execute(childOrder: TradeRecord): Promise<AlgoStatus> {
        this.remaingQuantity = this.remaingQuantity.sub(this.tradeQuantity())
        this.lastTradeTime = Date.now()
        // TODO: How should the service call the sendChildOrder
        //  quoteAssetAmount is in ABSOLUTE NOTIONAL, not size nor # of contracts
        //this.algoExecutor.sendChildOrder(this.amm, this.pair, safeGasPrice: BigNumber, quoteAssetAmount: Big, baseAssetAmountLimit: Big, leverage: Big, this.direction, childOrder)
        return this.status
    }

    protected get quantity(): Big {
        return this._quantity
    }

    // returns true if we should trade (send a child order) this loop cycle
    abstract checkTradeCondition(): boolean

    abstract tradeQuantity(): Big

    public buildTradeRecord(): TradeRecord {
        // TODO: implement this function
        return new TradeRecord({
            tradeId: "TEST",
            side: this.direction,
            notional: this.tradeQuantity(),
            timestamp: Date.now(),
        })
    }
}

export class Twap extends Algo {
    private readonly twapLog = Log.getLogger(Twap.name)

    private time: number
    private interval: number // time interval between each trade (in seconds)
    private quantityPerTrade: Big
    private startOfAlgo: number
    private timeElapse: number = 0

    // todo
    //    implement the algoSettings class/interface
    constructor(algoExecutor: AlgoExecutor, readonly amm: Amm, readonly pair: string, quantity: Big, direction: Side, algoSettings: any) {
        super(algoExecutor, amm, pair, quantity, direction)

        this.time = algoSettings.TIME
        this.interval = algoSettings.INTERVAL

        this.quantityPerTrade = this.quantity.div(Big(this.time / this.interval))
        this.startOfAlgo = Date.now()
    }

    checkTradeCondition(): boolean {
        let sinceLastTradeTimeInSeconds = (Date.now() - this.lastTradeTime) / 1000
        this.timeElapse = (Date.now() - this.startOfAlgo) / 1000
        if (this.timeElapse > this.time) {
            this.status = AlgoStatus.COMPLETED
            this.twapLog.warn(`total time elpsae ${this.timeElapse}s since start of alog is past the config algo time ${this.time}s`)
            return false
        }

        if (this.remaingQuantity.lte(BIG_ZERO)) {
            this.twapLog.info("all quantity has been executed")
            this.status = AlgoStatus.COMPLETED
            return false
        }

        if (sinceLastTradeTimeInSeconds < this.interval) {
            return false
        }

        // upon return true, algo should do several things:
        // 1. send the order; 2. update the emaining quantity 3. update the last trade time

        return true
    }

    tradeQuantity(): Big {
        return this.remaingQuantity.lt(this.quantityPerTrade) ? this.remaingQuantity : this.quantityPerTrade
    }
}
