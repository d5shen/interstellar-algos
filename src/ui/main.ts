import "../init"
import * as readline from "readline"
import { Socket, socket } from "zeromq"
import { statusPort, statusTopic, tcp, userInputPort, userInputTopic } from "../configs"
import { Log } from "../Log"

export class MainCLI {
    private log = Log.getLogger(MainCLI.name)
    private pubSocket: Socket
    private subSocket: Socket
    private cmd: readline.Interface
    private algoServerStatus: boolean = false

    constructor() {
        this.pubSocket = socket("pub")
        this.pubSocket.bindSync(`tcp://${tcp}:${userInputPort}`)
        this.log.info(`publisher bound to port ${userInputPort}`)

        this.subSocket = socket("sub")
        this.subSocket.connect(`tcp://${tcp}:${statusPort}`)
        this.subSocket.subscribe(statusTopic)
        this.log.info(`service subscriber connect to port ${statusPort} on topic:${statusTopic}. Waitting on algo server...(it should take less than 5 mins)`)
        this.subSocket.on("message", (topic, message, algoServerStatus) => {
            this.receive(message.toString().trim(), algoServerStatus.toString() == "true")
        })

        this.cmd = readline.createInterface({ input: process.stdin, output: process.stdout })
    }

    readInput(): void {
        // set up std in listener
        const asyncReadLine = () => {
            this.cmd.question("INPUT> ", (input: string) => {
                this.publish(input.trim())
                asyncReadLine()
            })
        }
        asyncReadLine()
    }

    publish(message: string): void {
        // message format: string eg: TWAP SUSHI-USDC BUY 30 10 3
        if (this.algoServerStatus) {
            this.pubSocket.send([userInputTopic, message])
        }
    }

    receive(message: string, algoServerStatus: boolean): void {
        if (!this.algoServerStatus && algoServerStatus && message.length == 0) {
            // receivce heartbeat and the readInput has not been started
            this.log.info("Algo Execution Service: ready for user input")
            this.readInput()
        }
        this.algoServerStatus = algoServerStatus
        if (message.length > 0) {
            readline.clearLine(process.stdout, 0)
            readline.cursorTo(process.stdout, 0)
            this.log.info(message)
            this.readInput()
        }
    }
}

const cli = new MainCLI()
