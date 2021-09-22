import { AlgoExecutor } from "./AlgoExecutor"
import { AmmConfig } from "../amm/AmmConfigs"
import { AmmProperties } from "../AlgoExecutionService"
import { AlgoType } from "./AlgoFactory"
import { BigNumber } from "ethers"
import { BIG_ONE, BIG_ZERO, Side } from "../Constants"
import { Log } from "../Log"
import { Queue } from "../DataStructure"
import { TradeRecord } from "../order/Order"
import Big from "big.js"
import { Socket } from "zeromq"

export enum AlgoStatus {
    INITIALIZED,
    IN_PROGRESS,
    COMPLETED,
    FAILED,
    CANCELED,
}

export abstract class Algo {
    private readonly log = Log.getLogger(Algo.name)

    protected lastTradeTime: number = 0
    protected _remainingQuantity: Big = BIG_ZERO
    protected _status: AlgoStatus = AlgoStatus.INITIALIZED
    protected failedTrades = new Queue<TradeRecord>()

    readonly type: AlgoType

    protected constructor(readonly algoExecutor: AlgoExecutor, readonly ammAddress: string, readonly pair: string, readonly direction: Side, readonly quantity: Big, readonly ammConfig: AmmConfig, readonly callbackOnCompletion: () => void) {
        this._remainingQuantity = quantity
        this._status = AlgoStatus.IN_PROGRESS
        this.positionChanged = this.positionChanged.bind(this)
    }

    // execute() accepts a pre-created childOrder TradeRecord, which will populate the rest of the fields in sendChildOrder()
    async execute(ammProps: AmmProperties, childOrder: TradeRecord): Promise<AlgoStatus> {
        const currentPrice = ammProps.price
        const tradeQuantity = this.tradeQuantity()
        const size = tradeQuantity.div(currentPrice)
        const baseAssetAmountLimit = this.direction == Side.BUY ? size.mul(BIG_ONE.sub(this.maxSlippage())) : size.mul(BIG_ONE.add(this.maxSlippage()))

        childOrder.notional = tradeQuantity
        childOrder.size = size
        childOrder.price = currentPrice
        try {
            const positionChangedLog = await this.algoExecutor.sendChildOrder(this.ammAddress, this.pair, this.direction, tradeQuantity, baseAssetAmountLimit, this.leverage(), childOrder)
            // only update these on success (no exception thrown)
            this._remainingQuantity = this._remainingQuantity.sub(tradeQuantity)
            this.lastTradeTime = Date.now()
            if (this._remainingQuantity.lte(BIG_ZERO)) {
                this._status = AlgoStatus.COMPLETED
                this.callbackOnCompletion()
            }
        } catch (e) {
            this.failedTrades.push(childOrder)
        }

        return this._status
    }

    get status(): AlgoStatus {
        return this._status
    }

    set status(status: AlgoStatus) {
        this._status = status
    }

    get filledQuantity(): Big {
        return this.quantity.sub(this.remainingQuantity)
    }

    get remainingQuantity(): Big {
        return this._remainingQuantity
    }

    // can be overridden in specific Algo implementations
    maxSlippage(): Big {
        return this.ammConfig.MAX_SLIPPAGE_RATIO
    }

    leverage(): Big {
        return this.ammConfig.PERPFI_LEVERAGE
    }

    // returns true if we should trade (send a child order) this loop cycle
    // accepts the current state of the Amm (price and reserves)
    abstract checkTradeCondition(ammProps: AmmProperties): boolean

    // these can be dynamic depending on the type of Algo
    abstract tradeQuantity(): Big

    positionChanged(
        trader: string,
        ammAddress: string,
        margin: BigNumber,
        positionNotional: BigNumber,
        exchangedPositionSize: BigNumber,
        fee: BigNumber,
        positionSizeAfter: BigNumber,
        realizedPnl: BigNumber,
        unrealizedPnlAfter: BigNumber,
        badDebt: BigNumber,
        liquidationPenalty: BigNumber,
        spotPrice: BigNumber,
        fundingPayment: BigNumber
    ): void {
        // does nothing unless overridden
    }

    toString(): string {
        return `${AlgoType[this.type].padEnd(4)}|${this.quantity.toPrecision(3).padEnd(8)}|${this.remainingQuantity.toPrecision(3).padEnd(9)}`
    }
}
