import { Algo, AlgoStatus } from "../Algo"
import { AlgoExecutor } from "../AlgoExecutor"
import { Amm } from "../../../types/ethers"
import { AmmConfig } from "../../amm/AmmConfigs"
import { AmmProperties } from "../../AlgoExecutionService"
import { BIG_ZERO, MIN_TRADE_QUANTITY, Side } from "../../Constants"
import { Log } from "../../Log"
import { Pair, Stack } from "../../DataStructure"
import Big from "big.js"

export class Twap extends Algo {
    private readonly twapLog = Log.getLogger(Twap.name)

    private time: number // total time to execute the algo (in number of main loop cycle)
    private interval: number // time interval between each trade (in number of main loop cycle)

    private timeElapse: number = 0
    private tradeSchedule: Stack<Pair<number, Big>>
    private _tradeQuantity: Big

    constructor(algoExecutor: AlgoExecutor, amm: Amm, pair: string, direction: Side, quantity: Big, ammConfig: AmmConfig, algoSettings: any) {
        super(algoExecutor, amm, pair, direction, quantity, ammConfig)

        this.time = algoSettings.TIME
        this.interval = algoSettings.INTERVAL

        this.tradeSchedule = this.calcTradeSchedule()
    }

    checkTradeCondition(ammProps: AmmProperties): boolean {
        if (this.tradeSchedule.size() == 0 && this.failTrades.size() == 0) {
            // NO MORE SCHEULED TRADED OR FAIL TRADES
            this._status = AlgoStatus.COMPLETED
            return false
        }

        if (this.timeElapse > 3 * this.time) {
            this.twapLog.error(`executing Twap Algo time is way pass the schedule time. The algo is forced to completed. The remaining quantity is ${this.remainingQuantity}.`)
            this._status = AlgoStatus.COMPLETED
            return false
        }

        if (this.timeElapse > this.time && this._status != AlgoStatus.COMPLETED) {
            this.twapLog.warn(`total time cycle elpsae ${this.timeElapse} since start of algo, but the algo is not yet completed. The config time cycle is ${this.time}`)
        }

        let tradeQuantity = BIG_ZERO
        while (this.tradeSchedule.size() > 0 && this.tradeSchedule.peek().getFirst() <= this.timeElapse) {
            const nextTrade = this.tradeSchedule.pop()
            tradeQuantity = tradeQuantity.add(nextTrade.getSecond())
        }

        // previously failed trades must be sent this iteration
        while (this.failTrades.size() > 0) {
            const failedTrade = this.failTrades.pop()
            tradeQuantity = tradeQuantity.add(failedTrade)
        }

        this._tradeQuantity = tradeQuantity
        this.timeElapse++

        return BIG_ZERO.lt(tradeQuantity)
    }

    // JL - TODO handle minimum trade notional 10 USDC and adjust schedule accordingly
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
}
