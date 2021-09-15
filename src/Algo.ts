import { AlgoExecutor } from "./AlgoExecutor"
import { BIG_ONE, BIG_ZERO, Side } from "./Constants"
import { Log } from "./Log"
import { Amm } from "../types/ethers"
import { TradeRecord } from "./order/Order"
import { AmmProperties } from "./AlgoExecutionService"
import Big from "big.js"
import { AmmConfig } from "./amm/AmmConfigs"

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
    public static createAlgo(algoExecutor: AlgoExecutor, amm: Amm, pair: string, direction: Side, quanity: Big, ammConfig: AmmConfig, algoSettings: any, algoType: AlgoType): Algo {
        if (algoType == AlgoType.TWAP) {
            return new Twap(algoExecutor, amm, pair, direction, quanity, ammConfig, algoSettings)
        }
    }
}

export abstract class Algo {
    private readonly log = Log.getLogger(Algo.name)

    protected lastTradeTime: number = 0 // initialize the lastTradeTime, epoch
    protected remaingQuantity: Big
    protected status: AlgoStatus = AlgoStatus.INITIALIZED

    protected constructor(readonly algoExecutor: AlgoExecutor, readonly amm: Amm, readonly pair: string, readonly direction: Side, readonly quantity: Big) {
        this.remaingQuantity = quantity         // the total notional needs to work on by Algo.
        this.status = AlgoStatus.IN_PROGRESS
    }

    // execute() accepts a pre-created childOrder TradeRecord, which will populate the rest of the fields in sendChildOrder()
    async execute(ammProps: AmmProperties, childOrder: TradeRecord): Promise<AlgoStatus> {
        // TODO JL - HANDLE sendChildOrder catch

        // if buying FTT, I want to receive AT LEAST size*(1-slip) contracts
        // if selling FTT, I want to give up AT MOST size*(1+slip) contracts
        const size = this.tradeQuantity().div(ammProps.price)
        const baseAssetAmountLimit = this.direction == Side.BUY ? size.mul(BIG_ONE.sub(this.maxSlippage())) : size.mul(BIG_ONE.add(this.maxSlippage())) 
        childOrder.notional = this.tradeQuantity()
        childOrder.size = size
        try {
            const positionChangedLog = await this.algoExecutor.sendChildOrder(this.amm, this.pair, this.direction, this.tradeQuantity(), baseAssetAmountLimit, this.leverage(), childOrder)
            // only update these on success (no exception thrown)
            this.lastTradeTime = Date.now()
            this.remaingQuantity = this.remaingQuantity.sub(this.tradeQuantity())

            // JL - is this correct? should there be an epsilon?
            if (this.remaingQuantity.lte(BIG_ZERO)) {
                this.status = AlgoStatus.COMPLETED 
            }
        } catch (e) {
            // should try again? should do what?
            // JL TODO
        }
            
        return this.status
    }

    getRemainingQuantity(): Big {
        return this.remaingQuantity
    }

    // returns true if we should trade (send a child order) this loop cycle
    // accepts the current state of the Amm (price and reserves)
    abstract checkTradeCondition(ammProps: AmmProperties): boolean

    // these can be dynamic depending on the type of Algo
    abstract tradeQuantity(): Big
    abstract maxSlippage(): Big
    abstract leverage(): Big
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
    constructor(algoExecutor: AlgoExecutor, amm: Amm, pair: string, direction: Side, quantity: Big, readonly ammConfig: AmmConfig, algoSettings: any) {
        super(algoExecutor, amm, pair, direction, quantity)

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
        return this.ammConfig.MAX_SLIPPAGE_RATIO
    }

    leverage(): Big {
        return this.ammConfig.PERPFI_LEVERAGE
    }
}
