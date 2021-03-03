import { btcToSat, createPolkabtcAPI, PolkaBTCAPI } from "@interlay/polkabtc";
import {
    BITCOIN_NETWORK,
    REQUESTS_PER_HOUR,
    PARACHAIN_URL,
    ISSUE_AMOUNT,
    REDEEM_AMOUNT,
    REDEEM_ADDRESS,
    MS_IN_AN_HOUR,
} from "./config";
import { KeyringPair } from "@polkadot/keyring/types";
import { Keyring } from "@polkadot/api";

const requestWaitingTime = MS_IN_AN_HOUR / REQUESTS_PER_HOUR;

main()
    .then(() => {
        console.log(
            `[${new Date().toLocaleString()}] Successfully started the bot...`
        );
    })
    .catch((err) => {
        console.log(
            `[${new Date().toLocaleString()}] Error during bot startup: ${err}`
        );
    });

function connectToParachain(): Promise<PolkaBTCAPI> {
    return createPolkabtcAPI(PARACHAIN_URL, BITCOIN_NETWORK);
}

async function requestIssue(polkaBtc: PolkaBTCAPI, requester: KeyringPair) {
    console.log(`[${new Date().toLocaleString()}] requesting issue...`);
    const amountAsSatoshiString = btcToSat(ISSUE_AMOUNT.toString());

    const requesterAccountId = polkaBtc.api.createType(
        "AccountId",
        requester.address
    );
    const balance = await polkaBtc.collateral.balanceDOT(requesterAccountId);
    console.log(
        `[${new Date().toLocaleString()}] Bot balance (${
            requester.address
        }): ${balance}`
    );
    const amountAsSatoshi = polkaBtc.api.createType(
        "Balance",
        amountAsSatoshiString
    );
    try {
        await polkaBtc.issue.request(amountAsSatoshi);
        console.log(
            `[${new Date().toLocaleString()}] Sent issue request for ${ISSUE_AMOUNT.toFixed(
                8
            )} PolkaBTC`
        );
    } catch (e) {
        console.log(
            `[${new Date().toLocaleString()}] Error making issue request: ${e}`
        );
    }
}

async function requestRedeem(polkaBtc: PolkaBTCAPI) {
    console.log(`[${new Date().toLocaleString()}] requesting redeem...`);
    const amountAsSatoshiString = btcToSat(REDEEM_AMOUNT.toString());
    const amountAsSatoshi = polkaBtc.api.createType(
        "Balance",
        amountAsSatoshiString
    );
    try {
        await polkaBtc.redeem.request(amountAsSatoshi, REDEEM_ADDRESS);
        console.log(
            `[${new Date().toLocaleString()}] Sent redeem request for ${REDEEM_AMOUNT.toFixed(
                8
            )} PolkaBTC`
        );
    } catch (e) {
        console.log(
            `[${new Date().toLocaleString()}] Error making redeem request: ${e}`
        );
    }
}

async function callIssueAndRedeem(polkaBtc: PolkaBTCAPI, account: KeyringPair) {
    await requestIssue(polkaBtc, account);
    await requestRedeem(polkaBtc);
}

async function main() {
    const polkaBtcApi = await connectToParachain();
    let keyring = new Keyring({ type: "sr25519" });
    console.log(`Bot account: ${process.env.POLKABTC_BOT_ACCOUNT}`);
    let account = keyring.addFromUri(`${process.env.POLKABTC_BOT_ACCOUNT}`);

    polkaBtcApi.issue.setAccount(account);
    polkaBtcApi.redeem.setAccount(account);

    await callIssueAndRedeem(polkaBtcApi, account);
    setInterval(callIssueAndRedeem, requestWaitingTime, polkaBtcApi, account);
}
