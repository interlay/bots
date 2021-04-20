import {
    createPolkabtcAPI,
    PolkaBTCAPI,
} from "@interlay/polkabtc";
import { KeyringPair } from "@polkadot/keyring/types";
import { Keyring } from "@polkadot/api";

import {
    REQUESTS_PER_HOUR,
    REDEEM_EXECUTION_MODE,
} from "./config";
import { MS_IN_AN_HOUR } from "./consts";
import { Issue } from "./issue";
import { Redeem } from "./redeem";

const requestWaitingTime = MS_IN_AN_HOUR / REQUESTS_PER_HOUR;
let keyring = new Keyring({ type: "sr25519" });
let issue: Issue;
let redeem: Redeem;

main()
    .catch((err) => {
        console.log(
            `[${new Date().toLocaleString()}] Error during bot operation: ${err}`
        );
    });

function connectToParachain(): Promise<PolkaBTCAPI> {
    if (!process.env.BITCOIN_NETWORK || !process.env.PARACHAIN_URL) {
        Promise.reject("Parachain URL and Bitcoin network environment variables not set");
    }
    return createPolkabtcAPI(process.env.PARACHAIN_URL as string, process.env.BITCOIN_NETWORK);
}

async function requestIssueAndRedeem(account: KeyringPair) {
    await issue.request(account);
    await redeem.request();
}

async function executeRedeems(account: KeyringPair) {
    try {
        await redeem.executePendingRedeems();
        await redeem.performHeartbeatRedeems(account);
        const aliveVaults = await redeem.getAliveVaults();
        console.log("Alive vaults:");
        aliveVaults.forEach(vault => console.log(`${vault[0]}, at ${new Date(vault[1]).toLocaleString()}`))
    } catch (error) {
        console.log(error);
    }
}

async function main() {
    if (!process.env.POLKABTC_BOT_ACCOUNT) {
        Promise.reject("Bot account mnemonic not set in the environment");
    }
    const polkaBtcApi = await connectToParachain();
    issue = new Issue(polkaBtcApi);
    redeem = new Redeem(polkaBtcApi);
    let account = keyring.addFromUri(`${process.env.POLKABTC_BOT_ACCOUNT}`);
    console.log(`Bot account: ${account.address}`);
    polkaBtcApi.setAccount(account);

    // await floodFaucet(polkaBtcApi, 100);
    if (REDEEM_EXECUTION_MODE) {
        await executeRedeems(account);
        setInterval(executeRedeems, requestWaitingTime, account);
    } else {
        await requestIssueAndRedeem(account);
        setInterval(requestIssueAndRedeem, requestWaitingTime, account);
    }

}
