import { AlgoExecutor } from "./AlgoExecutor"
import { Amm } from "../../types/ethers"
import { AmmConfig } from "../amm/AmmConfigs"
import { Side } from "../Constants"
import { Pov } from "./impl/Pov"
import { Twap } from "./impl/Twap"
import Big from "big.js"
import { Algo } from "./Algo"

export enum AlgoType {
    POV,
    TWAP,
}

export class AlgoFactory {
    private constructor() {}
    public static createAlgo(algoExecutor: AlgoExecutor, amm: Amm, pair: string, direction: Side, quanity: Big, ammConfig: AmmConfig, algoSettings: any, algoType: AlgoType): Algo {
        if (algoType == AlgoType.TWAP) {
            return new Twap(algoExecutor, amm, pair, direction, quanity, ammConfig, algoSettings)
        } else if (algoType == AlgoType.POV) {
            return new Pov(algoExecutor, amm, pair, direction, quanity, ammConfig, algoSettings)
        }
    }
}
