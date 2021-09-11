import { Log } from "../Log"
import { NonceService } from "../amm/AmmUtils"
import { PerpService } from "../eth/perp/PerpService"
import { Wallet } from "ethers"

export class OrderManager {
    // TODO:
    //   manage orders lol
    //   watch out for block reorgs...?

    private readonly log = Log.getLogger(OrderManager.name)
    private readonly nonceService: NonceService
    private readonly perpService: PerpService
    private readonly wallet: Wallet
}
