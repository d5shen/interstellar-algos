## interstellar-algos

Algorithmic Execution Bot for Perpetual Protocol v1

This is a basic framework for an Algorithmic Execution Bot for Perpetual Protocol v1 and can be easily extended to work on multiple AMM venues depending on the developer's knowledge of blockchain and smart contracts development. 

## Installation

```bash
$ git clone https://github.com/d5shen/interstellar-algos.git
$ cd interstellar-algos
$ npm install
$ cp .env.production.sample .env.production
$ npm run build
```

If running in Windows Powershell, you need to install git and grep (through Gow or other ports of grep to windows)

## Configuration

You will need access to your own xDai node - both WebSocket and http JSON RPC. Check out QuickNode, GetBlock, or Ankr.
Provide your private keys in `.env.production`:

```bash

WEB3_ENDPOINT=wss://your-xdai-websocket-endpoint
WEB3_ENDPOINT_RO=https://your-xdai-json-rpc-endpoint
# The private key must start with "0x" - add it if necessary (e.g. from private key exported from Metamask)
ARBITRAGEUR_PK=YOUR_WALLET_PRIVATE_KEY
```
**Note** the node endpoint defined in `.env.production` must point to an xDai node. By default, xDai's [official endpoint](https://www.xdaichain.com/for-developers/developer-resources#json-rpc-endpoints) is used. You can also choose to use [Quicknode](https://www.quicknode.com/), or spin up [your own node](https://www.xdaichain.com/for-validators/node-deployment/manual-deployment). Ethereum nodes such as **Infura or Alchemy will not work**.

Edit the basic trading parameters in `configs.json`:

```json
{
    "ammConfigMap": {
        "SUSHI-USDC": {
            "PERPFI_LEVERAGE": 10,
            "MAX_SLIPPAGE_RATIO": 0.0050
        },
        "FTT-USDC": {
            "PERPFI_LEVERAGE": 10,
            "MAX_SLIPPAGE_RATIO": 0.0050
        },
        "...": {
            "..."
        }
    }
}
```


## Deposit

- Deposit xUSDC for trading on [Perpetual Protocol Exchange](https://perp.exchange/) - xUSDC can be deposited into your wallet either via perp.exchange, or using the xDai [Omni Bridge](https://omni.xdaichain.com/). xUSDC is the USDC token that has been transfered to xDai.
- Deposit [xDAI](https://www.xdaichain.com/for-users/get-xdai-tokens) in your wallet to pay for gas on xDai (note xDai gas fees are typically 1 Gwei and paid in xDAI, DAI tokens that have been transfered to xDai.)

## Running the Algo Execution Bot 

You can run `interstellar-algos` in *nix bash or Windows Powershell.

You will need two consoles - one for the server and one for the Command Line Interface (CLI).

## Run in bash

### Server in bash (locally)
```bash
$ npm run server
```
or
```bash
$ env $(cat .env.production | grep -v '#') npx ts-node --files src/index.ts
```

### Command Line Interface (CLI) in bash
```bash
$ npm run cli
```

## Run in Windows

### Server in Windows Powershell (locally)
```bash
$ ./run.ps1
```

### Command Line Interface (CLI) in Windows Powershell
```bash
$ env $(cat .env.production | grep -v '#') npx ts-node --files src/ui/main.ts
```
