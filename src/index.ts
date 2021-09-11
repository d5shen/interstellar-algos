import { AlgoExecutionService } from "./AlgoExecutionService"
import "./init" // this import is required

;(async () => {
  const algoEx = new AlgoExecutionService()
  await algoEx.startInterval()
})()
