import * as PerpUtils from "../../eth/perp/PerpUtils"
import { Algo } from "../Algo"
import { AlgoExecutor } from "../AlgoExecutor"
import { AlgoType } from "../AlgoFactory"
import { AmmConfig } from "../../amm/AmmConfigs"
import { AmmProperties } from "../../AlgoExecutionService"
import { BigNumber } from "ethers"
import { BIG_10, BIG_ZERO, MIN_TRADE_QUANTITY, Side } from "../../Constants"
import { Log } from "../../Log"
import Big from "big.js"

export class Pov extends Algo {
    private readonly povLog = Log.getLogger(Pov.name)

    private percentOfVolume: Big // percent tracking the PerpFi's total volume
    private interval_in_mins: number
    private interval: number // minimum waiting period between child orders
    private maximumSize: Big = BIG_ZERO // optional
    private volumeByTradeTime = new Map<number, Big>()

    private _tradeQuantity: Big

    readonly type: AlgoType = AlgoType.POV

    constructor(algoExecutor: AlgoExecutor, ammAddress: string, pair: string, direction: Side, quantity: Big, ammConfig: AmmConfig, algoSettings: any, callbackOnCompletion: () => void) {
        super(algoExecutor, ammAddress, pair, direction, quantity, ammConfig, callbackOnCompletion)
        this.percentOfVolume = Big(algoSettings.POV)
        this.interval_in_mins = algoSettings.INTERVAL
        this.interval = algoSettings.INTERVAL * 60 * 1000 // user inputs in minutes

        // don't be stupid and set a tiny max size
        if (algoSettings.MAXIMUM_SIZE) {
            this.maximumSize = Big(algoSettings.MAXIMUM_SIZE)
            if (this.maximumSize.lt(MIN_TRADE_QUANTITY)) {
                this.maximumSize = MIN_TRADE_QUANTITY
            }
        }
        this.volumeByTradeTime.set(this.lastTradeTime, BIG_ZERO)
    }

    checkTradeCondition(ammProps: AmmProperties): boolean {
        // check if cycles since last trade > this.interval
        if (Date.now() < this.lastTradeTime + this.interval) {
            return false
        }
        // check volume done since last trade
        const volumeSinceLastTrade = this.volumeByTradeTime.get(this.lastTradeTime)
        this.povLog.jinfo({ event: this.pair + ":VolumeSinceLastTrade", volume: volumeSinceLastTrade })

        let tradeQuantity = BIG_ZERO
        const povQuantity = volumeSinceLastTrade.mul(this.percentOfVolume)
        if (povQuantity.lt(BIG_10)) {
            return false
        }

        tradeQuantity = povQuantity

        // cap it at the maximum size
        if (this.maximumSize.gt(BIG_ZERO) && povQuantity.gt(this.maximumSize)) {
            tradeQuantity = this.maximumSize
        }

        // don't trade more than the remaining quantity!
        if (tradeQuantity.gt(this.remainingQuantity)) {
            tradeQuantity = this.remainingQuantity
        }

        this._tradeQuantity = tradeQuantity
        return BIG_ZERO.lt(tradeQuantity)
    }

    tradeQuantity(): Big {
        return this._tradeQuantity
    }

    positionChanged(
        trader: string,
        ammAddress: string,
        margin: BigNumber,
        positionNotional: BigNumber,
        exchangedPositionSize: BigNumber,
        fee: BigNumber,
        positionSizeAfter: BigNumber,
        realizedPnl: BigNumber,
        unrealizedPnlAfter: BigNumber,
        badDebt: BigNumber,
        liquidationPenalty: BigNumber,
        spotPrice: BigNumber,
        fundingPayment: BigNumber
    ): void {
        if (this.ammAddress == ammAddress) {
            if (!this.volumeByTradeTime.has(this.lastTradeTime)) {
                this.volumeByTradeTime.set(this.lastTradeTime, BIG_ZERO)
            }
            // small race condition between sending our child order and receiving new messages but BEFORE lastTradeTime gets updated
            const volume = this.volumeByTradeTime.get(this.lastTradeTime).add(PerpUtils.fromWei(positionNotional))
            this.volumeByTradeTime.set(this.lastTradeTime, volume)
            this.povLog.jinfo({ event: this.pair + ":VolumeEvent", volume: volume })
        }
    }

    toString(): string {
        return `${super.toString()}, settings:{pov: ${this.percentOfVolume}, interval: ${this.interval_in_mins}mins, max size:${this.maximumSize}}`
    }
}
