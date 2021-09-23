import { Socket, socket } from "zeromq"
import { statusPort, statusTopic, tcp } from "../configs"
import { Log } from "../Log"

/**  
 **  Static class to help publish messages from the server to the CLI
 **/
export class StatusPublisher {
    protected static readonly log = Log.getLogger(StatusPublisher.name)
    private static instance: StatusPublisher
    private static pubSocket: Socket = socket("pub")

    private constructor() {}

    public static getInstance(): StatusPublisher {
        if (!StatusPublisher.instance) {
            StatusPublisher.instance = new StatusPublisher()
            this.pubSocket.bind(`tcp://${tcp}:${statusPort}`)
            this.log.jinfo({ event: `status publisher bound to port ${statusPort}` })
        }

        return StatusPublisher.instance
    }

    public publish(msg: string, status: boolean) {
        StatusPublisher.pubSocket.send([statusTopic, msg, status])
    }
}
