# Overview

TypeScript utility to load test the Interlay and Kintsugi bridges.

This bot is in a very early stage. Bug reports, fixes, and suggestions are welcome!

You can run the bot with the following options:

```shell
  --help                     Show help                                 [boolean]
  --version                  Show version number                       [boolean]
  --heartbeats               Try to issue and redeem slightly more than the
                             redeem dust value with every registered vault.
                             Mutually exclusive with the
                             `execute-pending-redeems` flag.
                                                       [boolean] [default: true]
  --wait-interval            Delay between rounds of issuing and redeeming with
                             each vault in the system. Example: 2 => issue and
                             redeem every two hours.       [number] [default: 8]
  --execute-pending-redeems  Try to execute redeem requests whose BTC payment
                             has already been made. Mutually exclusive with the
                             `heartbeats` flag.       [boolean] [default: false]
```

The bot is configured using the following environment variables (check `.env.local` and `.env.testnet`):

```shell
INTERBTC_BOT_ACCOUNT - The mnemonic or seed key of the Substrate account the bot will be using.
BITCOIN_NETWORK - The bitcoin network to use InterBTC on
BITCOIN_RPC_HOST - Host of your Bitcoin node
BITCOIN_RPC_USER - RPC username of your Bitcoin node
BITCOIN_RPC_PASS - RPC password of your Bitcoin node
BITCOIN_RPC_PORT - RPC port of your Bitcoin node
BITCOIN_RPC_WALLET - Name of the wallet to use from your Bitcoin node
ISSUE_TOP_UP_AMOUNT - InterBTC to top up by in case the bot is short of InterBTC to redeem
REDEEM_ADDRESS - Bitcoin address to redeem InterBTC to
PARACHAIN_URL - WebSockets URL of the BTC Parachain (use value in `.env.local` or `.env.testnet`)
STATS_URL - URL of the InterBTC stats component (use value in `.env.local` or `.env.testnet`)
FAUCET_URL - URL of the InterBTC faucet component (use value in `.env.local` or `.env.testnet`)
```

# Setting up a Bot

The following instructions have been tested on Linux.

## Quickstart

Set up the Bot locally using docker-compose. Best if you want to quickly try it out.

### Local Testnet

```shell
git clone https://github.com/interlay/bots
cd bots/bridge-tester
yarn install
docker-compose up

# In a different terminal:
source .env.local
yarn live
```

## Standard Installation

Run Bitcoin and the Bot as a service on your computer or server. Best if you intend to load test the live system.

**Some of the most common Linux systems support this approach (see [systemd](https://en.wikipedia.org/wiki/Systemd)).**

### 1. Install a local Bitcoin node

Download and install a [Bitcoin Core full-node](https://bitcoin.org/en/full-node#what-is-a-full-node) by following the [Linux instructions](https://bitcoin.org/en/full-node#linux-instructions).

### 2. Start the Bitcoin testnet node

**Synchronizing the BTC testnet takes about 30 GB of storage and takes a couple of hours depending on your internet connection.**

The Relayer requires a Bitcoin node with only part of the data. You can start Bitcoin with the following [optimizations](https://bitcoin.org/en/full-node#what-is-a-full-node):

```shell
bitcoind -testnet -server -maxuploadtarget=200 -blocksonly -rpcuser=rpcuser -rpcpassword=rpcpassword -fallbackfee=0.0002
```

### 3. Install and start the Bot

Ensure that the current directory has a correctly configured `.env.testnet` file, using [this template](https://github.com/interlay/bots/bridge-testerblob/master/.env.testnet). Pay particular attention to `INTERBTC_BOT_ACCOUNT` (the Substrate mnemonic) and `BITCOIN_RPC_WALLET` (the name of the wallet to use from your Bitcoin node) - these should be dedicated (unique) to just the Bot.

```shell
wget https://raw.githubusercontent.com/interlay/bots/bridge-testermaster/setup/setup
wget https://raw.githubusercontent.com/interlay/bots/bridge-testermaster/setup/bots/bridge-tester.service
chmod +x ./setup && sudo ./setup
systemctl daemon-reload
systemctl start bridge-tester.service
```

You can then check the logs (latest first) by running:

```shell
journalctl -u bridge-tester.service -r
```

Or by streaming the logs to the `bridge-tester.log` file in the current directory:

```shell
journalctl --follow _SYSTEMD_UNIT=interbtc-bridge-tester &> bridge-tester.log
```

To stop the service, run:

```shell
systemctl stop bridge-tester.service
```
