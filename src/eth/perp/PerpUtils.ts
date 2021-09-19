import { BigNumber } from "@ethersproject/bignumber"
import { formatEther, parseEther } from "@ethersproject/units"
import { Result } from "ethers/lib/utils"
import Big from "big.js"

export interface PositionChangedLog {
    trader: string
    amm: string
    margin: Big
    positionNotional: Big
    exchangedPositionSize: Big
    fee: Big
    positionSizeAfter: Big
    realizedPnl: Big
    unrealizedPnlAfter: Big
    badDebt: Big
    liquidationPenalty: Big
    spotPrice: Big
    fundingPayment: Big
}

export function fromWei(wei: BigNumber): Big {
    return Big(formatEther(wei))
}

export function toWei(val: Big): BigNumber {
    return parseEther(val.toFixed(18))
}

export function argsToPositionChangedLog(args: Result): PositionChangedLog {
    return {
        trader: args.trader,
        amm: args.amm,
        margin: fromWei(BigNumber.from(args.margin.toString())),
        positionNotional: fromWei(BigNumber.from(args.positionNotional.toString())),
        exchangedPositionSize: fromWei(BigNumber.from(args.exchangedPositionSize.toString())),
        fee: fromWei(BigNumber.from(args.fee.toString())),
        positionSizeAfter: fromWei(BigNumber.from(args.positionSizeAfter.toString())),
        realizedPnl: fromWei(BigNumber.from(args.realizedPnl.toString())),
        unrealizedPnlAfter: fromWei(BigNumber.from(args.unrealizedPnlAfter.toString())),
        badDebt: fromWei(BigNumber.from(args.badDebt.toString())),
        liquidationPenalty: fromWei(BigNumber.from(args.liquidationPenalty.toString())),
        spotPrice: fromWei(BigNumber.from(args.spotPrice.toString())),
        fundingPayment: fromWei(BigNumber.from(args.fundingPayment.toString())),
    }
}

export function toPositionChangedLog(log: any): PositionChangedLog {
    return {
        trader: log.trader,
        amm: log.amm,
        margin: fromWei(log.margin),
        positionNotional: fromWei(log.positionNotional),
        exchangedPositionSize: fromWei(log.exchangedPositionSize),
        fee: fromWei(log.fee),
        positionSizeAfter: fromWei(log.positionSizeAfter),
        realizedPnl: fromWei(log.realizedPnl),
        unrealizedPnlAfter: fromWei(log.unrealizedPnlAfter),
        badDebt: fromWei(log.badDebt),
        liquidationPenalty: fromWei(log.liquidationPenalty),
        spotPrice: fromWei(log.spotPrice),
        fundingPayment: fromWei(log.fundingPayment),
    }
}