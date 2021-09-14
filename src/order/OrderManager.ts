import { Amm } from "../../types/ethers"
import { AmmProperties } from "../AlgoExecutionService"
import { AlgoFactory, AlgoType } from "../Algo"
import { Log } from "../Log"
import { Mutex, withTimeout } from "async-mutex"
import { Order, OrderStatus } from "./Order"
import { Side } from "../Constants"
import Big from "big.js"
import { AlgoExecutor } from "../AlgoExecutor"
import { AmmConfig } from "../amm/AmmConfigs"

export class OrderManager {
    // TODO:
    //   manages orders per Amm
    //   watch out for block reorgs...?
    //      Maybe we could fire a message event with some topic for the compelted orders with all the child order. In this case, any user (reportig/GUI/risk etc) can record such thing easily and notify the customer

    private readonly log = Log.getLogger(OrderManager.name)
    readonly mutex = withTimeout(new Mutex(), 30000, new Error("Could not acquire mutex within 30s"))
    private readonly parentOrders = new Array<Order>()

    constructor(readonly algoExecutor: AlgoExecutor, readonly amm: Amm, readonly pair: string) {}

    // do we need a mutex to lock the parentOrders or just a buffer and flush?
    async checkOrders(ammProps: AmmProperties): Promise<any> {
        // remove the order which status is completed
        // DSG:can you modify the array within the forEach???    JL: Yes, we can modify the array within forEarch.

        // DSG: do we need this? I think we can just leave it in parentOrders, this Algo bot is for individuals anyways. it won't OOM
        //      JL: we can leave it for now to test the pipeline first. Once all the things are working properly, we could include this feature as enhancement.
        // this.parentOrders.forEach((order, index) => {
        //     if (order.status == OrderStatus.COMPLETED || order.status == OrderStatus.CANCELED) this.parentOrders.splice(index, 1)
        // })
        this.log.jinfo({
            event: "ParentOrders",
            params: this.parentOrders.map<string>((order: Order) => order.toString())
        })

        return await Promise.all(
            this.parentOrders
                .filter((order) => order.status == OrderStatus.IN_PROGRESS)
                .map((order: Order) => {
                    return order.check(ammProps)
                })
        )
    }

    // this is called from command line by the user somewhere
    public createOrder(direction: Side, quantity: Big, ammConfig: AmmConfig, algoType: AlgoType, algoSettings: any): Order {
        const algo = AlgoFactory.createAlgo(this.algoExecutor, this.amm, this.pair, direction, quantity, ammConfig, algoSettings, algoType)
        const o = new Order(this.amm, this.pair, direction, quantity, algo)
        this.parentOrders.push(o)
        return o
    }
}
