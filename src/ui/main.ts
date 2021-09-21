import "../init"
import * as readline from "readline"
import { Socket, socket } from "zeromq"
import { statusPort, statusTopic, tcp, userInputPort, userInputTopic, initialTimeOut } from "../configs"
import { Log } from "../Log"

export class MainCLI {
    private log = Log.getLogger(MainCLI.name)
    private pubSocket: Socket
    private subSocket: Socket
    private cmd: readline.Interface
    private algoServerStatus: boolean = false
    private secondsSinceLastHeartBeat: number = 0

    constructor() {
        this.pubSocket = socket("pub")
        this.pubSocket.bindSync(`tcp://${tcp}:${userInputPort}`)
        this.log.info(`publisher bound to port ${userInputPort}`)

        this.subSocket = socket("sub")
        this.subSocket.connect(`tcp://${tcp}:${statusPort}`)
        this.subSocket.subscribe(statusTopic)
        this.log.info(`service subscriber connect to port ${statusPort} on topic:${statusTopic}.`)
        this.log.info(`Waiting on algo server...(it should take less than ${initialTimeOut} mins)`)
        this.subSocket.on("message", (topic, message, algoServerStatus) => {
            this.receive(message.toString().trim(), algoServerStatus.toString() == "true")
        })

        this.cmd = readline.createInterface({ input: process.stdin, output: process.stdout })

        setInterval(async () => {
            if (this.algoServerStatus && this.secondsSinceLastHeartBeat > 60) {
                this.logHelper("Algo server has stopped working for at least 60 seconds!")
                this.algoServerStatus = false
            } else if (this.secondsSinceLastHeartBeat >= 300 && this.secondsSinceLastHeartBeat % 60 == 0) {
                this.logHelper(`Algo server has stopped working for at least ${this.secondsSinceLastHeartBeat} seconds! Please check server status!`)
            }
            this.secondsSinceLastHeartBeat += 1
        }, 1000)
    }

    readInput(): void {
        // set up std in listener
        const asyncReadLine = () => {
            this.cmd.question("INPUT> ", (input: string) => {
                this.interpret(input.trim())
                asyncReadLine()
            })
        }
        asyncReadLine()
    }

    interpret(message: string): void {
        if (message.toLowerCase() == "help") {
            console.log(" ")
            console.log(" ")
            console.log("Input format:    INPUT> [Algo Type] [Pair] [BUY/SELL] [USDC Amount] [Algo Settings...]")
            console.log(" ")
            console.log("Algo Types available:")
            console.log("    TWAP")
            console.log("    POV")
            console.log(" ")
            console.log("Pair Format:  SUSHI-USDC")
            console.log(" ")
            console.log("TWAP Algo Settings:   [TOTAL TIME (minutes)] [TIME BETWEEN TRADES (minutes)] ")
            console.log("TWAP example:    INPUT> TWAP SUSHI-USDC BUY 1000 60 6")
            console.log(" ")
            console.log("POV Algo Settings:    [POV (devimal)] [TIME BETWEEN TRADES (minutes)] [MAX CLIP SIZE (optional)]")
            console.log("POV example:     INPUT> POV SUSHI-USDC SELL 1000 0.05 5")
            console.log(" ")
            console.log("Check Order status command:    ")
            console.log("    all orders")
            console.log("    in progress orders")
            console.log("    completed orders")
            console.log("    cancelled orders")
            console.log(" ")
            console.log("Find orders by order id:       ")
            console.log("    find <condition1> <condition2> ...")
            console.log("    Example: find TWAP BUY")
            console.log(" ")
            console.log("Cancel Order command:          ")
            console.log("    cancel <order id1> <order id2> ...")
            console.log(" ")
            console.log(" ")
        } else if (message.toLowerCase() == "quit" || message.toLowerCase() == "exit") {
            process.exit(0)
        } else {
            this.publish(message.trim())
        }
    }

    publish(message: string): void {
        // message format: string eg: TWAP SUSHI-USDC BUY 30 10 3
        if (this.algoServerStatus) {
            this.pubSocket.send([userInputTopic, message])
        } else {
            this.log.info("Algo Execution Service: NOT READY")
        }
    }

    receive(message: string, algoServerStatus: boolean): void {
        if (!this.algoServerStatus && algoServerStatus && message.length == 0) {
            // receivce heartbeat and the readInput has not been started
            this.log.info("Algo Execution Service: ready for user input")
            this.log.info("Type 'help' for help and 'exit' to exit")
            this.readInput()
        }
        this.algoServerStatus = algoServerStatus
        this.secondsSinceLastHeartBeat = 0
        if (message.length > 0) {
            this.logHelper(message)
            this.readInput()
        }
    }

    private logHelper(message: string): void {
        readline.clearLine(process.stdout, 0)
        readline.cursorTo(process.stdout, 0)
        this.log.info(message)
    }
}

const cli = new MainCLI()
