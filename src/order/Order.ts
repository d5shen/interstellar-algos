import * as PerpUtils from "../eth/perp/PerpUtils"
import { Algo, AlgoStatus } from "../algo/Algo"
import { AlgoType } from "../algo/AlgoFactory"
import { AmmProperties } from "../AlgoExecutionService"
import { BIG_ZERO, Side } from "../Constants"
import { Log } from "../Log"
import Big from "big.js"
import { statusTopic } from "../configs"

export enum OrderStatus {
    PENDING,
    IN_PROGRESS,
    CANCELED,
    COMPLETED,
}

export class Order {
    private readonly log = Log.getLogger(Order.name)
    private static counter = 0
    private _id: string
    private _status: OrderStatus = OrderStatus.PENDING // should be an enum PENDING, IN_PROGRESS, CANCELED, COMPLETED?
    private childOrders = new Map<string, TradeRecord>() // child order id -> TradeRecord
    private childOrderInFlight: boolean = false
    private algo: Algo
    private createTime: string

    constructor(readonly pair: string, readonly direction: Side, readonly quantity: Big, algo: Algo) {
        this._id = this.pair + "." + Side[this.direction] + "." + AlgoType[algo.type] + "." + Order.counter++
        this.algo = algo
        this._status = OrderStatus.IN_PROGRESS
        this.createTime = new Date().toLocaleString()
    }

    // called by the OrderManager when it's loop time to check on this parent order
    async check(ammProps: AmmProperties): Promise<OrderStatus> {
        this.log.jinfo({
            event: "Order:Check",
            params: {
                id: this._id,
                quantity: this.quantity,
                filled: this.algo.filledQuantity,
                remaining: this.algo.remainingQuantity,
                price: ammProps.price,
            },
        })

        if (!this.childOrderInFlight && this.algo.checkTradeCondition(ammProps)) {
            this.childOrderInFlight = true

            // child id will parent order id + current child order size + uuid
            const childOrder = this.buildTradeRecord(this.id + "." + this.childOrders.size)
            this.childOrders.set(childOrder.tradeId, childOrder) // childOrder will be fully populated after algo execute
            this.log.jinfo({
                event: "Order:Trade",
                params: {
                    id: this._id,
                    child: childOrder,
                },
            })

            await this.algo.execute(ammProps, childOrder)

            this.childOrderInFlight = false
        }

        if (this.algo.status == AlgoStatus.COMPLETED) {
            this._status = OrderStatus.COMPLETED
        } else if (this.algo.status == AlgoStatus.FAILED) {
            this._status = OrderStatus.CANCELED
        }

        return this._status
    }

    get status(): OrderStatus {
        return this._status
    }

    set status(status: OrderStatus) {
        this._status = status
    }

    set algoStatus(status: AlgoStatus) {
        this.algo.status = status
    }

    get id(): string {
        return this._id
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
        return `id:${this.id}, created:${this.createTime}, algo:${this.algo}, status:${OrderStatus[this._status]}`
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
    ppTxStatus: number | undefined = undefined // false if txn reverted, true if successful
    ppPositionChangedLog: PerpUtils.PositionChangedLog | null = null

    slippage: Big = BIG_ZERO // slippage in bps between price and ppExecPrice

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
