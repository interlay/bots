import { InterBTCAPI, stripHexPrefix, BitcoinCoreClient, sleep, BitcoinNetwork } from "@interlay/interbtc";
import { KeyringPair } from "@polkadot/keyring/types";
import { H256 } from "@polkadot/types/interfaces";
import * as interbtcStats from '@interlay/interbtc-index-client';
import Big from "big.js";
import _ from "underscore";

import { MS_IN_AN_HOUR, LOAD_TEST_REDEEM_AMOUNT } from "./consts";
import { Issue } from "./issue";
import { Bitcoin, BTCAmount } from "@interlay/monetary-js";

export class Redeem {
    vaultHeartbeats = new Map<string, number>();
    issue: Issue;
    private redeemDustValue: BTCAmount | undefined;
    interBtc: InterBTCAPI;
    expiredRedeemRequests: H256[] = [];
    constructor(interBtc: InterBTCAPI, private issueTopUpAmount = BTCAmount.from.BTC(1)) {
        this.issue = new Issue(interBtc);
        this.interBtc = interBtc;
    }

    async getCachedRedeemDustValue(): Promise<BTCAmount> {
        if (!this.redeemDustValue) {
            this.redeemDustValue = await this.interBtc.redeem.getDustValue();
        }
        return this.redeemDustValue;
    }

    increaseByThirtyPercent(x: BTCAmount): BTCAmount {
        return x.mul(new Big(13)).div(new Big(10));
    }

    async getMinimumBalanceForHeartbeat(vaultCount?: number): Promise<BTCAmount> {
        if(!this.interBtc.vaults) {
            console.log("Parachain not connected");
            return BTCAmount.zero;
        }
        const redeemDustValue = await this.getCachedRedeemDustValue();
        if (vaultCount === undefined) {
            const vaults = await this.interBtc.vaults.list();
            vaultCount = vaults.length;
        }
        // Assume all vaults are online, so the bot needs more than `redeemDustValue * vaultCount`
        // to redeem from all. Thus, we add a 10% buffer to that minimum.
        return this.increaseByThirtyPercent(redeemDustValue.mul(new Big(vaultCount)));
    }

    async getMinRedeemableAmount(): Promise<BTCAmount> {
        const redeemDustValue = await this.getCachedRedeemDustValue();
        const bitcoinNetworkFees = await this.interBtc.redeem.getCurrentInclusionFee();
        const bridgeFee = await this.interBtc.redeem.getFeesToPay(redeemDustValue);
        // Redeeming exactly `redeemDustValue` fails, so increase this value by 10%
        return this.increaseByThirtyPercent(redeemDustValue).add(bitcoinNetworkFees).add(bridgeFee);
    }

    async request(): Promise<void> {
        if (!process.env.REDEEM_ADDRESS) {
            Promise.reject("Redeem Bitcoin address not set in the environment");
        }
        console.log(`[${new Date().toLocaleString()}] requesting redeem...`);
        try {
            await this.interBtc.redeem.request(BTCAmount.from.BTC(LOAD_TEST_REDEEM_AMOUNT), process.env.REDEEM_ADDRESS as string);
            console.log(
                `[${new Date().toLocaleString()}] Sent redeem request for ${LOAD_TEST_REDEEM_AMOUNT.toFixed(
                    8
                )} InterBTC`
            );
        } catch (e) {
            console.log(
                `[${new Date().toLocaleString()}] Error making redeem request: ${e}`
            );
        }
    }

    // async executePendingRedeems(): Promise<void> {
    //     if (!process.env.STATS_URL) {
    //         Promise.reject("interbtc-stats URL not set in the environment");
    //     }
    //     console.log(`[${new Date().toLocaleString()}] -----Executing pending redeems-----`);
    //     const statsApi = new interbtcStats.StatsApi(new interbtcStats.Configuration({ basePath: process.env.STATS_URL as string }));
    //     const redeems = (await statsApi.getRedeems({ page: 0, perPage: Number.MAX_SAFE_INTEGER }));
    //     const expiredRedeemsWithBtcTx = redeems.filter(
    //         redeem =>
    //             !redeem.completed
    //             && !redeem.cancelled
    //             && redeem.btcTxId !== ""
    //     )
    //     for (let request of expiredRedeemsWithBtcTx) {
    //         try {
    //             await this.interBtc.redeem.execute(request.id, request.btcTxId);
    //             this.vaultHeartbeats.set(request.vaultDotAddress, Date.now());
    //             console.log(`Successfully executed redeem ${request.id}`);
    //         } catch (error) {
    //             console.log(`Failed to execute redeem ${request.id}: ${error.toString()}`);
    //         }
    //     }
    // }

    async issueIfNeeded(
        vaultCount: number,
        account: KeyringPair,
        bitcoinCoreClient: BitcoinCoreClient,
        btcNetwork: BitcoinNetwork,
    ) {
        const accountId = this.interBtc.api.createType("AccountId", account.address);
        const minimumBalanceForHeartbeat = await this.getMinimumBalanceForHeartbeat(vaultCount);
        const redeemableInterBTCBalance = await this.interBtc.tokens.balance(Bitcoin, accountId);
        if (redeemableInterBTCBalance.lte(minimumBalanceForHeartbeat)) {
            console.log(`[${new Date().toLocaleString()}] -----Issuing tokens to redeem later-----`);
            this.issue.requestAndExecuteIssue(
                account,
                this.issueTopUpAmount,
                bitcoinCoreClient,
                btcNetwork,
            );
        }
    }

    /**
     * A heartbeat redeem is a redeem request made periodically to each vault that issued
     * at least the redeem dust amount of tokens. This request is used to determine
     * which vaults are still operating. This function is not stateless in that it
     * updates the `vaultHeartbeats` map each time it is run. However, a redeem request
     * is sent to each vault with redeemable capacity, regardless of their previous 
     * uptime.
     * In case the `account` parameter does not have enough tokens to perform 
     * heartbeat redeems, it will issue enough to redeem once from each registered vault.
     * 
     * @param account A KeyringPair object used for signing issue and redeem requests
     */
    async performHeartbeatRedeems(
        account: KeyringPair,
        redeemAddress: string,
        btcHost: string,
        btcRpcPort: string,
        btcRpcUser: string,
        btcRpcPass: string,
        btcNetwork: BitcoinNetwork,
        btcRpcWallet: string,
        timeoutMinutes = 2
    ): Promise<void> {
        if(!this.interBtc.vaults) {
            console.log("Parachain not connected");
            return;
        }
        console.log(`[${new Date().toLocaleString()}] -----Cancelling expired redeems-----`);
        const botAccountId = this.interBtc.api.createType("AccountId", account.address);
        this.interBtc.redeem.subscribeToRedeemExpiry(botAccountId, (requestRedeemId: H256) => {
            console.log(`adding ${requestRedeemId.toHuman()}`);
            this.expiredRedeemRequests.push(requestRedeemId)
        });
        await this.cancelExpiredRedeems();
        console.log(`[${new Date().toLocaleString()}] -----Performing heartbeat redeems-----`);
        const vaults = _.shuffle(await this.interBtc.vaults.list());
        const bitcoinCoreClient = new BitcoinCoreClient(
            btcNetwork,
            btcHost,
            btcRpcUser,
            btcRpcPass,
            btcRpcPort,
            btcRpcWallet
        );
        await this.issueIfNeeded(
            vaults.length,
            account,
            bitcoinCoreClient,
            btcNetwork
        );
        const amountToRedeem = await this.getMinRedeemableAmount();
        for (const vault of vaults) {
            try {
                const currentBlock = await this.interBtc.system.getCurrentBlockNumber();
                if (vault.banned_until.isSome && vault.banned_until.unwrap().toNumber() >= currentBlock) {
                    continue;
                }
                if (BTCAmount.from.Satoshi(vault.issued_tokens.toString()).gte(amountToRedeem)) {
                    console.log(`[${new Date().toLocaleString()}] Redeeming ${amountToRedeem.str.Satoshi()} out of ${vault.issued_tokens} InterSatoshi from ${vault.id.toString()}`);
                    const [requestResult] = await this.interBtc.redeem.request(
                        amountToRedeem,
                        redeemAddress,
                        vault.id
                    ).catch(error => { throw new Error(error) });
                    const redeemRequestId = requestResult.id.toString();
                    
                    // Wait at most `timeoutMinutes` minutes to receive the BTC transaction with the
                    // redeemed funds.
                    const opreturnData = stripHexPrefix(redeemRequestId);
                    await this.interBtc.electrsAPI.waitForOpreturn(opreturnData, timeoutMinutes * 60000, 5000)
                        .catch(_ => { throw new Error(`Redeem request was not executed, timeout expired`) });
                    this.vaultHeartbeats.set(vault.id.toString(), Date.now());
                }
            } catch (error) {
                console.log(`Error: ${error}`);
            }
        }
    }

    async cancelExpiredRedeems(): Promise<void> {
        const remainingExpiredRequests: H256[] = [];
        for(const redeemId of this.expiredRedeemRequests) {
            try {
                console.log(`[${new Date().toLocaleString()}] Retrying redeem with id ${redeemId.toHuman()}...`);
                // Cancel redeem request and receive DOT compensation
                await this.interBtc.redeem.cancel(redeemId.toString(), false);
            } catch (error) {
                remainingExpiredRequests.push(redeemId);
                console.log(`Error cancelling redeem ${redeemId.toHuman()}... : ${error}`);
            }
        }
        this.expiredRedeemRequests = remainingExpiredRequests;
    }

    /**
     * A vault is considered alive if it successfully fulfilled a redeem
     * requested by this bot within the last hour.
     * @returns An array of [vault_id, last_active_date] tuples, where the 
     * `last_active_date` is measured in milliseconds since the Unix epoch.
     */
    async getAliveVaults(): Promise<[string, number][]> {
        const offlineThreshold = new Date(Date.now() - 12 * MS_IN_AN_HOUR);
        const aliveVaults: [string, number][] = [];
        for (const [key, value] of this.vaultHeartbeats.entries()) {
            if (value >= offlineThreshold.getTime()) {
                aliveVaults.push([key, value]);
            }
        }
        return aliveVaults;
    }
}
