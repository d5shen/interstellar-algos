import "./init" // this import is required
import { AlgoExecutionService } from "./AlgoExecutionService"
(async () => {
    const algoEx = new AlgoExecutionService()
    await algoEx.startInterval()
})()
