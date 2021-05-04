import {
    createPolkabtcAPI,
    PolkaBTCAPI,
} from "@interlay/polkabtc";
import { KeyringPair } from "@polkadot/keyring/types";
import { Keyring } from "@polkadot/api";
import Big from "big.js";

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

async function executeRedeems(account: KeyringPair, redeemAddress: string) {
    try {
        // await redeem.executePendingRedeems();
        if (
            !process.env.BITCOIN_RPC_HOST
            || !process.env.BITCOIN_RPC_PORT
            || !process.env.BITCOIN_RPC_USER
            || !process.env.BITCOIN_RPC_PASS
            || !process.env.BITCOIN_NETWORK
            || !process.env.BITCOIN_RPC_WALLET
        ) {
            console.log("Bitcoin Node environment variables not set. Not Performing heartbeat redeems.");
        } else {
            await redeem.performHeartbeatRedeems(
                account,
                redeemAddress,
                process.env.BITCOIN_RPC_HOST,
                process.env.BITCOIN_RPC_PORT,
                process.env.BITCOIN_RPC_USER,
                process.env.BITCOIN_RPC_PASS,
                process.env.BITCOIN_NETWORK,
                process.env.BITCOIN_RPC_WALLET
            );
            const aliveVaults = await redeem.getAliveVaults();
            console.log("Alive vaults:");
            aliveVaults.forEach(vault => console.log(`${vault[0]}, at ${new Date(vault[1]).toLocaleString()}`))
        }
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
    let account = keyring.addFromUri(`${process.env.POLKABTC_BOT_ACCOUNT}`);
    console.log(`Bot account: ${account.address}`);
    polkaBtcApi.setAccount(account);
    
    if (REDEEM_EXECUTION_MODE) {
        if (!process.env.REDEEM_ADDRESS || !process.env.ISSUE_TOP_UP_AMOUNT) {
            Promise.reject("Redeem Bitcoin address not set in the environment");
        }
        redeem = new Redeem(polkaBtcApi, new Big(process.env.ISSUE_TOP_UP_AMOUNT as string));
        await executeRedeems(account, process.env.REDEEM_ADDRESS as string);
        setInterval(executeRedeems, requestWaitingTime, account);
    } else {
        await requestIssueAndRedeem(account);
        setInterval(requestIssueAndRedeem, requestWaitingTime, account);
    }

}
