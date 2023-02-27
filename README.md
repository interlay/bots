# Bots

Repo with agents that perform actions in response to on-chain states. Includes a lending liquidation bot and an iBTC bridge load-testing bot. Built using [interbtc-api](https://github.com/interlay/interbtc-api), and serves as a guide for building other utilities with this library.

- [Lending Liquidator](./bots/lending-liquidator/)
- [Bridge Tester](./bots/bridge-tester/)

## Testing
```bash
yarn install
yarn docker-parachain-start
# open a new terminal...
yarn test
```