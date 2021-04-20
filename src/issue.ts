import { PolkaBTCAPI, btcToSat, issue, BitcoinCoreClient } from "@interlay/polkabtc";
import { KeyringPair } from "@polkadot/keyring/types";
import Big from "big.js";

import { ISSUE_AMOUNT } from "./config";

export class Issue {
    polkaBtc: PolkaBTCAPI;

    constructor(polkaBtc: PolkaBTCAPI) {
        this.polkaBtc = polkaBtc;
    }

    async request(requester: KeyringPair) {
        console.log(`[${new Date().toLocaleString()}] -----Requesting issue...-----`);
        const amountAsSatoshiString = btcToSat(ISSUE_AMOUNT.toString());

        const requesterAccountId = this.polkaBtc.api.createType(
            "AccountId",
            requester.address
        );
        const balance = await this.polkaBtc.collateral.balance(requesterAccountId);
        console.log(
            `[${new Date().toLocaleString()}] DOT balance (${requester.address
            }): ${balance}`
        );
        const amountAsSatoshi = this.polkaBtc.api.createType(
            "Balance",
            amountAsSatoshiString
        );
        try {
            await this.polkaBtc.issue.request(amountAsSatoshi);
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

    async requestAndExecuteIssue(requester: KeyringPair, amount: Big): Promise<boolean> {
        if (
            !process.env.BITCOIN_RPC_HOST
            || !process.env.BITCOIN_RPC_PORT
            || !process.env.BITCOIN_RPC_USER
            || !process.env.BITCOIN_RPC_PASS
            || !process.env.BITCOIN_NETWORK
            || !process.env.BITCOIN_RPC_WALLET
        ) {
            Promise.reject("Bitcoin Node environment variables not set");
        }
        const bitcoinCoreClient = new BitcoinCoreClient(
            process.env.BITCOIN_NETWORK as string,
            process.env.BITCOIN_RPC_HOST as string,
            process.env.BITCOIN_RPC_USER as string,
            process.env.BITCOIN_RPC_PASS as string,
            process.env.BITCOIN_RPC_PORT as string,
            process.env.BITCOIN_RPC_WALLET as string,
        );
        await issue(
            this.polkaBtc.api,
            this.polkaBtc.electrsAPI,
            bitcoinCoreClient,
            requester,
            amount
        );
        return true;
    }

}