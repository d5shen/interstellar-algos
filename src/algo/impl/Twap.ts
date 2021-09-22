import { Algo, AlgoStatus } from "../Algo"
import { AlgoExecutor } from "../AlgoExecutor"
import { AlgoType } from "../AlgoFactory"
import { AmmConfig } from "../../amm/AmmConfigs"
import { AmmProperties } from "../../AlgoExecutionService"
import { BIG_ZERO, MIN_TRADE_NOTIONAL, Side } from "../../Constants"
import { Log } from "../../Log"
import { Pair, Stack } from "../../DataStructure"
import Big from "big.js"
import { StatusPublisher } from "../../ui/StatusPublisher"
import { pollFrequency } from "../../configs"

export class Twap extends Algo {
    private readonly twapLog = Log.getLogger(Twap.name)
    readonly type: AlgoType = AlgoType.TWAP

    private time: number // total time to execute the algo (in number of main loop cycle)
    private interval: number // time interval between each trade (in number of main loop cycle)

    private timeElapsed: number = 0
    private tradeSchedule: Stack<Pair<number, Big>>
    private _tradeNotional: Big
    private timeInMinutes: number
    private intervalInMinutes: number

    constructor(algoExecutor: AlgoExecutor, ammAddress: string, pair: string, direction: Side, notional: Big, ammConfig: AmmConfig, algoSettings: any) {
        super(
            algoExecutor,
            ammAddress,
            pair,
            direction,
            notional,
            ammConfig,
            () => {},
            () => {}
        )

        this.time = algoSettings.TIME
        this.interval = algoSettings.INTERVAL
        this.timeInMinutes = algoSettings.TOTAL_MINS
        this.intervalInMinutes = algoSettings.INTERVAL_IN_MINS
        this.tradeSchedule = this.calcTradeSchedule()
    }

    checkTradeCondition(ammProps: AmmProperties): boolean {
        if (this.tradeSchedule.size() == 0 && this.failedTrades.size() == 0) {
            // no more scheduled or failed trades
            this._status = AlgoStatus.COMPLETED
            return false
        }

        if (this.timeElapsed > this.time && this._status != AlgoStatus.COMPLETED) {
            StatusPublisher.getInstance().publish(`total time cycle elpsae ${(this.timeElapsed * pollFrequency) / 60}mins since start of algo, but the algo is not yet completed. The config time is ${this.timeInMinutes}mins`, true)
        }

        let tradeNotional = BIG_ZERO
        while (this.tradeSchedule.size() > 0 && this.tradeSchedule.peek().getFirst() <= this.timeElapsed) {
            const nextTrade = this.tradeSchedule.pop()
            tradeNotional = tradeNotional.add(nextTrade.getSecond())
        }

        // previously failed trades must be sent this iteration
        while (this.failedTrades.size() > 0) {
            const failedTrade = this.failedTrades.pop()
            tradeNotional = tradeNotional.add(failedTrade.notional)
        }

        this._tradeNotional = tradeNotional
        this.timeElapsed++

        return BIG_ZERO.lt(tradeNotional)
    }

    // TODO: ideally some randomness is added to the schedule to minimize footprint
    private calcTradeSchedule(): Stack<Pair<number, Big>> {
        let tradeTimes = Math.min(Math.floor(this.time / this.interval), Math.floor(Number(this.notional.div(MIN_TRADE_NOTIONAL).toString())))

        const tradeNotional = this.notional.div(Big(tradeTimes))
        const lastTradeNotional = this.notional.minus(tradeNotional.mul(Big(tradeTimes - 1)))

        const stack = new Stack<Pair<number, Big>>()
        stack.push(new Pair<number, Big>(this.interval * tradeTimes, lastTradeNotional))

        while (tradeTimes > 1) {
            tradeTimes--
            stack.push(new Pair<number, Big>(this.interval * tradeTimes, tradeNotional))
        }

        return stack
    }

    tradeNotional(): Big {
        return this._tradeNotional
    }

    toString(): string {
        const settingStr = `total time:${this.timeInMinutes}mins, interval:${this.intervalInMinutes}mins`
        return `${super.toString()}|` + settingStr.padEnd(45)
    }
}
