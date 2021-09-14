import Big from "big.js"

/*********************************************************
 *  ./configs.ts
 *  Global Configs, not pair-specific
 *********************************************************/

export const pollFrequency = 3 // in seconds
export const slowPollFrequency = 30 // in seconds
export const perpfiFee = Big(0.001) // default 0.1%

export const configPath = "configs.json"

export const preflightCheck = {
    BLOCK_TIMESTAMP_FRESHNESS_THRESHOLD: 60 * 30, // 30 minutes
    XDAI_BALANCE_THRESHOLD: Big(5),
    USDC_BALANCE_THRESHOLD: Big(100),
}
