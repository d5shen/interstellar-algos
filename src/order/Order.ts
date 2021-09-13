import * as PerpUtils from "../eth/perp/PerpUtils"
import { Amm } from "../../types/ethers"
import { BIG_ZERO, Side } from "../Constants"
import { Log } from "../Log"
import Big from "big.js"
import { Algo, AlgoStatus, Twap } from "../Algo"
import { AmmProperties } from "../AlgoExecutionService"

export enum OrderStatus {
    PENDING,
    IN_PROGRESS,
    CANCELED,
    COMPLETED,
}

export class Order {
    private readonly log = Log.getLogger(Order.name)
    private id: string 
    private filled: Big = BIG_ZERO
    private _status: OrderStatus = OrderStatus.PENDING // should be an enum PENDING, IN_PROGRESS, CANCELED, COMPLETED?
    private childOrders: Map<string, TradeRecord> // child order id -> TradeRecord
    private algo: Algo

    constructor(readonly amm: Amm, readonly pair: string, readonly direction: Side, readonly quantity: Big, algo: Algo) {
        // TODO
        // pair, quantity and direction should be pass from Order to Algo
        // the design should be: order tell the algo (either TWAP, VWAP) hoow much quanity and direction to work on
        // id should be pair.COUNTER or just a uuid

        // should the Order create the Algo object and or the OrderManager?
        // this.algo = AlgoFactory.getInstance().create(algoType, params...)
        this.algo = algo
    }

    // called by the OrderManager when it's loop time to check on this parent order
    async check(ammProps: AmmProperties): Promise<OrderStatus> {
        if (this.algo.checkTradeCondition(ammProps)) {
            // hmm should this checkTradeCondition inside of the execute funcion?????

            // a simple Child trade Id could just be PARENT_ID.COUNTER, e.g.  FTT-USDC.1.0 then FTT-USDC.1.1 etc
            const childOrder = this.buildTradeRecord(this.id + "." + this.childOrders.size)
            this.childOrders.set(childOrder.tradeId, childOrder)

            // TODO: shouldn't this be inside the checkTradeCondition() if-statement?
            const algoStatus: AlgoStatus = await this.algo.execute(childOrder)
            if (algoStatus === AlgoStatus.COMPLETED) {
                this.status = OrderStatus.COMPLETED
            }
            // childOrder will be fully populated by this point
        }
        return this.status
    }

    get status(): OrderStatus {
        return this._status
    }

    private set status(value: OrderStatus) {
        this._status = value
    }

    private buildTradeRecord(tradeId: string): TradeRecord {
        // TODO: implement this function
        return new TradeRecord({
            tradeId: tradeId,
            pair: this.pair,
            side: this.direction,
            timestamp: Date.now(),
        })
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
