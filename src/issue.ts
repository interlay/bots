import { PolkaBTCAPI, btcToSat, issue, BitcoinCoreClient, satToBTC } from "@interlay/polkabtc";
import { KeyringPair } from "@polkadot/keyring/types";
import Big from "big.js";
import BN from "bn.js";
import _ from 'underscore';

import { LOAD_TEST_ISSUE_AMOUNT } from "./consts";
import { sleep, waitForEmptyMempool } from "./utils";

export class Issue {
    polkaBtc: PolkaBTCAPI;
    private redeemDustValue: BN | undefined;

    constructor(polkaBtc: PolkaBTCAPI) {
        this.polkaBtc = polkaBtc;
    }

    async request(requester: KeyringPair) {
        console.log(`[${new Date().toLocaleString()}] -----Requesting issue...-----`);
        const amountAsSatoshiString = btcToSat(LOAD_TEST_ISSUE_AMOUNT.toString());

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
                `[${new Date().toLocaleString()}] Sent issue request for ${LOAD_TEST_ISSUE_AMOUNT.toFixed(
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
        bitcoinCoreClient: BitcoinCoreClient,
        btcNetwork: string,
        vaultAddress?: string
    ): Promise<boolean> {
        await issue(
            this.polkaBtc.api,
            this.polkaBtc.electrsAPI,
            bitcoinCoreClient,
            requester,
            amount,
            vaultAddress,
            undefined,
            undefined,
            btcNetwork
        );
        return true;
    }

    async getCachedRedeemDustValue(): Promise<BN> {
        if (!this.redeemDustValue) {
            this.redeemDustValue = new BN((await this.polkaBtc.redeem.getDustValue()).toString());
        }
        return this.redeemDustValue;
    }

    increaseByFiftyPercent(x: BN): BN {
        return x.mul(new BN(3)).div(new BN(2));
    }

    async getAmountToIssue(): Promise<BN> {
        const redeemDustValue = await this.getCachedRedeemDustValue();
        // Return 50% more than the redeem dust amount, as some of it gets lost to fees.
        return this.increaseByFiftyPercent(redeemDustValue);
    }

    /**
     * A heartbeat issue is an issue request made periodically to each registered vault.
     * This request is used to determine which vaults are still operating. 
     * This function is not stateless in that it
     * updates the `vaultHeartbeats` map each time it is run.
     * 
     * @param account A KeyringPair object used for signing issue and redeem requests
     */
     async performHeartbeatIssues(
        account: KeyringPair,
        btcHost: string,
        btcRpcPort: string,
        btcRpcUser: string,
        btcRpcPass: string,
        btcNetwork: string,
        btcRpcWallet: string
    ): Promise<void> {
        console.log(`[${new Date().toLocaleString()}] -----Performing heartbeat issues-----`);
        const bitcoinCoreClient = new BitcoinCoreClient(
            btcNetwork,
            btcHost,
            btcRpcUser,
            btcRpcPass,
            btcRpcPort,
            btcRpcWallet
        );
        const vaults = _.shuffle(await this.polkaBtc.vaults.list());
        const amountToIssue = new Big(satToBTC((await this.getAmountToIssue()).toString()));
        for (const vault of vaults) {
                try {
                    console.log(`[${new Date().toLocaleString()}] Issuing ${amountToIssue} InterBTC with ${vault.id.toString()}`);
                    this.requestAndExecuteIssue(
                        account,
                        amountToIssue,
                        bitcoinCoreClient,
                        btcNetwork,
                        vault.id.toString()
                    );
                    // Wait for issue request to be broadcast
                    await sleep(60000);
                } catch (error) {
                    console.log(`Error: ${error}`);
                }
        }
    }
}