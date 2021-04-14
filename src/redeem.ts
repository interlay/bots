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

    async issueIfNeeded(vaultCount: number, account: KeyringPair) {
        const accountId = this.polkaBtc.api.createType("AccountId", account.address);
        const minimumBalanceForHeartbeat = await this.getMinimumBalanceForHeartbeat(vaultCount);
        const redeemablePolkaSATBalance = new BN(btcToSat((await this.polkaBtc.treasury.balance(accountId)).toString()));
        if (redeemablePolkaSATBalance.lte(minimumBalanceForHeartbeat)) {
            this.issue.requestAndExecuteIssue(account, this.issueTopUpAmount);
        }
    }

    async performHeartbeatRedeems(account: KeyringPair): Promise<void> {
        if (!process.env.REDEEM_ADDRESS) {
            Promise.reject("Redeem Bitcoin address not set in the environment");
        }
        console.log(`[${new Date().toLocaleString()}] -----Performing heartbeat redeems-----`);
        const vaults = await this.polkaBtc.vaults.list();
        await this.issueIfNeeded(vaults.length, account);
        const amountToRedeem = this.polkaBtc.api.createType("Balance", (await this.getMinRedeemableAmount()).toString());
        for (const vault of vaults) {
            if (vault.issued_tokens.gte(amountToRedeem)) {
                try {
                    console.log(`[${new Date().toLocaleString()}] Requesting ${amountToRedeem}/${vault.issued_tokens} from ${vault.id.toString()}`);
                    const requestResult = await this.polkaBtc.redeem.request(
                        amountToRedeem,
                        process.env.REDEEM_ADDRESS as string,
                        vault.id
                    ).catch(error => { throw new Error(error) });
                    const redeemRequestId = requestResult.id.toString();
                    const opreturnData = stripHexPrefix(redeemRequestId);

                    // Wait at most one minute to receive the BTC transaction with the
                    // redeemed funds.
                    await this.polkaBtc.electrsAPI.waitForOpreturn(opreturnData, 2 * 60000, 5000)
                        .catch(_ => { throw new Error(`Redeem request was not executed, timeout expired`) });
                    this.vaultHeartbeats.set(vault.id.toString(), Date.now());
                } catch (error) {
                    console.log(`Error: ${error}`);
                }

            }
        }
    }

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