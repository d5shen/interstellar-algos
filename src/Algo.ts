import { AlgoExecutor } from "./AlgoExecutor"
import { BIG_ONE, BIG_ZERO, Side } from "./Constants"
import { Log } from "./Log"
import { Amm } from "../types/ethers"
import { TradeRecord } from "./order/Order"
import { AmmProperties } from "./AlgoExecutionService"
import Big from "big.js"
import { AmmConfig } from "./amm/AmmConfigs"
import { Pair, Queue, Stack } from "./DataStructure"
import { trimEnd } from "lodash"

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
    protected _status: AlgoStatus = AlgoStatus.INITIALIZED
    protected failTrades: Queue<Pair<number, Big>> = new Queue()

    protected constructor(readonly algoExecutor: AlgoExecutor, readonly amm: Amm, readonly pair: string, readonly direction: Side, readonly quantity: Big) {
        this.remaingQuantity = quantity // the total notional needs to work on by Algo.
        this._status = AlgoStatus.IN_PROGRESS
    }

    // execute() accepts a pre-created childOrder TradeRecord, which will populate the rest of the fields in sendChildOrder()
    async execute(ammProps: AmmProperties, childOrder: TradeRecord): Promise<AlgoStatus> {
        // TODO JL - HANDLE sendChildOrder catch

        // if buying FTT, I want to receive AT LEAST size*(1-slip) contracts
        // if selling FTT, I want to give up AT MOST size*(1+slip) contracts
        const tradeQuantity = this.tradeQuantity().getSecond()
        const size = tradeQuantity.div(ammProps.price)
        const baseAssetAmountLimit = this.direction == Side.BUY ? size.mul(BIG_ONE.sub(this.maxSlippage())) : size.mul(BIG_ONE.add(this.maxSlippage()))
        childOrder.notional = this.tradeQuantity().getSecond()
        childOrder.size = size
        try {
            const positionChangedLog = await this.algoExecutor.sendChildOrder(this.amm, this.pair, this.direction, tradeQuantity, baseAssetAmountLimit, this.leverage(), childOrder)
            // only update these on success (no exception thrown)
        } catch (e) {
            this.failTrades.push(this.tradeQuantity())
        }

        return this._status
    }

    getRemainingQuantity(): Big {
        return this.remaingQuantity
    }

    get status() {
        return this._status
    }

    // returns true if we should trade (send a child order) this loop cycle
    // accepts the current state of the Amm (price and reserves)
    abstract checkTradeCondition(ammProps: AmmProperties): boolean

    // these can be dynamic depending on the type of Algo
    abstract tradeQuantity(): Pair<number, Big>
    abstract maxSlippage(): Big
    abstract leverage(): Big
}

export class Twap extends Algo {
    private readonly twapLog = Log.getLogger(Twap.name)

    private time: number // total time to execute the algo (in number of main loop cycle)
    private interval: number // time interval between each trade (in number of main loop cycle)
    private quantityPerTrade: Big

    private timeElapse: number = 0
    private tradeSchedule: Stack<Pair<number, Big>>
    private tradeTimeQuantity: Pair<number, Big>

    // TODO
    // implement the algoSettings class/interface
    constructor(algoExecutor: AlgoExecutor, amm: Amm, pair: string, direction: Side, quantity: Big, readonly ammConfig: AmmConfig, algoSettings: any) {
        super(algoExecutor, amm, pair, direction, quantity)

        this.time = algoSettings.TIME
        this.interval = algoSettings.INTERVAL

        this.tradeSchedule = this.calcTradeSchedule()
    }

    checkTradeCondition(ammProps: AmmProperties): boolean {
        if (this.tradeSchedule.size() == 0 && this.failTrades.size() == 0) {
            // NO MORE SCHEULED TRADED OR FAIL TRADES
            this._status = AlgoStatus.COMPLETED
        }

        if (this.timeElapse > this.time && this._status != AlgoStatus.COMPLETED) {
            this.twapLog.warn(`total time cycle elpsae ${this.timeElapse} since start of algo, but the algo is not yet completed. The config time cycle is ${this.time}`)
        }

        let tradeQuantity = BIG_ZERO
        while (this.tradeSchedule.size() > 0) {
            if (this.tradeSchedule.peek().getFirst() <= this.timeElapse) {
                let timeToTrade = this.tradeSchedule.pop()
                tradeQuantity = tradeQuantity.add(timeToTrade.getSecond())
            }
        }

        while (this.failTrades.size() > 0) {
            if (this.failTrades.peek().getFirst() <= this.timeElapse) {
                let timeToTrade = this.failTrades.pop()
                tradeQuantity = tradeQuantity.add(timeToTrade.getSecond())
            }
        }

        this.tradeTimeQuantity = new Pair<number, Big>(this.timeElapse, tradeQuantity)
        this.timeElapse += 1

        return BIG_ZERO.lt(tradeQuantity)
    }

    private calcTradeSchedule(): Stack<Pair<number, Big>> {
        let tradeTimes = Math.floor(this.time / this.interval)

        const tradeNotional = this.quantity.div(Big(tradeTimes))
        const lastTradeNotional = this.quantity.minus(tradeNotional.mul(Big(tradeTimes - 1)))

        let stack = new Stack<Pair<number, Big>>()
        stack.push(new Pair<number, Big>(this.interval * tradeTimes, lastTradeNotional))

        while (tradeTimes >= 2) {
            tradeTimes -= 1
            stack.push(new Pair<number, Big>(this.interval * tradeTimes, tradeNotional))
        }

        return stack
    }

    tradeQuantity(): Pair<number, Big> {
        return this.tradeTimeQuantity
    }

    maxSlippage(): Big {
        return this.ammConfig.MAX_SLIPPAGE_RATIO
    }

    leverage(): Big {
        return this.ammConfig.PERPFI_LEVERAGE
    }
}
