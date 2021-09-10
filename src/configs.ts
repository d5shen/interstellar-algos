import Big from "big.js"

/*********************************************************
 *  ./configs.ts
 *  Global Configs, not pair-specific
 *********************************************************/

export const adminPollFrequency = 30 // in seconds
export const fastMovingAverageSamples = 225 // (15 min) number of samples for fast moving avg
export const slowMovingAverageSamples = 900 // (1h) slow moving avg
export const perpfiFee = Big(0.001) // default 0.1%

export const configPath = "configs.json"
export const statsPath = "stats.json"

export const preflightCheck = {
    BLOCK_TIMESTAMP_FRESHNESS_THRESHOLD: 60 * 30, // 30 minutes
    XDAI_BALANCE_THRESHOLD: Big(5),
    USDC_BALANCE_THRESHOLD: Big(100),
}
