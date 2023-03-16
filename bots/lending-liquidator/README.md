# lending-liquidator

Liquidation bot for the lending protocol on the Kintsugi and Interlay parachains. The bot only liquidates loans that can be repaid directly with its balance (swapping on the DEX is not yet supported). Positions are only liquidated if they are profitable at the time of liquidation.

While this bot can be used by anyone to arbitrage the lending protocol, its main purpose is educational. It is ditributed under the Apache 2.0 license: Unless required by applicable law or agreed to in writing, Licensor provides the Work (and each Contributor provides its Contributions) on an "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied, including, without limitation, any warranties or conditions of TITLE, NON-INFRINGEMENT, MERCHANTABILITY, or FITNESS FOR A PARTICULAR PURPOSE. You are solely responsible for determining the appropriateness of using or redistributing the Work and assume any risks associated with Your exercise of permissions under this License.

## Local Testnet

Protip: Instead of using the docker-compose file provided, you can fork mainnet using [chopsticks](https://github.com/AcalaNetwork/chopsticks) and run the bot against a local fork to do a trial of the bot in production.

```shell
git clone https://github.com/interlay/bots
yarn install
docker-compose up

# In a different terminal:
source .env.local
yarn workspace lending-liquidator live
```

## Production

### Set environment variables
Create a mnemonic for the bot account (for instance, via the polkadot-js extension) and fund it. Note that the funds have to be sent to the account's address on the Kintsugi / Interlay parachain, as opposed to the relay chain. Set this mnemonic in the `LENDING_LIQUIDATOR_ACCOUNT` environment variable; you can use the [example environment file](./.env.example) to avoid manually setting this variable each time.

Run your own parachain node or connect to the Kintsugi (`wss://api-kusama.interlay.io/parachain`) or Interlay (`wss://api.interlay.io/parachain`) nodes run by Interlay. Set the websocket URL in the `PARACHAIN_URL` environment variable; you can use the [example environment file](./.env.example) to avoid manually setting this variable each time.

### Install and run bot
```shell
git clone https://github.com/interlay/bots
yarn install

# Ensure the `LENDING_LIQUIDATOR_ACCOUNT` and `PARACHAIN_URL` are set in the environment
yarn workspace lending-liquidator live
```
