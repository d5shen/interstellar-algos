import { AlgoExecutor } from "../algo/AlgoExecutor"
import { Algo, AlgoStatus } from "../algo/Algo"
import { AmmProperties } from "../AlgoExecutionService"
import { Log } from "../Log"
import { Mutex, withTimeout } from "async-mutex"
import { Order, OrderStatus } from "./Order"
import { Side } from "../Constants"
import Big from "big.js"

export class OrderManager {
    private readonly log = Log.getLogger(OrderManager.name)
    readonly mutex = withTimeout(new Mutex(), 30000, new Error("Could not acquire mutex within 30s"))
    private readonly parentOrders = new Array<Order>()

    constructor(readonly algoExecutor: AlgoExecutor, readonly pair: string) {}

    // do we need a mutex to lock the parentOrders or just a buffer and flush?
    async checkOrders(ammProps: AmmProperties): Promise<any> {
        this.log.jinfo({
            event: this.pair + ":ParentOrders",
            params: this.parentOrders.map<string>((order: Order) => order.toString()),
        })

        return await Promise.all(
            this.parentOrders
                .filter((order) => order.status == OrderStatus.IN_PROGRESS)
                .map((order: Order) => {
                    return order.check(ammProps)
                })
        )
    }

    public cancelOrder(orderId: string): boolean {
        const cancelOrderArray = this.parentOrders.filter((order) => order.id == orderId && order.status == OrderStatus.IN_PROGRESS)
        if (cancelOrderArray.length > 0) {
            const order = cancelOrderArray[0]
            order.cancel()
            return true
        }
        return false
    }

    // this is called from command line by the user
    public createOrder(direction: Side, quantity: Big, algo: Algo): Order {
        const o = new Order(this.pair, direction, quantity, algo)
        this.parentOrders.push(o)
        return o
    }

    public retriveOrders(status?: OrderStatus): Array<Order> {
        if (status) {
            return this.parentOrders.filter((order) => order.status == status)
        } else {
            return this.parentOrders
        }
    }

    public findOrders(conditons: string[]): Array<Order> {
        return this.parentOrders.filter((order) => {
            for (const condition of conditons) {
                if (!order.id.includes(condition)) {
                    return false
                }
            }
            return true
        })
    }
}
