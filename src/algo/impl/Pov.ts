import * as PerpUtils from "../../eth/perp/PerpUtils"
import { Algo } from "../Algo"
import { AlgoExecutor } from "../AlgoExecutor"
import { AlgoType } from "../AlgoFactory"
import { AmmConfig } from "../../amm/AmmConfigs"
import { AmmProperties } from "../../AlgoExecutionService"
import { BigNumber } from "ethers"
import { BIG_10, BIG_ZERO, MIN_TRADE_QUANTITY, Side } from "../../Constants"
import { Log } from "../../Log"
import { Mutex } from "async-mutex"
import Big from "big.js"

export class Pov extends Algo {
    private readonly povLog = Log.getLogger(Pov.name)
    readonly type: AlgoType = AlgoType.POV
    readonly mutex = new Mutex()

    private percentOfVolume: Big // percent tracking the PerpFi's total volume
    private intervalInMins: number // minimum waiting period (in mins) between child orders
    private interval: number // minimum waiting period between child orders
    private maximumNotional: Big = BIG_ZERO // optional
    private volumeByTradeTime = new Map<number, Big>()

    private _tradeQuantity: Big

    constructor(algoExecutor: AlgoExecutor, ammAddress: string, pair: string, direction: Side, quantity: Big, ammConfig: AmmConfig, algoSettings: any, callbackOnCompletion: () => void, callbackOnCancel: () => void) {
        super(algoExecutor, ammAddress, pair, direction, quantity, ammConfig, callbackOnCompletion, callbackOnCancel)
        this.percentOfVolume = Big(algoSettings.POV)
        this.intervalInMins = algoSettings.INTERVAL
        this.interval = algoSettings.INTERVAL * 60 * 1000 // user input number is in minutes

        // set min max size to MIN_TRADE_QUANTITY
        if (algoSettings.MAXIMUM_NOTIONAL) {
            this.maximumNotional = Big(algoSettings.MAXIMUM_NOTIONAL)
            if (this.maximumNotional.lt(MIN_TRADE_QUANTITY)) {
                this.maximumNotional = MIN_TRADE_QUANTITY
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
        if (this.maximumNotional.gt(BIG_ZERO) && povQuantity.gt(this.maximumNotional)) {
            tradeQuantity = this.maximumNotional
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

    async positionChanged(
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
    ): Promise<void> {
        if (this.ammAddress == ammAddress) {
            const release = await this.mutex.acquire()
            try {
                if (!this.volumeByTradeTime.has(this.lastTradeTime)) {
                    this.volumeByTradeTime.set(this.lastTradeTime, BIG_ZERO)
                }
                // small race condition between sending our child order and receiving new messages but BEFORE lastTradeTime gets updated
                const volume = this.volumeByTradeTime.get(this.lastTradeTime).add(PerpUtils.fromWei(positionNotional))
                this.volumeByTradeTime.set(this.lastTradeTime, volume)
                this.povLog.jinfo({ event: this.pair + ":VolumeEvent", volume: volume })
            } finally {
                release()
            }
        }
    }

    toString(): string {
        let settingStr = `pov:${this.percentOfVolume}, interval:${this.intervalInMins}mins`
        if (this.maximumNotional.gt(BIG_ZERO)) {
            settingStr += `, max size:${this.maximumNotional}`
        }
        return `${super.toString()}|` + settingStr.padEnd(45)
    }
}
