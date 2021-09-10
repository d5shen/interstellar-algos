import Big from "big.js"
import { BIG_10, BIG_10BP, BIG_ONE } from "../Constants"

export const BigTopLevelKeys = ['baseGasMultiplier']

export const BigKeys = ['PERPFI_LEVERAGE', 'PERPFI_MIN_TRADE_NOTIONAL', 'MAX_SLIPPAGE_RATIO', 'GAS_ADJUSTMENT']

export class AmmConfig {
    ENABLED: boolean
    PERPFI_LEVERAGE: Big
    PERPFI_MIN_TRADE_NOTIONAL: Big
    MAX_SLIPPAGE_RATIO: Big
    GAS_ADJUSTMENT: Big                     // adjust gas per pair

    constructor (cfg: any) {
        this.ENABLED = this.getOptional(cfg, "ENABLED", false)
        this.PERPFI_LEVERAGE = this.getOptional(cfg, "PERPFI_LEVERAGE", BIG_10)
        this.PERPFI_MIN_TRADE_NOTIONAL = this.getRequired(cfg, "PERPFI_MIN_TRADE_NOTIONAL")
        this.MAX_SLIPPAGE_RATIO = this.getOptional(cfg, "MAX_SLIPPAGE_RATIO", BIG_10BP)
        this.GAS_ADJUSTMENT = this.getOptional(cfg, "GAS_ADJUSTMENT", BIG_ONE)
    }
    getRequired(cfg: any, field: string) {
        if (cfg[field] == undefined) {
            throw new Error(`Config ${field} is not defined!`)
        }
        return cfg[field]
    }
    getOptional(cfg: any, field: string, defaultValue: any) {
        return cfg[field] != null ? cfg[field] : defaultValue
    }
}
