import { Algo, AlgoStatus, AlgoUrgency } from "../Algo"
import { AlgoExecutor } from "../AlgoExecutor"
import { Amm } from "../../../types/ethers"
import { AmmConfig } from "../../amm/AmmConfigs"
import { AmmProperties } from "../../AlgoExecutionService"
import { BIG_ZERO, Side } from "../../Constants"
import { Log } from "../../Log"
import { Pair, Stack } from "../../DataStructure"
import Big from "big.js"

export class Pov extends Algo {
    private readonly povLog = Log.getLogger(Pov.name)

    private percentOfVolume: number // percent tracking the PerpFi's total volume 
    private urgency: AlgoUrgency

    private _tradeQuantity: Big

    constructor(algoExecutor: AlgoExecutor, amm: Amm, pair: string, direction: Side, quantity: Big, ammConfig: AmmConfig, algoSettings: any) {
        super(algoExecutor, amm, pair, direction, quantity, ammConfig)
        this.percentOfVolume = algoSettings.POV
        this.urgency = algoSettings.URGENCY
    }

    checkTradeCondition(ammProps: AmmProperties): boolean {


        return false
    }

    tradeQuantity(): Big {
        return this._tradeQuantity
    }
}