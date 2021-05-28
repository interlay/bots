# Bot for Cross-Chain Bridges

TypeScript utility to load test cross-chain systems based on XCLAIM (currently only targeting PolkaBTC).

This bot is in a very early stage, expect crashes. Bug reports, fixes and suggestions are welcome!

## Getting started

There are several environment variables which need to be set to run the bot. Edit `.env.local` and/or `.env.testnet`. You can then run `source .env.local` or `source .env.testnet` to set these variables in the environment.

Install the dependencies:

```bash
yarn install
```

You can run the bot with the following options:
```
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

To run, you can use TS-Node:

```bash
yarn live [options]
```

Or compile and run with standard Node:

```bash
yarn build && yarn start [options]
```
