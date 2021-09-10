import Big from "big.js"
import { Amm } from "../types/ethers"
import { Side } from "./Constants"

export class Order {
    private id: string
    private amm: Amm
    private pair: string
    private direction: Side
    private quantity: Big // should this be in notional or contracts?

    constructor(amm: Amm, pair: string, direction: Side, quantity: Big) {
        this.amm = amm
        this.pair = pair
        this.direction = direction
        this.quantity = quantity
    }
}