import { AlgoExecutor } from "./AlgoExecutor"
import { Amm } from "../../types/ethers"
import { AmmConfig } from "../amm/AmmConfigs"
import { AmmProperties } from "../AlgoExecutionService"
import { BIG_ONE, BIG_ZERO, Side } from "../Constants"
import { Log } from "../Log"
import { Queue } from "../DataStructure"
import { TradeRecord } from "../order/Order"
import Big from "big.js"

export enum AlgoUrgency {
    LOW,
    MEDIUM,
    HIGH,
}

export enum AlgoStatus {
    INITIALIZED,
    IN_PROGRESS,
    COMPLETED,
}

export abstract class Algo {
    private readonly log = Log.getLogger(Algo.name)

    protected lastTradeTime: number = 0 // initialize the lastTradeTime, epoch
    protected _remainingQuantity: Big = BIG_ZERO
    protected _status: AlgoStatus = AlgoStatus.INITIALIZED
    protected failTrades = new Queue<Big>()

    protected constructor(readonly algoExecutor: AlgoExecutor, readonly amm: Amm, readonly pair: string, readonly direction: Side, readonly quantity: Big, readonly ammConfig: AmmConfig) {
        this._remainingQuantity = quantity
        this._status = AlgoStatus.IN_PROGRESS
    }

    // execute() accepts a pre-created childOrder TradeRecord, which will populate the rest of the fields in sendChildOrder()
    async execute(ammProps: AmmProperties, childOrder: TradeRecord): Promise<AlgoStatus> {
        // if buying FTT, I want to receive AT LEAST size*(1-slip) contracts
        // if selling FTT, I want to give up AT MOST size*(1+slip) contracts
        const currentPrice = ammProps.price
        const tradeQuantity = this.tradeQuantity()
        const size = tradeQuantity.div(currentPrice)
        const baseAssetAmountLimit = this.direction == Side.BUY ? size.mul(BIG_ONE.sub(this.maxSlippage())) : size.mul(BIG_ONE.add(this.maxSlippage()))

        childOrder.notional = tradeQuantity
        childOrder.size = size
        childOrder.price = currentPrice
        try {
            const positionChangedLog = await this.algoExecutor.sendChildOrder(this.amm, this.pair, this.direction, tradeQuantity, baseAssetAmountLimit, this.leverage(), childOrder)
            // only update these on success (no exception thrown)
            this._remainingQuantity = this._remainingQuantity.sub(tradeQuantity)
            if (this._remainingQuantity.lte(BIG_ZERO)) {
                this._status = AlgoStatus.COMPLETED
            }
        } catch (e) {
            this.failTrades.push(tradeQuantity)
        }

        return this._status
    }

    get status(): AlgoStatus {
        return this._status
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
}
