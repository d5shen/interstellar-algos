import { socket } from "zeromq"
import { port, tcp, topic } from "../configs"
import { Log } from "../Log"

const logger = Log.getLogger("publisher")

async function publishTrade(message: string) {
    // message format: string eg: TWAP SUSHI-USDC BUY 30 10 3
    // TODO: What should be the return type??
    const sock = socket("pub")
    sock.bindSync(`tcp://${tcp}:${port}`)
    logger.info(`publisher bound to port ${this.port}`)
    sock.send([topic, message])
}
