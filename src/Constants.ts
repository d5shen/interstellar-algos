import Big from "big.js"

export const BIG_1BP = Big(0.0001)
export const BIG_10BP = Big(0.001)
export const BIG_1PCT = Big(0.01)
export const BIG_0PT1 = Big(0.1)
export const BIG_ZERO = Big(0)
export const BIG_HALF = Big(0.5)
export const BIG_ONE = Big(1)
export const BIG_TWO = Big(2)
export const BIG_THREE = Big(3)
export const BIG_FOUR = Big(4)
export const BIG_FIVE = Big(5)
export const BIG_10 = Big(10)
export const BIG_20 = Big(20)
export const BIG_100 = Big(100)
export const BIG_1K = Big(1000)
export const BIG_10K = Big(10000)
export const BIG_1BIO = Big(1000000000)

export const MIN_TRADE_QUANTITY = Big(10)

export enum Side {
    BUY,
    SELL,
}

export const CHILD_ORDER_TABLE_HEADER = "Child Order:\n" + `${"id".padEnd(25)}|${"created".padEnd(23)}|${"notional".padEnd(8)}|${"exec size".padEnd(10)}|${"exec price".padEnd(10)}|${"slippage".padEnd(11)}|`

export const PARENT_ORDER_TABLE_HEADER = "Parent Order:\n" + `${"id".padEnd(23)}|${"created".padEnd(23)}|${"algo".padEnd(4)}|${"notional".padEnd(8)}|${"remaining".padEnd(9)}|${"settings".padEnd(45)}|${"status".padEnd(15)}|`
