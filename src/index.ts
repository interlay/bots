import {
    btcToSat,
    createPolkabtcAPI,
    FaucetClient,
    PolkaBTCAPI,
} from "@interlay/polkabtc";
import {
    BITCOIN_NETWORK,
    REQUESTS_PER_HOUR,
    PARACHAIN_URL,
    ISSUE_AMOUNT,
    REDEEM_AMOUNT,
    REDEEM_ADDRESS,
    MS_IN_AN_HOUR,
    FAUCET_URL,
    REDEEM_EXECUTION_MODE,
    STATS_URL
} from "./config";
import { KeyringPair } from "@polkadot/keyring/types";
import { Keyring } from "@polkadot/api";
import * as polkabtcStats from '@interlay/polkabtc-stats';

const requestWaitingTime = MS_IN_AN_HOUR / REQUESTS_PER_HOUR;
let keyring = new Keyring({ type: "sr25519" });

main()
    .then(() => {
        console.log(
            `[${new Date().toLocaleString()}] Successfully started the bot...`
        );
    })
    .catch((err) => {
        console.log(
            `[${new Date().toLocaleString()}] Error during bot operation: ${err}`
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
        `[${new Date().toLocaleString()}] Bot balance (${requester.address
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

async function floodFaucet(polkaBtc: PolkaBTCAPI, accountCount: number) {
    let faucet = new FaucetClient(FAUCET_URL);
    const promises = [];
    for (let i = 0; i < accountCount; i++) {
        const rand = Math.floor(Math.random() * 10000000);
        const account = keyring.createFromUri(`//${rand}`);
        console.log(`Generated ${account.address} from Uri //${rand}`);
        promises.push(
            faucet.fundAccount(
                polkaBtc.api.createType("AccountId", account.address)
            )
        );
    }
    await Promise.all(promises);
    console.log(`Successfully requested ${accountCount} times from faucet`);
}

async function executeRedeems(polkaBtc: PolkaBTCAPI) {
    const statsApi = new polkabtcStats.StatsApi(new polkabtcStats.Configuration({ basePath: STATS_URL }));
    const redeems = (await statsApi.getRedeems(0, Number.MAX_SAFE_INTEGER)).data;
    const expiredRedeemsWithBtcTx = redeems; //.filter(
        // redeem =>
            // !redeem.completed
            // redeem.btcTxId !== ""
    // )
    console.log(`Processing ${expiredRedeemsWithBtcTx.length + 1} requests`);
    let i = 1;
    let no_tx_id_found = 0;
    for (let request of expiredRedeemsWithBtcTx) {
        console.log(`Processing request ${i}/${expiredRedeemsWithBtcTx.length + 1}`)
        try {
            const parsedRedeemId = polkaBtc.api.createType("H256", "0x" + request.id);
            const chain_request = await polkaBtc.redeem.getRequestById(parsedRedeemId);
            if (chain_request.completed.isTrue || chain_request.cancelled.isTrue) {
                continue;
            }
            let txId = "";
            try {
                txId = await polkaBtc.btcCore.getTxIdByOpReturn(request.id);
            } catch {
                no_tx_id_found = no_tx_id_found + 1;
                console.log(`${no_tx_id_found} redeems without BTC transaction`)
                continue;
            }
            const [merkleProof, rawTx] = await Promise.all([
                polkaBtc.btcCore.getMerkleProof(txId),
                polkaBtc.btcCore.getRawTransaction(txId)
            ]);

            const parsedTxId = polkaBtc.api.createType(
                "H256",
                "0x" + Buffer.from(txId, "hex").reverse().toString("hex")
            );

            const parsedMerkleProof = polkaBtc.api.createType("Bytes", "0x" + merkleProof);
            const parsedRawTx = polkaBtc.api.createType("Bytes", "0x" + rawTx.toString("hex"));

            await polkaBtc.redeem.execute(parsedRedeemId, parsedTxId, parsedMerkleProof, parsedRawTx);
            console.log(`Successfully executed redeem ${request.id}`);
        } catch (error) {
            console.log(`Failed to execute redeem ${request.id}: ${error.toString()}`);
        } finally {
            i = i + 1;
        }
    }
}

async function main() {
    const polkaBtcApi = await connectToParachain();
    console.log(`Bot account: ${process.env.POLKABTC_BOT_ACCOUNT}`);
    let account = keyring.addFromUri(`${process.env.POLKABTC_BOT_ACCOUNT}`);

    polkaBtcApi.issue.setAccount(account);
    polkaBtcApi.redeem.setAccount(account);

    // await floodFaucet(polkaBtcApi, 100);
    if (REDEEM_EXECUTION_MODE) {
        await executeRedeems(polkaBtcApi);
        setInterval(executeRedeems, requestWaitingTime, polkaBtcApi);
    } else {
        await callIssueAndRedeem(polkaBtcApi, account);
        setInterval(callIssueAndRedeem, requestWaitingTime, polkaBtcApi, account);
    }

}
