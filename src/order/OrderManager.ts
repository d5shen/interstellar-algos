import { Amm } from "../../types/ethers"
import { AmmProperties } from "../AlgoExecutionService"
import { GasService, NonceService } from "../amm/AmmUtils"
import { Log } from "../Log"
import { Mutex, withTimeout } from "async-mutex"
import { Order } from "./Order"
import { PerpService } from "../eth/perp/PerpService"
import { Wallet } from "ethers"
import { Side } from "../Constants"
import Big from "big.js"

export class OrderManager {
    // TODO:
    //   manages orders per Amm
    //   manage orders lol
    //   watch out for block reorgs...?

    private readonly log = Log.getLogger(OrderManager.name)
    readonly mutex = withTimeout(new Mutex(), 30000, new Error("Could not acquire mutex within 30s"))
    private readonly nonceService: NonceService
    private readonly parentOrders = new Array<Order>()
    
    constructor(readonly wallet: Wallet, readonly amm: Amm, readonly pair: string, readonly perpService: PerpService, readonly gasService: GasService) {
        this.nonceService = NonceService.getInstance(wallet)
    }

    // do we need a mutex to lock the parentOrders?
    async checkOrders(ammProps: AmmProperties): Promise<any> {
        return await Promise.all(
            this.parentOrders.map((order: Order) => {
                return order.check()
            })
        )
    }

    createOrder(direction: Side, quantity: Big): Order {
        const o = new Order(this.perpService, this.amm, this.pair, direction, quantity)
        this.parentOrders.push(o)
        return o
    }
}
