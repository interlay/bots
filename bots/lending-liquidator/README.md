# lending-liquidator

Liquidation bot for the lending protocol on the Kintsugi and Interlay parachains. The bot only liquidates loans that can be repaid directly with its balance (swapping on the DEX is not yet supported).

## Kintsugi Testnet

```shell
git clone https://github.com/interlay/bots
yarn install
docker-compose up

# In a different terminal:
source .env.testnet
yarn workspace lending-liquidator live
```

## Local Testnet

```shell
git clone https://github.com/interlay/bots
yarn install
docker-compose up

# In a different terminal:
source .env.local
yarn workspace lending-liquidator live
```
