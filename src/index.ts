import { AlgoExecution } from "./AlgoExecution"
import "./init" // this import is required

(async () => {
    const algoEx = new AlgoExecution()
    await algoEx.startInterval()
})()
