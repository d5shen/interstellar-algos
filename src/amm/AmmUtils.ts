import { perpfiFee } from "../configs"
import { BIG_10, BIG_1BIO, BIG_1K, BIG_ONE, BIG_ZERO } from "../Constants"
import { BigNumber } from "@ethersproject/bignumber"
import { Side } from "../common"
import { BaseEthService } from "../EthService"
import { Log } from "../Log"
import { Mutex, withTimeout } from "async-mutex"
import { parseUnits } from "@ethersproject/units"
import { Position, AmmProps } from "../PerpService"
import { AmmConfig } from "./AmmConfigs"
import { Wallet } from "ethers"
import Big from "big.js"

export class GasService {
    private MAX_TOTAL_GAS = BIG_1BIO.mul(BIG_1K).mul(BIG_10) // 10000 gwei
    private ethService: BaseEthService
    private safeGasPrice: BigNumber
    baseMultiplier: Big
    
    constructor(ethService: BaseEthService) {
        this.ethService = ethService
        this.safeGasPrice = BigNumber.from(0)
        this.baseMultiplier = BIG_ONE
    }

    // gas price in wei
    // 1 gwei = 1e9 wei
    get(multiplier: Big = BIG_ONE): BigNumber {
        let newGasPrice = Big(this.safeGasPrice.toString()) // in wei
        let totalMultiplier = multiplier.mul(this.baseMultiplier)
        newGasPrice = newGasPrice.mul(totalMultiplier)
        
        // cap the total gas
        newGasPrice = newGasPrice.lt(BIG_1BIO) ? BIG_1BIO : newGasPrice
        newGasPrice = newGasPrice.gt(this.MAX_TOTAL_GAS) ? this.MAX_TOTAL_GAS : newGasPrice
        return parseUnits(newGasPrice.toFixed(0),0)
    }

    async sync(): Promise<BigNumber> {
        try {
            this.safeGasPrice = await this.ethService.getSafeGasPrice()
        } catch (e) {
            // don't bother
        }
        return this.safeGasPrice
    }
}

export class NonceService {
    private nextNonce: number
    private wallet: Wallet
    readonly mutex = withTimeout(new Mutex(), 30000, new Error("Could not acquire mutex within 30s"))
    constructor(wallet: Wallet) {
        this.nextNonce = 0
        this.wallet = wallet
    }

    get(): number {
        return this.nextNonce
    }
    
    getAndIncrement(): number {
        const nonce = this.nextNonce
        this.nextNonce++
        return nonce
    }
    increment(): void {
        this.nextNonce++
    }

    async unlockedSync(): Promise<number> {
        this.nextNonce = await createTimeout<number>(() => this.wallet.getTransactionCount(), 5000, "SyncNonce:TIMEOUT:5s")
        return this.nextNonce
    }

    async sync(): Promise<number> {
        const release = await this.mutex.acquire()
        try {
            this.nextNonce = await createTimeout<number>(() => this.wallet.getTransactionCount(), 15000, "SyncNonce:TIMEOUT:15s")
            return this.nextNonce
        } catch (e) {
            throw e
        } finally {
            release()
        }
    }
}

export async function createTimeout<T>(promise: () => Promise<T>, timeoutMs: number, failureMessage?: string) { 
    let timeoutHandle: NodeJS.Timeout;
    const timeoutPromise = new Promise<never>((resolve, reject) => {
        timeoutHandle = setTimeout(() => reject(new Error(failureMessage)), timeoutMs)
    })
  
    return Promise.race([promise(), timeoutPromise]).then((result) => {
        clearTimeout(timeoutHandle)
        return result
    }, (rejected) => {
        clearTimeout(timeoutHandle)
        throw new Error(rejected)
    }).catch((reason) => {
        throw new Error(reason)
    })
}

export function getAmmPair(ammState: AmmProps): string {
    return `${ammState.baseAssetSymbol}-${ammState.quoteAssetSymbol}`
}

export function getAmmPrice(ammState: AmmProps): Big {
    return ammState.quoteAssetReserve.div(ammState.baseAssetReserve)
}

export function calculateMaxSlippageAmount(ammPrice: Big, maxSlippage: Big, baseAssetReserve: Big, quoteAssetReserve: Big): Big {
    const targetAmountSq = ammPrice
        .mul(BIG_ONE.add(maxSlippage))
        .mul(baseAssetReserve)
        .mul(quoteAssetReserve)
    return targetAmountSq.sqrt().sub(quoteAssetReserve)
}

// unused?
export function calcQuoteAssetNeeded(baseAssetReserve: Big, quoteAssetReserve: Big, price: Big): Big {
    // quoteAssetNeeded = sqrt(quoteAssetReserve * baseAssetReserve * price) - quoteAssetReserve
    const ammPrice = quoteAssetReserve.div(baseAssetReserve)
    if (ammPrice.eq(price)) return BIG_ZERO
    return quoteAssetReserve
        .mul(baseAssetReserve)
        .mul(price)
        .sqrt()
        .minus(quoteAssetReserve)
}

export function calculateRegulatedPositionNotional(log: Log, ammConfig: AmmConfig, ammPrice: Big, quoteBalance: Big, maxSlippageAmount: Big, position: Position, side: Side): Big {
    let maxOpenNotional = BIG_ZERO

    let amount = maxSlippageAmount
    if (amount.gt(maxOpenNotional)) {
        amount = maxOpenNotional
        log.jinfo({
            event: "PerpFiAmountExceedMax",
            params: {
                ammConfig,
                side,
                size: +position.size.round(5),
                openNotional: +position.openNotional.round(2),
                maxSlippageAmount: +maxSlippageAmount.round(2),
                maxOpenNotional: +maxOpenNotional.round(2),
                amount: +amount.round(2),
            },
        })
    }

    if (amount.lt(ammConfig.PERPFI_MIN_TRADE_NOTIONAL)) {
        amount = BIG_ZERO
        log.jinfo({
            event: "PerpFiAmountTooSmall",
            params: {
                ammConfig,
                side,
                size: +position.size.round(5),
                openNotional: +position.openNotional.round(2),
                maxSlippageAmount: +maxSlippageAmount.round(2),
                maxOpenNotional: +maxOpenNotional.round(2),
                amount: +amount.round(2),
            },
        })
    } else if (amount.eq(BIG_ZERO)) {
        log.jinfo({
            event: "AmountZero",
            params: {
                ammConfig,
                side,
                size: +position.size.round(5),
                openNotional: +position.openNotional.round(2),
                maxSlippageAmount: +maxSlippageAmount.round(2),
                maxOpenNotional: +maxOpenNotional.round(2),
                amount: +amount.round(2),
            },
        })
    } else {
        log.jinfo({
            event: "AmountCalculated",
            params: {
                ammConfig,
                side,
                size: +position.size.round(5),
                openNotional: +position.openNotional.round(2),
                maxSlippageAmount: +maxSlippageAmount.round(2),
                maxOpenNotional: +maxOpenNotional.round(2),
                amount: +amount.round(2),
            },
        })
    }
    return amount
}

