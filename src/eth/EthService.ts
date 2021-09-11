import { createTimeout } from "../amm/AmmUtils"
import { BIG_ZERO } from "../Constants"
import { BigNumber } from "@ethersproject/bignumber"
import { BaseProvider, Block, JsonRpcProvider, WebSocketProvider } from "@ethersproject/providers"
import { ethers, Wallet } from "ethers"
import { Log } from "../Log"
import { parseUnits } from "@ethersproject/units"
import { ServerProfile } from "./ServerProfile"
import { Service } from "typedi"
import { sleep } from "../util"
import { TransactionReceipt, TransactionResponse } from "@ethersproject/abstract-provider"
import Big from "big.js"

export class BaseEthService {
    provider!: BaseProvider
    static readonly log = Log.getLogger(BaseEthService.name)
    web3Endpoint: string = ""
    
    privateKeyToWallet(privateKey: string): Wallet {
        return new ethers.Wallet(privateKey, this.provider)
    }

    createContract<T>(address: string, abi: ethers.ContractInterface, signer?: ethers.Signer): T {
        return (new ethers.Contract(address, abi, signer ? signer : this.provider) as unknown) as T
    }

    async getBlock(blockNumber: number): Promise<Block> {
        return await this.provider.getBlock(blockNumber)
    }

    async checkBlockFreshness(threshold: number): Promise<void> {
        const latestBlockNumber = await this.provider.getBlockNumber()
        const latestBlock = await this.getBlock(latestBlockNumber)
        const diffNowSeconds = Math.floor(Date.now() / 1000) - latestBlock.timestamp
        BaseEthService.log.jinfo({
            event: "LatestBlock",
            params: { latestBlockNumber, diffNowSeconds }
        })
        if (diffNowSeconds > threshold) {
            throw new Error("Get stale block")
        }
    }

    async getSafeGasPrice(): Promise<BigNumber> {
        for (let i = 0; i < 3; i++) {
            const gasPrice = Big((await this.provider.getGasPrice()).toString())
            if (gasPrice.gt(BIG_ZERO)) {
                return parseUnits(gasPrice.mul(1.0).toFixed(0), 0)
            }
        }
        throw new Error("GasPrice is 0")
    }

    async getBalance(addr: string): Promise<Big> {
        const balance = await this.provider.getBalance(addr)
        return new Big(ethers.utils.formatEther(balance))
    }

    async waitForTransaction(transactionHash: string, timeoutMs: number, failureMessage?: string): Promise<TransactionReceipt> {
        // let receipt = await this.provider.getTransactionReceipt(transactionHash) // see if this is necessary
        // if ((receipt ? receipt.confirmations : 0) >= 1) { 
        //     return receipt 
        // }

        const receipt = await createTimeout<TransactionReceipt>(() => new Promise<TransactionReceipt>((resolve, reject) => {
            const minedHandler = (receipt: TransactionReceipt) => {
                if (receipt.confirmations < 1) { return }
                resolve(receipt);
            }
            this.provider.once(transactionHash, minedHandler) //on or once? not sure!
        }), timeoutMs, failureMessage)

        this.provider.removeAllListeners(transactionHash)
        return receipt
    }

    static async supervise(
        signer: Wallet,
        tx: TransactionResponse,
        timeout: number,
        retry = 3,
    ): Promise<TransactionReceipt> {
        return new Promise((resolve, reject) => {
            // Set timeout for sending cancellation tx at double the gas price
            const timeoutId = setTimeout(async () => {
                const cancelTx = await signer.sendTransaction({
                    to: signer.address,
                    value: 0,
                    gasPrice: tx.gasPrice.mul(2), // TODO Make configurable?
                    nonce: tx.nonce,
                })

                await BaseEthService.log.warn(
                    JSON.stringify({
                        event: "txCancelling",
                        params: {
                            tx: tx.hash,
                            txGasPrice: tx.gasPrice.toString(),
                            cancelTx: cancelTx.hash,
                            cancelTxGasPrice: cancelTx.gasPrice.toString(),
                            nonce: cancelTx.nonce,
                        },
                    }),
                )

                // Yo dawg I heard you like cancelling tx so
                // we put a cancel in your cancel tx so you can supervise while you supervise
                if (retry > 0) {
                    await BaseEthService.supervise(signer, cancelTx, timeout, retry - 1)
                } else {
                    await cancelTx.wait()
                }
                reject({
                    reason: "timeout",
                    tx: tx.hash,
                    cancelTx: cancelTx.hash,
                })
            }, timeout)

            // Otherwise, resolve normally if the original tx is confirmed
            tx.wait().then(result => {
                clearTimeout(timeoutId)
                resolve(result)
            })
        })
    }
}

@Service()
export class EthService extends BaseEthService {

    constructor(readonly serverProfile: ServerProfile) {
        super()
        this.web3Endpoint = this.serverProfile.web3Endpoint
        this.provider = this.initProvider()
    }

    initProvider(): WebSocketProvider {
        EthService.log.jinfo({
            event: typeof(this) + ".initProvider",
            web3Endpoint: this.web3Endpoint,
        })
        const provider = new WebSocketProvider(this.web3Endpoint)
        provider.on("error", (tx) => {
            EthService.log.jerror({
                event: "WebSocketProvider:error",
                tx: tx
            })
        })
        provider._websocket.on("close", async (code: any) => {
            EthService.log.error(
                JSON.stringify({
                    event: "ReconnectWebSocket",
                    params: { code },
                }),
            )
            provider._websocket.terminate()
            await sleep(500) // wait before reconnect
            process.exit(1)
        })
        return provider
    }
}

@Service()
export class EthServiceReadOnly extends BaseEthService {

    constructor(readonly serverProfile: ServerProfile) {
        super()
        const endpoint: string = this.serverProfile.web3EndpointRO
        this.web3Endpoint = endpoint
        const urlOrInfo = {url: endpoint}
        this.provider = new JsonRpcProvider(urlOrInfo)
        this.provider.on("error", (tx) => {
            EthServiceReadOnly.log.jerror({
                event: "WebSocketProvider:error",
                tx: tx
            })
        })
    }
}
