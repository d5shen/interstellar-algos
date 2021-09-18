import "../init"
import * as readline from "readline"
import { Socket, socket } from "zeromq"
import { port, tcp, topic } from "../configs"
import { Log } from "../Log"

export class MainCLI {
    private log = Log.getLogger(MainCLI.name)
    private sock: Socket
    private cmd: readline.Interface

    constructor() {
        this.sock = socket("pub")
        this.sock.bindSync(`tcp://${tcp}:${port}`)
        this.log.info(`publisher bound to port ${port}`)
    }

    readInput(): void {
        // set up std in listener
        this.cmd = readline.createInterface({ input: process.stdin, output: process.stdout })
        const asyncReadLine = () => {
            this.cmd.question("INPUT> ", (input: string) => {
                this.publish(input.trim())
                asyncReadLine()
            })
        }
        asyncReadLine()
    }

    async publish(message: string) {
        // message format: string eg: TWAP SUSHI-USDC BUY 30 10 3
        // TODO: What should be the return type??
        this.sock.send([topic, message])
    }
}

const cli = new MainCLI()
cli.readInput()