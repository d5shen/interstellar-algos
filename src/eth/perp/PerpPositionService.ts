import { PerpService, PnlCalcOption, Position } from "./PerpService"
import { Service } from "typedi"
import { Log } from "../../Log"
import Big from "big.js"

@Service()
export class PerpPositionService {
    private readonly log = Log.getLogger(PerpPositionService.name)

    constructor(readonly wallet: string, readonly perpService: PerpService) {}

    async getPerpPosition(ammAddress: string): Promise<Position> {
        return await this.perpService.getPersonalPositionWithFundingPayment(ammAddress, this.wallet)
    }

    async getPerpUnrealizedPnl(ammAddress: string): Promise<Big> {
        return await this.perpService.getUnrealizedPnl(ammAddress, this.wallet, PnlCalcOption.SPOT_PRICE)
    }

    async getPerpPositonWithUnrealizedPnl(ammAddress: string): Promise<[Position, Big]> {
        return await Promise.all([
            this.getPerpPosition(ammAddress),
            this.getPerpUnrealizedPnl(ammAddress),
        ])
    }

    async printPosition(ammAddress: string, ammPair: string): Promise<void> {
        const [position, unrealizedPnl] = await this.getPerpPositonWithUnrealizedPnl(ammAddress)
        this.printPerpPosition(ammPair, position, unrealizedPnl)
    }

    private printPerpPosition(ammPair: string, position: Position, unrealizedPnl?: Big) {
        let params = {
            ammPair,
            size: +position.size.round(5),
            margin: +position.margin.round(2),
            openNotional: +position.openNotional.round(2),
        }
        
        if (unrealizedPnl) {
            params = {...params, ...{unrealizedPnl: +unrealizedPnl.round(2)}}
        }
        this.log.jinfo({
            event: "PerpPosition",
            params: params,
        })
    }    
}