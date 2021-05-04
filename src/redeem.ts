import { PolkaBTCAPI, btcToSat, stripHexPrefix } from "@interlay/polkabtc";
import { KeyringPair } from "@polkadot/keyring/types";
import * as polkabtcStats from '@interlay/polkabtc-stats';
import Big from "big.js";
import BN from "bn.js";

import { REDEEM_AMOUNT } from "./config";
import { MS_IN_AN_HOUR } from "./consts";
import { Issue } from "./issue";

export class Redeem {
    vaultHeartbeats = new Map<string, number>();
    issue: Issue;
    private redeemDustValue: BN | undefined;
    polkaBtc: PolkaBTCAPI;
    constructor(polkaBtc: PolkaBTCAPI, private issueTopUpAmount = new Big(1)) {
        this.issue = new Issue(polkaBtc);
        this.polkaBtc = polkaBtc;
    }

    async getCachedRedeemDustValue(): Promise<BN> {
        if (!this.redeemDustValue) {
            this.redeemDustValue = new BN((await this.polkaBtc.redeem.getDustValue()).toString());
        }
        return this.redeemDustValue;
    }

    increaseByTenPercent(x: BN): BN {
        return x.mul(new BN(11)).div(new BN(10));
    }

    async getMinimumBalanceForHeartbeat(vaultCount?: number): Promise<BN> {
        const redeemDustValue = await this.getCachedRedeemDustValue();
        if (vaultCount === undefined) {
            const vaults = await this.polkaBtc.vaults.list();
            vaultCount = vaults.length;
        }
        // Assume all vaults are online, so the bot needs more than `redeemDustValue * vaultCount`
        // to redeem from all. Thus, we add a 10% buffer to that minimum.
        return this.increaseByTenPercent(redeemDustValue.mul(new BN(vaultCount)));
    }

    async getMinRedeemableAmount(): Promise<BN> {
        const redeemDustValue = await this.getCachedRedeemDustValue();
        // Redeeming exactly `redeemDustValue` fails, so increase this value by 10%
        return this.increaseByTenPercent(redeemDustValue);
    }

    async request(): Promise<void> {
        if (!process.env.REDEEM_ADDRESS) {
            Promise.reject("Redeem Bitcoin address not set in the environment");
        }
        console.log(`[${new Date().toLocaleString()}] requesting redeem...`);
        const amountAsSatoshiString = btcToSat(REDEEM_AMOUNT.toString());
        const amountAsSatoshi = this.polkaBtc.api.createType(
            "Balance",
            amountAsSatoshiString
        );
        try {
            await this.polkaBtc.redeem.request(amountAsSatoshi, process.env.REDEEM_ADDRESS as string);
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

    async executePendingRedeems(): Promise<void> {
        if (!process.env.STATS_URL) {
            Promise.reject("polkabtc-stats URL not set in the environment");
        }
        console.log(`[${new Date().toLocaleString()}] -----Executing pending redeems-----`);
        const statsApi = new polkabtcStats.StatsApi(new polkabtcStats.Configuration({ basePath: process.env.STATS_URL as string }));
        const redeems = (await statsApi.getRedeems(0, Number.MAX_SAFE_INTEGER)).data;
        const expiredRedeemsWithBtcTx = redeems.filter(
            redeem =>
                !redeem.completed
                && !redeem.cancelled
                && redeem.btcTxId !== ""
        )
        for (let request of expiredRedeemsWithBtcTx) {
            try {
                await this.polkaBtc.redeem.execute(request.id, request.btcTxId);
                this.vaultHeartbeats.set(request.vaultDotAddress, Date.now());
                console.log(`Successfully executed redeem ${request.id}`);
            } catch (error) {
                console.log(`Failed to execute redeem ${request.id}: ${error.toString()}`);
            }
        }
    }

    async issueIfNeeded(
        vaultCount: number,
        account: KeyringPair,
        btcHost: string,
        btcRpcPort: string,
        btcRpcUSer: string,
        btcRpcPass: string,
        btcNetwork: string,
        btcRpcWallet: string
    ) {
        const accountId = this.polkaBtc.api.createType("AccountId", account.address);
        const minimumBalanceForHeartbeat = await this.getMinimumBalanceForHeartbeat(vaultCount);
        const redeemablePolkaSATBalance = new BN(btcToSat((await this.polkaBtc.treasury.balance(accountId)).toString()));
        if (redeemablePolkaSATBalance.lte(minimumBalanceForHeartbeat)) {
            console.log(`[${new Date().toLocaleString()}] -----Issuing tokens to redeem later-----`);
            await this.issue.requestAndExecuteIssue(
                account,
                this.issueTopUpAmount,
                btcHost,
                btcRpcPort,
                btcRpcUSer,
                btcRpcPass,
                btcNetwork,
                btcRpcWallet
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
        btcRpcUSer: string,
        btcRpcPass: string,
        btcNetwork: string,
        btcRpcWallet: string
    ): Promise<void> {
        console.log(`[${new Date().toLocaleString()}] -----Performing heartbeat redeems-----`);
        const vaults = await this.polkaBtc.vaults.list();
        await this.issueIfNeeded(
            vaults.length,
            account,
            btcHost,
            btcRpcPort,
            btcRpcUSer,
            btcRpcPass,
            btcNetwork,
            btcRpcWallet
        );
        const amountToRedeem = this.polkaBtc.api.createType("Balance", (await this.getMinRedeemableAmount()).toString());
        for (const vault of vaults.reverse()) {
            if (vault.issued_tokens.gte(amountToRedeem)) {
                try {
                    console.log(`[${new Date().toLocaleString()}] Requesting ${amountToRedeem} out of ${vault.issued_tokens} InterSatoshi from ${vault.id.toString()}`);
                    const requestResult = await this.polkaBtc.redeem.request(
                        amountToRedeem,
                        redeemAddress,
                        vault.id
                    ).catch(error => { throw new Error(error) });
                    const redeemRequestId = requestResult.id.toString();
                    const opreturnData = stripHexPrefix(redeemRequestId);

                    // Wait at most two minutes to receive the BTC transaction with the
                    // redeemed funds.
                    await this.polkaBtc.electrsAPI.waitForOpreturn(opreturnData, 60000, 5000)
                        .catch(_ => { throw new Error(`Redeem request was not executed, timeout expired`) });
                    this.vaultHeartbeats.set(vault.id.toString(), Date.now());
                } catch (error) {
                    console.log(`Error: ${error}`);
                }

            }
        }
    }

    /**
     * A vault is considered alive if it successfully fulfilled a redeem
     * requested by this bot within the last hour.
     * @returns An array of [vault_id, last_active_date] tuples, where the 
     * `last_active_date` is measured in milliseconds since the Unix epoch.
     */
    async getAliveVaults(): Promise<[string, number][]> {
        const offlineThreshold = new Date(Date.now() - MS_IN_AN_HOUR);
        const aliveVaults: [string, number][] = [];
        for (const [key, value] of this.vaultHeartbeats.entries()) {
            if (value >= offlineThreshold.getTime()) {
                aliveVaults.push([key, value]);
            }
        }
        return aliveVaults;
    }
}