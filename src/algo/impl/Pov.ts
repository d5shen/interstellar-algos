import { Algo, AlgoStatus } from "../Algo"
import { AlgoExecutor } from "../AlgoExecutor"
import { AmmConfig } from "../../amm/AmmConfigs"
import { AmmProperties } from "../../AlgoExecutionService"
import { BigNumber } from "ethers"
import { BIG_10, BIG_ZERO, MIN_TRADE_QUANTITY, Side } from "../../Constants"
import { Log } from "../../Log"
import Big from "big.js"

export class Pov extends Algo {
    private readonly povLog = Log.getLogger(Pov.name)

    private percentOfVolume: Big // percent tracking the PerpFi's total volume 
    private interval: number // minimum waiting period between child orders
    private maximumSize: Big = BIG_ZERO // optional

    private _tradeQuantity: Big

    constructor(algoExecutor: AlgoExecutor, ammAddress: string, pair: string, direction: Side, quantity: Big, ammConfig: AmmConfig, algoSettings: any, callbackOnCompletion: () => void) {
        super(algoExecutor, ammAddress, pair, direction, quantity, ammConfig, callbackOnCompletion)
        this.percentOfVolume = Big(algoSettings.POV)
        this.interval = algoSettings.INTERVAL * 60 * 1000 // user inputs in minutes

        // don't be stupid and set a tiny max size
        if (algoSettings.MAXIMUM_SIZE) {
            this.maximumSize = Big(algoSettings.MAXIMUM_SIZE)
            if (this.maximumSize.lt(MIN_TRADE_QUANTITY)) {
                this.maximumSize = MIN_TRADE_QUANTITY
            }
        }
    }

    checkTradeCondition(ammProps: AmmProperties): boolean {
        if (Date.now() < this.lastTradeTime + this.interval) {
            return false
        }
        // check if cycles since last trade > this.interval
        // check volume done since last trade 
        let tradeQuantity = BIG_ZERO
        const volumeSinceLastTrade = BIG_ZERO // TO-DO: get actual volume
        const povQuantity = (volumeSinceLastTrade.mul(this.percentOfVolume))
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
    
    positionChanged(trader: string, ammAddress: string, margin: BigNumber, positionNotional: BigNumber, exchangedPositionSize: BigNumber, fee: BigNumber, positionSizeAfter: BigNumber, realizedPnl: BigNumber, unrealizedPnlAfter: BigNumber, badDebt: BigNumber, liquidationPenalty: BigNumber, spotPrice: BigNumber, fundingPayment: BigNumber): void {
        if (this.ammAddress == ammAddress) {
            const timestamp = Date.now()
            positionNotional
        }
    }
}