import * as AmmUtils from "./amm/AmmUtils"
import { AlgoExecutor } from "./AlgoExecutor"
import { BIG_100, BIG_1BP, BIG_HALF, BIG_ZERO, Side } from "./Constants"
import { Log } from "./Log"
import { Amm } from "../types/ethers"
import { TradeRecord } from "./order/Order"
import { AmmProperties } from "./AlgoExecutionService"
import Big from "big.js"
import { REFUSED } from "dns"
import { dir } from "console"

export enum AlgoType {
    TWAP,
}

export enum AlgoStatus {
    INITIALIZED,
    IN_PROGRESS,
    COMPLETED,
}

export class AlgoFactory {
    private constructor() {}
    public static createAlgo(algoExecutor: AlgoExecutor, amm: Amm, pair: string, quanity: Big, direction: Side, algoSettings: any, algoType: AlgoType): Algo {
        if (algoType == AlgoType.TWAP) {
            return new Twap(algoExecutor, amm, pair, quanity, direction, algoSettings)
        }
    }
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
    // TODO: maybe execute needs some arguments, at least it needs leverage, childOrder object (TradeRecord)
    //         - maybe Max Slippage and Leverage can be provided as constructor arguments?
    // TODO: the specific Algo's execute() function should be the one determining slippage
    // execute() accepts a pre-created childOrder TradeRecord, which will populate the rest of the fields in sendChildOrder()
    async execute(ammProps: AmmProperties, childOrder: TradeRecord): Promise<AlgoStatus> {
        this.remaingQuantity = this.remaingQuantity.sub(this.tradeQuantity())
        this.lastTradeTime = Date.now()
        childOrder.notional = this.tradeQuantity()
        // TODO: the Algo calls the sendChildOrder
        //  quoteAssetAmount is in ABSOLUTE NOTIONAL, not size nor # of contracts
        //  baseAssetAmountLimit is minimum(or maximum) number of contracts before hitting max slippage
        //  we need the current price (stored in ammProps)
        //      size = notional.div(price)
        //      if side == BUY:  baseAssetAmountLimit = size.mul(BIG_ONE.sub(this.maxSlippage())) // if buying FTT, I want to receive AT LEAST size*(1-0.005) contracts
        //      if side == SELL: baseAssetAmountLimit = size.mul(BIG_ONE.add(this.maxSlippage())) // if selling FTT, I want to give up AT MOST size*(1+0.005) contracts

        //await this.algoExecutor.sendChildOrder(this.amm, this.pair, this.direction, this.tradeQuantity(), baseAssetAmountLimit: Big, leverage: Big, childOrder)
        return this.status
    }

    protected get quantity(): Big {
        return this._quantity
    }

    // returns true if we should trade (send a child order) this loop cycle
    // accepts the current state of the Amm (price and reserves)
    abstract checkTradeCondition(ammProps: AmmProperties): boolean

    // these can be dynamic depending on the type of Algo
    abstract tradeQuantity(): Big
    abstract maxSlippage(): Big
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

    checkTradeCondition(ammProps: AmmProperties): boolean {
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
        // 1. send the order; 2. update the remaining quantity 3. update the last trade time

        return true
    }

    tradeQuantity(): Big {
        return this.remaingQuantity.lt(this.quantityPerTrade) ? this.remaingQuantity : this.quantityPerTrade
    }

    maxSlippage(): Big {
        return BIG_HALF.div(BIG_100) //0.5%
    }
}
