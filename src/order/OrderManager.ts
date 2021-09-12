import { Amm } from "../../types/ethers"
import { AmmProperties } from "../AlgoExecutionService"
import { GasService, NonceService } from "../amm/AmmUtils"
import { Log } from "../Log"
import { Mutex, withTimeout } from "async-mutex"
import { Order, OrderStatus } from "./Order"
import { PerpService } from "../eth/perp/PerpService"
import { Side } from "../Constants"
import { Wallet } from "ethers"
import Big from "big.js"
import { Algo } from "../Algo"

export class OrderManager {
    // TODO:
    //   manages orders per Amm
    //   manage orders lol
    //   watch out for block reorgs...?
    //   remove order out of parentOrders once it's completed.
    //      Maybe we could fire a message event with some topic for the compelted orders with all the child order. In this case, any user (reportig/GUI/risk etc) can record such thing easily and notify the customer

    private readonly log = Log.getLogger(OrderManager.name)
    readonly mutex = withTimeout(new Mutex(), 30000, new Error("Could not acquire mutex within 30s"))
    private readonly nonceService: NonceService
    private readonly parentOrders = new Array<Order>()

    constructor(readonly wallet: Wallet, readonly amm: Amm, readonly pair: string, readonly perpService: PerpService, readonly gasService: GasService) {
        this.nonceService = NonceService.getInstance(wallet)
    }

    // do we need a mutex to lock the parentOrders or just a buffer and flush?
    async checkOrders(ammProps: AmmProperties): Promise<any> {
        // remove the order which status is completed
        this.parentOrders.forEach((order, index) => {
            if (order.status == OrderStatus.COMPLETED || order.status == OrderStatus.CANCELED) this.parentOrders.splice(index, 1)
        })

        return await Promise.all(
            this.parentOrders
                .filter((order) => order.status == OrderStatus.IN_PROGRESS)
                .map((order: Order) => {
                    return order.check()
                })
        )
    }

    createOrder(direction: Side, quantity: Big, algo: Algo): Order {
        const o = new Order(this.amm, this.pair, direction, quantity, algo)
        this.parentOrders.push(o)
        return o
    }
}
