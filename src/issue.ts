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

    async requestAndExecuteIssue(
        requester: KeyringPair,
        amount: Big,
        btcHost: string,
        btcRpcPort: string,
        btcRpcUser: string,
        btcRpcPass: string,
        btcNetwork: string,
        btcRpcWallet: string
    ): Promise<boolean> {
        const bitcoinCoreClient = new BitcoinCoreClient(
            btcNetwork,
            btcHost,
            btcRpcUser,
            btcRpcPass,
            btcRpcPort,
            btcRpcWallet
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