import * as PerpUtils from "./eth/perp/PerpUtils"
import Big from "big.js"
import { BIG_ZERO, Side } from "./Constants"
import { Log } from "./Log"
import { Amm } from "../types/ethers"

export class Order {
  private id: string
  private amm: Amm
  private pair: string
  private direction: Side
  private quantity: Big // should this be in notional or contracts?
  private filled: Big = BIG_ZERO
  private status: any // should be an enum PENDING, INFLIGHT, CANCELED, COMPLETED?
  private childOrders: Map<string, TradeRecord> // child order id -> TradeRecord

  constructor(amm: Amm, pair: string, direction: Side, quantity: Big) {
    this.amm = amm
    this.pair = pair
    this.direction = direction
    this.quantity = quantity
  }

  //TODO:
  //  ?
}

const tradeLogger = Log.getLogger("Trade")
export class TradeRecord {
  tradeId: string | null = null
  state: string = "PENDING"
  pair: string | null = null
  side: Side | null = null
  // info at decision time
  timestamp: number | null = null
  size: Big = BIG_ZERO // quantity contracts
  notional: Big = BIG_ZERO
  price: Big | null = null
  // amm blockchain txn info
  ppState: string = "UNINIT"
  ppSentTimestamp: number | null = null // time when creating tx
  ppAckTimestamp: number | null = null // time when tx received by blockchain
  ppFillTimestamp: number | null = null // time when tx confirmed
  ppGasPx: Big = BIG_ZERO
  ppBaseAssetAmountLimit: Big | null = null
  ppExecSize: Big = BIG_ZERO
  ppExecPx: Big | null = null
  ppMaxSlip: Big = BIG_ZERO
  ppTxHash: string | null = null
  ppTxBlockNumber: number | null = null
  ppTxGasLimit: Big | null = null
  ppTxGasUsed: Big = BIG_ZERO
  ppTxStatus: number | undefined = undefined // false if txn reverted, true if successful
  ppPositionChangedLog: PerpUtils.PositionChangedLog | null = null

  constructor(obj: Partial<TradeRecord>) {
    Object.assign(this, obj)
  }

  onSuccess(): void {
    this.state = "PASSED"
    tradeLogger.info(`[${Side[this.side]}:TRADE:Final:Passed] ` + JSON.stringify(this))
  }

  onFail(): void {
    this.state = "FAILED"
    tradeLogger.info(`[${Side[this.side]}:TRADE:Final:Failed] ` + JSON.stringify(this))
  }
}
