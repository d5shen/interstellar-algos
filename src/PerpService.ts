import * as PerpUtils from "./PerpUtils"
import { Side } from "./common"
import { Amm, AmmReader, ClearingHouse, ClearingHouseViewer, InsuranceFund } from "../types/ethers"
import { BigNumber } from "@ethersproject/bignumber"
import { BIG_ZERO } from "./Constants"
import { ethers, Wallet } from "ethers"
import { EthMetadata, SystemMetadata, SystemMetadataFactory } from "./SystemMetadataFactory"
import { BaseEthService } from "./EthService"
import { Log } from "./Log"
import { Overrides } from "@ethersproject/contracts"
import { Service } from "typedi"
import { TransactionReceipt, TransactionResponse } from "@ethersproject/abstract-provider"
import AmmArtifact from "@perp/contract/build/contracts/Amm.json"
import AmmReaderArtifact from "@perp/contract/build/contracts/AmmReader.json"
import Big from "big.js"
import ClearingHouseArtifact from "@perp/contract/build/contracts/ClearingHouse.json"
import ClearingHouseViewerArtifact from "@perp/contract/build/contracts/ClearingHouseViewer.json"
import InsuranceFundArtifact from "@perp/contract/build/contracts/InsuranceFund.json"
import { EventFragment } from "ethers/lib/utils"

export enum PnlCalcOption {
    SPOT_PRICE,
    TWAP,
}

export interface Decimal {
    d: BigNumber
}

export interface AmmProps {
    priceFeedKey: string
    quoteAssetSymbol: string
    baseAssetSymbol: string
    baseAssetReserve: Big
    quoteAssetReserve: Big
}

export interface Position {
    size: Big
    margin: Big
    openNotional: Big
    lastUpdatedCumulativePremiumFraction: Big
}

export interface PositionCost {
    side: Side
    size: Big
    baseAssetReserve: Big
    quoteAssetReserve: Big
}

export class BasePerpService {
    protected readonly log = Log.getLogger(PerpService.name)
    protected ethService: BaseEthService
    protected systemMetadataFactory: SystemMetadataFactory
    protected systemMetadata: EthMetadata | undefined

    constructor(
        ethService: BaseEthService,
        systemMetadataFactory: SystemMetadataFactory,
    ) {
        this.ethService = ethService
        this.systemMetadataFactory = systemMetadataFactory
    }

    private async createInsuranceFund(): Promise<InsuranceFund> {
        return await this.createContract<InsuranceFund>(
            ethMetadata => ethMetadata.insuranceFundAddr,
            InsuranceFundArtifact.abi,
        )
    }

    private createAmm(ammAddr: string): Amm {
        return this.ethService.createContract<Amm>(ammAddr, AmmArtifact.abi)
    }

    private async createAmmReader(): Promise<AmmReader> {
        return this.createContract<AmmReader>(systemMetadata => systemMetadata.ammReaderAddr, AmmReaderArtifact.abi)
    }

    async createClearingHouse(signer?: ethers.Signer): Promise<ClearingHouse> {
        return this.createContract<ClearingHouse>(
            systemMetadata => systemMetadata.clearingHouseAddr,
            ClearingHouseArtifact.abi,
            signer,
        )
    }

    private async createClearingHouseViewer(signer?: ethers.Signer): Promise<ClearingHouseViewer> {
        return this.createContract<ClearingHouseViewer>(
            systemMetadata => systemMetadata.clearingHouseViewerAddr,
            ClearingHouseViewerArtifact.abi,
            signer,
        )
    }

    private async createContract<T>(addressGetter: (systemMetadata: EthMetadata) => string, abi: ethers.ContractInterface, signer?: ethers.Signer): Promise<T> {
        this.systemMetadata = this.systemMetadata ?? await this.systemMetadataFactory.fetch()
        return this.ethService.createContract<T>(addressGetter(this.systemMetadata), abi, signer)
    }

    async getAllOpenAmms(): Promise<Amm[]> {
        const amms: Amm[] = []
        const insuranceFund = await this.createInsuranceFund()
        const allAmms = await insuranceFund.functions.getAllAmms()
        for (const ammAddr of allAmms[0]) {
            const amm = this.createAmm(ammAddr)
            if (await amm.open()) {
                amms.push(amm)
            }
        }

        this.log.info(
            JSON.stringify({
                event: "GetAllOpenAmms",
                params: {
                    ammAddrs: amms.map(amm => amm.address),
                },
            }),
        )
        return amms
    }

    async getAmmStates(ammAddr: string): Promise<AmmProps> {
        const ammReader = await this.createAmmReader()
        const props = (await ammReader.functions.getAmmStates(ammAddr))[0]
        return {
            priceFeedKey: props.priceFeedKey,
            quoteAssetSymbol: props.quoteAssetSymbol,
            baseAssetSymbol: props.baseAssetSymbol,
            baseAssetReserve: PerpUtils.fromWei(props.baseAssetReserve),
            quoteAssetReserve: PerpUtils.fromWei(props.quoteAssetReserve),
        }
    }

    async getPosition(ammAddr: string, traderAddr: string): Promise<Position> {
        const clearingHouse = await this.createClearingHouse()
        const position = (await clearingHouse.functions.getPosition(ammAddr, traderAddr))[0]
        return {
            size: PerpUtils.fromWei(position.size.d),
            margin: PerpUtils.fromWei(position.margin.d),
            openNotional: PerpUtils.fromWei(position.openNotional.d),
            lastUpdatedCumulativePremiumFraction: PerpUtils.fromWei(position.lastUpdatedCumulativePremiumFraction.d),
        }
    }

    async getPersonalPositionWithFundingPayment(ammAddr: string, traderAddr: string): Promise<Position> {
        const clearingHouseViewer = await this.createClearingHouseViewer()
        const position = await clearingHouseViewer.getPersonalPositionWithFundingPayment(ammAddr, traderAddr)
        return {
            size: PerpUtils.fromWei(position.size.d),
            margin: PerpUtils.fromWei(position.margin.d),
            openNotional: PerpUtils.fromWei(position.openNotional.d),
            lastUpdatedCumulativePremiumFraction: PerpUtils.fromWei(position.lastUpdatedCumulativePremiumFraction.d),
        }
    }

    async getMarginRatio(ammAddr: string, traderAddr: string): Promise<Big> {
        const clearingHouse = await this.createClearingHouse()
        return PerpUtils.fromWei((await clearingHouse.functions.getMarginRatio(ammAddr, traderAddr))[0].d)
    }

    async getPositionNotionalAndUnrealizedPnl(ammAddr: string, traderAddr: string, pnlCalcOption: PnlCalcOption): Promise<{
        positionNotional: Big
        unrealizedPnl: Big
    }> {
        const clearingHouse = await this.createClearingHouse()
        const ret = await clearingHouse.getPositionNotionalAndUnrealizedPnl(ammAddr, traderAddr, pnlCalcOption)
        return {
            positionNotional: PerpUtils.fromWei(ret.positionNotional.d),
            unrealizedPnl: PerpUtils.fromWei(ret.unrealizedPnl.d),
        }
    }

    async getUnrealizedPnl(ammAddr: string, traderAddr: string, pnlCalOption: PnlCalcOption): Promise<Big> {
        const clearingHouseViewer = await this.createClearingHouseViewer()
        const unrealizedPnl = (await clearingHouseViewer.functions.getUnrealizedPnl(ammAddr, traderAddr, BigNumber.from(pnlCalOption)))[0]
        return Big(PerpUtils.fromWei(unrealizedPnl.d))
    }

    async getEventArgs(wallet: Wallet, tx: TransactionResponse, receipt: TransactionReceipt, eventName: string): Promise<any> {
        const contract = await this.createClearingHouse(wallet)
        this.log.jinfo({
            event: `EventArgs:${eventName}`,
            params: {
                tx: tx,
                receipt: receipt,
                logs: receipt.logs
            }
        })
        if (!receipt.logs) {
            throw Error("transaction failed: " + JSON.stringify({transactionHash: tx.hash, transaction: tx, receipt: receipt}))
        }
        let abiEvent: EventFragment
        let found = false
        for (abiEvent of Object.values(contract.interface.events)) {
            if (abiEvent.name == eventName) {
                found = true
                break
            }
        }

        if (!found) {
            throw Error(`could not find event ${eventName} in log: ` + JSON.stringify({transactionHash: tx.hash, transaction: tx, receipt: receipt}))
        }

        for (const log of receipt.logs) {
            if (contract.interface.getEventTopic(abiEvent!) == log.topics[0]) {
                const description = contract.interface.parseLog(log)
                this.log.jinfo({
                    event: `EventArgs:Description:${eventName}`,
                    params: { index: log.logIndex, description }
                })
                return description.args
                //contract.interface.parseTransaction(tx)
            }
        }
    }

    async openPosition(trader: Wallet, ammAddr: string, side: Side, quoteAssetAmount: Big, leverage: Big, baseAssetAmountLimit: Big = BIG_ZERO, overrides?: Overrides): Promise<TransactionResponse> {
        const clearingHouse = await this.createClearingHouse(trader)
        const tx = await clearingHouse.functions.openPosition(
            ammAddr,
            side.valueOf(),
            { d: PerpUtils.toWei(quoteAssetAmount) },
            { d: PerpUtils.toWei(leverage) },
            { d: PerpUtils.toWei(baseAssetAmountLimit) },
            {
                // add a margin for gas limit since its estimation was sometimes too tight
                gasLimit: 2_500_000,
                ...overrides,
            },
        )
        this.log.jinfo({
            event: "OpenPositionTxSent",
            params: {
                trader: trader.address,
                amm: ammAddr,
                side,
                quoteAssetAmount: +quoteAssetAmount,
                leverage: +leverage,
                minBaseAssetAmount: +baseAssetAmountLimit,
                txHash: tx.hash,
                gasPrice: tx.gasPrice.toString(),
                nonce: tx.nonce,
            },
        })

        return tx
    }

    async closePosition(trader: Wallet, ammAddr: string, baseAssetAmountLimit: Big = BIG_ZERO, overrides?: Overrides): Promise<TransactionResponse> {
        const clearingHouse = await this.createClearingHouse(trader)
        const tx = await clearingHouse.functions.closePosition(
            ammAddr,
            { d: PerpUtils.toWei(baseAssetAmountLimit) },
            {
                gasLimit: 2_500_000,
                ...overrides,
            },
        )
        this.log.jinfo({
            event: "ClosePositionTxSent",
            params: {
                trader: trader.address,
                amm: ammAddr,
                txHash: tx.hash,
                gasPrice: tx.gasPrice.toString(),
                nonce: tx.nonce,
            },
        })

        return tx
    }

    async removeMargin(trader: Wallet, ammAddr: string, marginToBeRemoved: Big, overrides?: Overrides): Promise<TransactionResponse> {
        const clearingHouse = await this.createClearingHouse(trader)
        const tx = await clearingHouse.functions.removeMargin(
            ammAddr,
            { d: PerpUtils.toWei(marginToBeRemoved) },
            {
                gasLimit: 2_500_000,
                ...overrides,
            },
        )
        this.log.jinfo({
            event: "RemoveMarginTxSent",
            params: {
                trader: trader.address,
                amm: ammAddr,
                marginToBeRemoved: +marginToBeRemoved.toFixed(),
                txHash: tx.hash,
                gasPrice: tx.gasPrice.toString(),
                nonce: tx.nonce,
            },
        })
        return tx
    }

    async addMargin(trader: Wallet, ammAddr: string, marginToBeAdded: Big, overrides?: Overrides): Promise<TransactionResponse> {
        const clearingHouse = await this.createClearingHouse(trader)
        const tx = await clearingHouse.functions.addMargin(
            ammAddr,
            { d: PerpUtils.toWei(marginToBeAdded) },
            {
                gasLimit: 2_500_000,
                ...overrides,
            },
        )
        this.log.jinfo({
            event: "AddMarginTxSent",
            params: {
                trader: trader.address,
                amm: ammAddr,
                marginToBeRemoved: +marginToBeAdded.toFixed(),
                txHash: tx.hash,
                gasPrice: tx.gasPrice.toString(),
                nonce: tx.nonce,
            },
        })
        return tx
    }
}

@Service()
export class PerpService extends BasePerpService {
    constructor(
        readonly ethService: BaseEthService,
        readonly systemMetadataFactory: SystemMetadataFactory,
    ) {
        super(ethService, systemMetadataFactory)
        this.log.jinfo({
            event: "PerpService.ctor",
            web3Endpoint: this.ethService.web3Endpoint,
        })
    }
}
