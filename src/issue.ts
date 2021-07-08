import { InterBTCAPI, issueSingle, BitcoinCoreClient, BitcoinNetwork } from "@interlay/interbtc";
import { BTCAmount, Polkadot } from "@interlay/monetary-js";
import { KeyringPair } from "@polkadot/keyring/types";
import Big from "big.js";
import _ from 'underscore';

import { LOAD_TEST_ISSUE_AMOUNT } from "./consts";
import { sleep, waitForEmptyMempool } from "./utils";

export class Issue {
    interBtc: InterBTCAPI;
    private redeemDustValue: BTCAmount | undefined;

    constructor(interBtc: InterBTCAPI) {
        this.interBtc = interBtc;
    }

    async request(requester: KeyringPair) {
        console.log(`[${new Date().toLocaleString()}] -----Requesting issue...-----`);

        const requesterAccountId = this.interBtc.api.createType(
            "AccountId",
            requester.address
        );
        const balance = await this.interBtc.tokens.balance(Polkadot, requesterAccountId);
        console.log(
            `[${new Date().toLocaleString()}] DOT balance (${requester.address
            }): ${balance}`
        );
        try {
            await this.interBtc.issue.request(BTCAmount.from.BTC(LOAD_TEST_ISSUE_AMOUNT));
            console.log(
                `[${new Date().toLocaleString()}] Sent issue request for ${LOAD_TEST_ISSUE_AMOUNT.toFixed(
                    8
                )} InterBTC`
            );
        } catch (e) {
            console.log(
                `[${new Date().toLocaleString()}] Error making issue request: ${e}`
            );
        }
    }

    async requestAndExecuteIssue(
        requester: KeyringPair,
        amount: BTCAmount,
        bitcoinCoreClient: BitcoinCoreClient,
        btcNetwork: BitcoinNetwork,
        vaultAddress?: string
    ): Promise<boolean> {
        try {
            console.log(`issuing: ${amount.toString()} BTC`);
            await issueSingle(
                this.interBtc.api,
                this.interBtc.electrsAPI,
                bitcoinCoreClient,
                requester,
                amount,
                vaultAddress,
                undefined,
                undefined,
                btcNetwork
            );
            return true;
        } catch (error) {
            console.log(error);
        }
        return false;
    }

    async getCachedRedeemDustValue(): Promise<BTCAmount> {
        if (!this.redeemDustValue) {
            this.redeemDustValue = await this.interBtc.redeem.getDustValue();
        }
        return this.redeemDustValue;
    }

    increaseByFiftyPercent(x: BTCAmount): BTCAmount {
        return x.mul(new Big(15)).div(new Big(10));
    }

    async getAmountToIssue(): Promise<BTCAmount> {
        const redeemDustValue = await this.getCachedRedeemDustValue();
        // We need to account for redeem fees to redeem later
        const bitcoinNetworkFees = await this.interBtc.redeem.getCurrentInclusionFee();
        const redeemBridgeFee = await this.interBtc.redeem.getFeesToPay(redeemDustValue);
        const issueBridgeFee = await this.interBtc.issue.getFeesToPay(redeemDustValue);
        // Return 10% more than the redeem dust amount, as some of it gets lost to fees.
        return this.increaseByFiftyPercent(redeemDustValue).add(bitcoinNetworkFees).add(redeemBridgeFee).add(issueBridgeFee);
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
        btcNetwork: BitcoinNetwork,
        btcRpcWallet: string
    ): Promise<void> {
        if(!this.interBtc.vaults) {
            console.log("Parachain not connected");
            return;
        }
        console.log(`[${new Date().toLocaleString()}] -----Performing heartbeat issues-----`);
        const bitcoinCoreClient = new BitcoinCoreClient(
            btcNetwork,
            btcHost,
            btcRpcUser,
            btcRpcPass,
            btcRpcPort,
            btcRpcWallet
        );
        const vaults = _.shuffle(await this.interBtc.vaults.list());
        const amountToIssue = await this.getAmountToIssue();
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