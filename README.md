# Bot for Cross-Chain Bridges

TypeScript utility to load test cross-chain systems based on XCLAIM (currently only targeting PolkaBTC).

## Getting started

The bot configuration can be modified in `src/config.ts`.

There are several environment variables which need to be set to run the bot. Edit `.env.local` and/or `.env.testnet`. You can then run `source .env.local` or `source .env.testnet` to set these variables in the environment.

Install the dependencies:

```bash
yarn install
```

And run the bot either using TS-Node:

```bash
yarn live
```

Or by compiling and running with standard Node:

```bash
yarn build && yarn start
```
