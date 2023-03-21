# lending-liquidator

Liquidation bot for the lending protocol on the Kintsugi and Interlay parachains. The bot only liquidates loans that can be repaid directly with its balance (swapping on the DEX is not yet supported). Positions are only liquidated if they are profitable at the time of liquidation.

While this bot can be used by anyone to arbitrage the lending protocol, its main purpose is educational. It is ditributed under the Apache 2.0 license: Unless required by applicable law or agreed to in writing, Licensor provides the Work (and each Contributor provides its Contributions) on an "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied, including, without limitation, any warranties or conditions of TITLE, NON-INFRINGEMENT, MERCHANTABILITY, or FITNESS FOR A PARTICULAR PURPOSE. You are solely responsible for determining the appropriateness of using or redistributing the Work and assume any risks associated with Your exercise of permissions under this License.

## Quickstart
### Local Testnet

Protip: Instead of using the docker-compose file provided, you can fork mainnet using [chopsticks](https://github.com/AcalaNetwork/chopsticks) and run the bot against a local fork to do a trial of the bot in production.

```shell
git clone https://github.com/interlay/bots
cd bots
yarn install
docker-compose up

# In a different terminal:
source .env.local
yarn workspace lending-liquidator live
```

### Production

**Set environment variables**
Create a mnemonic for the bot account (for instance, via the polkadot-js extension) and fund it. Note that the funds have to be sent to the account's address on the Kintsugi / Interlay parachain, as opposed to the relay chain. Set this mnemonic in the `LENDING_LIQUIDATOR_ACCOUNT` environment variable.

Run your own parachain node or connect to the Kintsugi (`wss://api-kusama.interlay.io/parachain`) or Interlay (`wss://api.interlay.io/parachain`) nodes run by Interlay. Set the websocket URL in the `PARACHAIN_URL` environment variable.

You can edit the [.env.kintsugi](./.env.kintsugi) file to avoid manually setting these variables each time.

**Install and run bot**
```shell
git clone https://github.com/interlay/bots
cd bots
yarn install

# Ensure the `LENDING_LIQUIDATOR_ACCOUNT` and `PARACHAIN_URL` are set in the environment
yarn workspace lending-liquidator live
```

## Standard Installation

Ensure that the current directory has a correctly configured `.env.kintsugi` file, using [this template](./.env.kintsugi).

```shell
wget https://raw.githubusercontent.com/interlay/bots/master/bots/lending-liquidator/setup/setup
chmod +x ./setup && sudo ./setup
systemctl daemon-reload
systemctl start lending-liquidator.service
```

You can then check the logs (latest first) by running:

```shell
journalctl -u lending-liquidator.service -r
```

Or by streaming the logs to the `lending-liquidator.log` file in the current directory:

```shell
journalctl --follow _SYSTEMD_UNIT=lending-liquidator.service &> lending-liquidator.log
```

To stop the service, run:

```shell
systemctl stop lending-liquidator.service
```
