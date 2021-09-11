import { Log } from "../Log"
import { GasService, NonceService } from "../amm/AmmUtils"
import { PerpService } from "../eth/perp/PerpService"
import { Wallet } from "ethers"
import { Amm } from "../../types/ethers"
import { AmmProperties } from "../AlgoExecutionService"
import { Order } from "./Order"

export class OrderManager {
    // TODO:
    //   manages orders per Amm
    //   manage orders lol
    //   watch out for block reorgs...?

    private readonly log = Log.getLogger(OrderManager.name)
    private readonly nonceService: NonceService
    private readonly parentOrders = new Map<string, Order>()
    
    constructor(readonly wallet: Wallet, readonly amm: Amm, readonly pair: string, readonly perpService: PerpService, readonly gasService: GasService) {
        this.nonceService = NonceService.getInstance(wallet)
    }

    async checkOrders(ammProps: AmmProperties): Promise<any> {
        this.parentOrders.forEach((order: Order) => {
            // order.check()?
        })
    }
}
