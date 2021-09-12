import { AlgoExecutionService } from "./AlgoExecutionService"
import "./init"
import { BIG_ZERO, Side } from "./Constants"
import { Log } from "./Log"
import Big from "big.js"
import { Amm } from "../types/ethers"
import { TradeRecord } from "./order/Order"
import { STATUS_CODES } from "http"

export enum AlgoStatus {
    INITIALIZED,
    IN_PROGRESS,
    COMPLETED,
}

export abstract class Algo {
    private readonly log = Log.getLogger(Algo.name)

    protected lastTradeTime: number = 0 // initialize the lastTradeTime, epoch

    private executionService: AlgoExecutionService
    private amm: Amm
    protected _quantity: Big // the total quantity (either contract or total notional) needs to work on by Algo.
    protected direction: Side
    protected remaingQuantity: Big
    protected status: AlgoStatus = AlgoStatus.INITIALIZED

    constructor(executionService: AlgoExecutionService, amm: Amm, quantity: Big, direction: Side) {
        this.executionService = executionService
        this.amm = amm
        this.quantity = quantity
        this.remaingQuantity = quantity
        this.direction = direction
        this.status = AlgoStatus.IN_PROGRESS
    }

    // TODO: below should be from executionService.sendChildOrder or sth similar like that
    async execute(): Promise<AlgoStatus> {
        this.remaingQuantity = this.remaingQuantity.add(this.tradeQuantity())
        this.lastTradeTime = Date.now()

        // TODO: How should the service call the sendChildOrder
        // this.executionService.sendChildOrder(amm: Amm, pair: string, safeGasPrice: BigNumber, quoteAssetAmount: Big, baseAssetAmountLimit: Big, leverage: Big, side: Side, details: TradeRecord)
        return this.status
    }

    public set quantity(value: Big) {
        this._quantity = value
        this.remaingQuantity = value
    }

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
    constructor(executionService: AlgoExecutionService, amm: Amm, quantity: Big, direction: Side, algoSettings: any) {
        super(executionService, amm, quantity, direction)

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

        if (this.remaingQuantity.cmp(BIG_ZERO) <= 0) {
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
        return this.remaingQuantity < this.quantityPerTrade ? this.remaingQuantity : this.quantityPerTrade
    }
}
