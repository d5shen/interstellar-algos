import { AlgoExecutor } from "./AlgoExecutor"
import { Algo } from "./Algo"
import { pollFrequency } from "../configs"
import { EventEmitter } from "events"
import { AmmConfig } from "../amm/AmmConfigs"
import { Side } from "../Constants"
import { Pov } from "./impl/Pov"
import { Twap } from "./impl/Twap"
import Big from "big.js"

export enum AlgoType {
    POV,
    TWAP,
}

/**  
 **  Static helper class to construct an algo for a new order
 **/
export class AlgoFactory {
    private constructor() {}
    public static createAlgo(algoExecutor: AlgoExecutor, eventEmitter: EventEmitter, ammAddress: string, pair: string, direction: Side, quanity: Big, ammConfig: AmmConfig, algoSettings: any, algoType: AlgoType): Algo {
        if (algoType == AlgoType.TWAP) {
            return new Twap(algoExecutor, ammAddress, pair, direction, quanity, ammConfig, algoSettings)
        } else if (algoType == AlgoType.POV) {
            const removeListenerCallback = () => {
                eventEmitter.removeListener("PositionChanged", pov.positionChanged)
            }

            const pov = new Pov(algoExecutor, ammAddress, pair, direction, quanity, ammConfig, algoSettings, removeListenerCallback, removeListenerCallback)
            eventEmitter.addListener("PositionChanged", pov.positionChanged)
            return pov
        }
    }

    public static createSettings(algoType: AlgoType, input: string[]): any {
        if (algoType == AlgoType.TWAP) {
            const totalMinutes = parseInt(input[0]) // in minutes, must be integer
            const interval = parseInt(input[1]) // in minutes, must be integer
            if (interval > totalMinutes / 2) {
                throw Error("Intervals cannot be more than half the Total Time - you must have at least two iterations")
            }

            // convert minutes to number of loop cycles - assume that pollFrequency divides into 60
            const totalCycles = Math.floor((60 * totalMinutes) / pollFrequency)
            const intervalCycles = Math.floor((60 * interval) / pollFrequency)
            return { TIME: totalCycles, INTERVAL: intervalCycles, TOTAL_MINS: totalMinutes, INTERVAL_IN_MINS: interval }
        } else if (algoType == AlgoType.POV) {
            const pov = parseFloat(input[0]) // in decimal
            if (pov < 0.01 || pov > 0.9) {
                throw Error("POV cannot be below 0.01 or higher than 0.9")
            }
            const interval = parseInt(input[1]) // in minutes, must be integer

            let settings = { POV: pov, INTERVAL: interval }
            if (input.length > 2) {
                settings["MAXIMUM_NOTIONAL"] = parseFloat(input[2])
            }

            return settings
        }
    }
}
