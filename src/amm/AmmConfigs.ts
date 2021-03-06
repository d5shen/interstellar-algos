import { BIG_10BP, BIG_FIVE } from "../Constants"
import Big from "big.js"

export const BigTopLevelKeys = ['baseGasMultiplier']

export const BigKeys = ['PERPFI_LEVERAGE', 'PERPFI_MIN_TRADE_NOTIONAL', 'MAX_SLIPPAGE_RATIO']

export class AmmConfig {
    PERPFI_LEVERAGE: Big
    MAX_SLIPPAGE_RATIO: Big

    constructor (cfg: any) {
        this.PERPFI_LEVERAGE = this.getOptional(cfg, "PERPFI_LEVERAGE", BIG_FIVE)
        this.MAX_SLIPPAGE_RATIO = this.getOptional(cfg, "MAX_SLIPPAGE_RATIO", BIG_10BP)
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
