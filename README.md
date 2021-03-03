# Bridge Bot for Cross-Chain Bridges

TypeScript utility to load test cross-chain systems based on XCLAIM (currently only targeting PolkaBTC).

## Getting started

The bot configuration can be modified in `src/config.ts`.

The mnemonic of a funded Polkadot account needs to be set as an environment variable:

```bash
export POLKABTC_BOT_ACCOUNT="<<YOUR MNEMONIC HERE>>"
```

Install the dependencies:

```bash
yarn install
```

And run the bot either using TS-Node:

```bash
yarn run
```

Or by compiling and running with standard Node:

```bash
yarn build && yarn start
```
