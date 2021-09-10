/* eslint-disable @typescript-eslint/no-non-null-assertion */
import { Service } from "typedi"
import { Log } from "./Log"

@Service()
export class ServerProfile {
    private readonly log = Log.getLogger(ServerProfile.name)
    readonly web3Endpoint: string
    readonly web3EndpointRO: string
    readonly walletPrivateKey: string

    constructor(obj?: Partial<ServerProfile>) {
        if (obj == null) {
            // if nothing specified, get from env vars
            this.web3Endpoint = process.env.WEB3_ENDPOINT!
            this.web3EndpointRO = process.env.WEB3_ENDPOINT_RO!
            this.walletPrivateKey = process.env.ARBITRAGEUR_PK!
        } else {
            // for tools, don't need to have env vars defined
            this.web3Endpoint = ""
            this.web3EndpointRO = ""
            this.walletPrivateKey = ""
            Object.assign(this, obj)
        }

        this.log.jinfo({
            event: "ServerProfile",
            params: {
                web3Endpoint: this.web3Endpoint,
                web3EndpointRO: this.web3EndpointRO,
            }
        })
    }
}
