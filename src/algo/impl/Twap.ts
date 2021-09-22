import { Algo, AlgoStatus } from "../Algo"
import { AlgoExecutor } from "../AlgoExecutor"
import { AlgoType } from "../AlgoFactory"
import { AmmConfig } from "../../amm/AmmConfigs"
import { AmmProperties } from "../../AlgoExecutionService"
import { BIG_ZERO, MIN_TRADE_QUANTITY, Side } from "../../Constants"
import { Log } from "../../Log"
import { Pair, Stack } from "../../DataStructure"
import Big from "big.js"
import { Socket } from "zeromq"

export class Twap extends Algo {
    private readonly twapLog = Log.getLogger(Twap.name)
    readonly type: AlgoType = AlgoType.TWAP

    private time: number // total time to execute the algo (in number of main loop cycle)
    private interval: number // time interval between each trade (in number of main loop cycle)

    private timeElapsed: number = 0
    private tradeSchedule: Stack<Pair<number, Big>>
    private _tradeQuantity: Big
    private timeInMinutes: number
    private intervalInMinutes: number

    constructor(algoExecutor: AlgoExecutor, ammAddress: string, pair: string, direction: Side, quantity: Big, ammConfig: AmmConfig, algoSettings: any) {
        super(algoExecutor, ammAddress, pair, direction, quantity, ammConfig, () => {})

        this.time = algoSettings.TIME
        this.interval = algoSettings.INTERVAL
        this.timeInMinutes = algoSettings.TOTAL_MINS
        this.intervalInMinutes = algoSettings.INTERVAL_IN_MINS
        this.tradeSchedule = this.calcTradeSchedule()
    }

    checkTradeCondition(ammProps: AmmProperties): boolean {
        if (this.tradeSchedule.size() == 0 && this.failedTrades.size() == 0) {
            // NO MORE SCHEULED TRADED OR FAIL TRADES
            this._status = AlgoStatus.COMPLETED
            return false
        }

        if (this.timeElapsed > 3 * this.time) {
            this._status = AlgoStatus.FAILED
            throw new Error(`executing Twap Algo time is way pass the schedule time. The algo is forced to completed. The remaining quantity is ${this.remainingQuantity}.`)
        }

        if (this.timeElapsed > this.time && this._status != AlgoStatus.COMPLETED) {
            this.twapLog.warn(`total time cycle elpsae ${this.timeElapsed} since start of algo, but the algo is not yet completed. The config time cycle is ${this.time}`)
        }

        let tradeQuantity = BIG_ZERO
        while (this.tradeSchedule.size() > 0 && this.tradeSchedule.peek().getFirst() <= this.timeElapsed) {
            const nextTrade = this.tradeSchedule.pop()
            tradeQuantity = tradeQuantity.add(nextTrade.getSecond())
        }

        // previously failed trades must be sent this iteration
        while (this.failedTrades.size() > 0) {
            const failedTrade = this.failedTrades.pop()
            tradeQuantity = tradeQuantity.add(failedTrade.notional)
        }

        this._tradeQuantity = tradeQuantity
        this.timeElapsed++

        return BIG_ZERO.lt(tradeQuantity)
    }

    // TODO: ideally some randomness is added to the schedule to minimize footprint
    private calcTradeSchedule(): Stack<Pair<number, Big>> {
        let tradeTimes = Math.min(Math.floor(this.time / this.interval), Math.floor(Number(this.quantity.div(MIN_TRADE_QUANTITY).toString())))

        const tradeNotional = this.quantity.div(Big(tradeTimes))
        const lastTradeNotional = this.quantity.minus(tradeNotional.mul(Big(tradeTimes - 1)))

        const stack = new Stack<Pair<number, Big>>()
        stack.push(new Pair<number, Big>(this.interval * tradeTimes, lastTradeNotional))

        while (tradeTimes > 1) {
            tradeTimes--
            stack.push(new Pair<number, Big>(this.interval * tradeTimes, tradeNotional))
        }

        return stack
    }

    tradeQuantity(): Big {
        return this._tradeQuantity
    }

    toString(): string {
        const settingStr = `total time:${this.timeInMinutes}mins, interval:${this.intervalInMinutes}mins`
        return `${super.toString()}|` + settingStr.padEnd(45)
    }
}
