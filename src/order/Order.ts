import * as PerpUtils from "../eth/perp/PerpUtils"
import { Algo, AlgoStatus } from "../algo/Algo"
import { AlgoType } from "../algo/AlgoFactory"
import { AmmProperties } from "../AlgoExecutionService"
import { BIG_ZERO, CHILD_ORDER_TABLE_HEADER, PARENT_ORDER_TABLE_HEADER, Side } from "../Constants"
import { Log } from "../Log"
import Big from "big.js"
import { StatusPublisher } from "../ui/StatusPublisher"

export enum OrderStatus {
    PENDING,
    IN_PROGRESS,
    CANCELED,
    COMPLETED,
}

/**
 **  Class to represent a new parent order for algo execution
 **   manages its child orders and associated with a single algo type
 **/
export class Order {
    private readonly log = Log.getLogger(Order.name)
    private static counter = 0
    private _id: string
    private _status: OrderStatus = OrderStatus.PENDING
    private _childOrders = new Map<string, TradeRecord>() // child order id -> TradeRecord
    private childOrderInFlight: boolean = false
    private algo: Algo
    private _createTime: number
    private publisher = StatusPublisher.getInstance()

    constructor(readonly pair: string, readonly direction: Side, readonly notional: Big, algo: Algo) {
        this._id = this.pair + "." + Side[this.direction] + "." + AlgoType[algo.type] + "." + Order.counter++
        this.algo = algo
        this._status = OrderStatus.IN_PROGRESS
        this._createTime = Date.now()
    }

    // called by the OrderManager when it's loop time to check on this parent order
    async check(ammProps: AmmProperties): Promise<OrderStatus> {
        this.log.jinfo({
            event: "Order:Check",
            params: {
                id: this._id,
                notional: this.notional,
                filled: this.algo.filledNotional,
                remaining: this.algo.remainingNotional,
                price: ammProps.price,
            },
        })

        if (!this.childOrderInFlight && this.algo.checkTradeCondition(ammProps)) {
            this.childOrderInFlight = true

            // child id will parent order id + current child order size
            const childOrder = this.buildTradeRecord(this.id + "." + this._childOrders.size)
            this._childOrders.set(childOrder.tradeId, childOrder) // childOrder will be fully populated after algo execute
            this.log.jinfo({
                event: "Order:Trade",
                params: {
                    id: this._id,
                    child: childOrder,
                },
            })

            await this.algo.execute(ammProps, childOrder)
            this.publisher.publish("Traded " + CHILD_ORDER_TABLE_HEADER + "\n" + childOrder.toString(), true)
            this.childOrderInFlight = false
        }

        if (this.algo.status == AlgoStatus.COMPLETED) {
            this._status = OrderStatus.COMPLETED
            this.publisher.publish("Completed " + PARENT_ORDER_TABLE_HEADER + "\n" + this.toString(), true)
        } else if (this.algo.status == AlgoStatus.FAILED || this.algo.status == AlgoStatus.CANCELED) {
            this._status = OrderStatus.CANCELED
        }

        return this._status
    }

    cancel(): void {
        this._status = OrderStatus.CANCELED
        this.algo.cancel()
    }

    get status(): OrderStatus {
        return this._status
    }

    get id(): string {
        return this._id
    }

    get childOrders(): Map<string, TradeRecord> {
        return this._childOrders
    }

    get createTime(): number {
        return this._createTime
    }

    private buildTradeRecord(tradeId: string): TradeRecord {
        return new TradeRecord({
            tradeId: tradeId,
            pair: this.pair,
            side: this.direction,
            timestamp: Date.now(),
        })
    }

    toString(): string {
        return `${this.id.padEnd(23)}|${new Date(this._createTime).toLocaleString().padEnd(23)}|${this.algo.toString()}|${OrderStatus[this._status].toString().padEnd(15)}|`
    }
}

/**
 **  Basic trade record to represent submitted child orders transactions
 **/
export class TradeRecord {
    private readonly tradeLogger = Log.getLogger(TradeRecord.name)
    tradeId: string | null = null
    state: string = "PENDING"
    pair: string | null = null
    side: Side | null = null
    // info at decision time
    timestamp: number | null = null
    size: Big = BIG_ZERO // quantity contracts
    notional: Big = BIG_ZERO
    price: Big | null = null // expected execution price
    // amm blockchain txn info
    ppState: string = "UNINIT"
    ppSentTimestamp: number | null = null // time when creating tx
    ppAckTimestamp: number | null = null // time when tx received by blockchain
    ppFillTimestamp: number | null = null // time when tx confirmed
    ppGasPx: Big = BIG_ZERO
    ppBaseAssetAmountLimit: Big | null = null
    ppExecSize: Big = BIG_ZERO
    ppExecPrice: Big | null = null // actual execution price
    ppMaxSlip: Big = BIG_ZERO
    ppTxHash: string | null = null
    ppTxBlockNumber: number | null = null
    ppTxGasLimit: Big | null = null
    ppTxGasUsed: Big = BIG_ZERO
    ppTxStatus: number | undefined = undefined // 0 if txn reverted, 1 if successful
    ppPositionChangedLog: PerpUtils.PositionChangedLog | null = null

    slippage: Big = BIG_ZERO // slippage in bps between price and ppExecPrice

    constructor(obj: Partial<TradeRecord>) {
        Object.assign(this, obj)
    }

    onSuccess(): void {
        this.state = "PASSED"
        this.tradeLogger.info(`[${Side[this.side]}:TRADE:Final:Passed] ` + JSON.stringify(this))
    }

    onFail(): void {
        this.state = "FAILED"
        this.tradeLogger.info(`[${Side[this.side]}:TRADE:Final:Failed] ` + JSON.stringify(this))
    }

    toString(): string {
        return (
            `${this.tradeId.padEnd(25)}|${new Date(this.timestamp).toLocaleString().padEnd(23)}|` +
            `${this.notional.toPrecision(3).padEnd(8)}|${this.ppExecSize.toPrecision(3).padEnd(10)}|${this.ppExecPrice.toPrecision(4).padEnd(10)}|` +
            `${(this.slippage.mul(Big(10000)).toPrecision(4) + "bps").padEnd(11)}|`
        )
    }
}
