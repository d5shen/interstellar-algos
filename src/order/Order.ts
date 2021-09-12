import * as PerpUtils from "../eth/perp/PerpUtils"
import { Amm } from "../../types/ethers"
import { BigNumber } from "@ethersproject/bignumber"
import { BIG_ZERO, Side } from "../Constants"
import { Log } from "../Log"
import { NonceService } from "../amm/AmmUtils"
import { PerpService } from "../eth/perp/PerpService"
import { Wallet } from "@ethersproject/wallet"
import Big from "big.js"
import { Algo } from "../Algo"

export enum OrderStatus {
    PENDING,
    IN_PROGRESS,
    CANCELED,
    COMPLETED,
}

export class Order {
    private readonly log = Log.getLogger(Order.name)
    private id: string
    private amm: Amm
    private pair: string
    private direction: Side
    private quantity: Big // should this be in notional or contracts?
    private filled: Big = BIG_ZERO
    private _status: OrderStatus = OrderStatus.PENDING // should be an enum PENDING, IN_PROGRESS, CANCELED, COMPLETED?
    private childOrders: Map<string, TradeRecord> // child order id -> TradeRecord
    private algo: Algo

    constructor(readonly perpService: PerpService, amm: Amm, pair: string, direction: Side, quantity: Big, algo: Algo) {
        this.amm = amm
        this.pair = pair
        this.direction = direction
        this.quantity = quantity
        this.algo = algo
    }

    // called by the OrderManager when it's loop time to check on this parent order
    async check(): Promise<any> {
        await this.algo.execute()
        // do important stuff
    }

    get status(): OrderStatus {
        return this._status
    }

    private set status(value: OrderStatus) {
        this._status = value
    }
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
