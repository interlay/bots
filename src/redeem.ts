import { PolkaBTCAPI, btcToSat, stripHexPrefix, BitcoinCoreClient } from "@interlay/polkabtc";
import { KeyringPair } from "@polkadot/keyring/types";
import * as polkabtcStats from '@interlay/polkabtc-stats';
import Big from "big.js";
import BN from "bn.js";
import _ from "underscore";

import { MS_IN_AN_HOUR, LOAD_TEST_REDEEM_AMOUNT } from "./consts";
import { Issue } from "./issue";

export class Redeem {
    vaultHeartbeats = new Map<string, number>();
    issue: Issue;
    private redeemDustValue: Big | undefined;
    polkaBtc: PolkaBTCAPI;
    constructor(polkaBtc: PolkaBTCAPI, private issueTopUpAmount = new Big(1)) {
        this.issue = new Issue(polkaBtc);
        this.polkaBtc = polkaBtc;
    }

    async getCachedRedeemDustValue(): Promise<Big> {
        if (!this.redeemDustValue) {
            this.redeemDustValue = await this.polkaBtc.redeem.getDustValue();
        }
        return this.redeemDustValue;
    }

    increaseByTenPercent(x: Big): Big {
        return x.mul(new Big(11)).div(new Big(10));
    }

    async getMinimumBalanceForHeartbeat(vaultCount?: number): Promise<Big> {
        if(!this.polkaBtc.vaults) {
            console.log("Parachain not connected");
            return new Big(0);
        }
        const redeemDustValue = await this.getCachedRedeemDustValue();
        if (vaultCount === undefined) {
            const vaults = await this.polkaBtc.vaults.list();
            vaultCount = vaults.length;
        }
        // Assume all vaults are online, so the bot needs more than `redeemDustValue * vaultCount`
        // to redeem from all. Thus, we add a 10% buffer to that minimum.
        return this.increaseByTenPercent(redeemDustValue.mul(new Big(vaultCount)));
    }

    async getMinRedeemableAmount(): Promise<Big> {
        const redeemDustValue = await this.getCachedRedeemDustValue();
        const bitcoinNetworkFees = await this.polkaBtc.redeem.getCurrentInclusionFee();
        // Redeeming exactly `redeemDustValue` fails, so increase this value by 10%
        return this.increaseByTenPercent(redeemDustValue).add(bitcoinNetworkFees);
    }

    async request(): Promise<void> {
        if (!process.env.REDEEM_ADDRESS) {
            Promise.reject("Redeem Bitcoin address not set in the environment");
        }
        console.log(`[${new Date().toLocaleString()}] requesting redeem...`);
        try {
            await this.polkaBtc.redeem.request(new Big(LOAD_TEST_REDEEM_AMOUNT), process.env.REDEEM_ADDRESS as string);
            console.log(
                `[${new Date().toLocaleString()}] Sent redeem request for ${LOAD_TEST_REDEEM_AMOUNT.toFixed(
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
        bitcoinCoreClient: BitcoinCoreClient,
        btcNetwork: string,
    ) {
        const accountId = this.polkaBtc.api.createType("AccountId", account.address);
        const minimumBalanceForHeartbeat = await this.getMinimumBalanceForHeartbeat(vaultCount);
        const redeemablePolkaBTCBalance = await this.polkaBtc.treasury.balance(accountId);
        if (redeemablePolkaBTCBalance.lte(minimumBalanceForHeartbeat)) {
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
        btcNetwork: string,
        btcRpcWallet: string,
        timeoutMinutes = 2
    ): Promise<void> {
        if(!this.polkaBtc.vaults) {
            console.log("Parachain not connected");
            return;
        }
        console.log(`[${new Date().toLocaleString()}] -----Performing heartbeat redeems-----`);
        const vaults = _.shuffle(await this.polkaBtc.vaults.list());
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
            if (vault.issued_tokens.gte(new BN(btcToSat(amountToRedeem.toString())))) {
                try {
                    console.log(`[${new Date().toLocaleString()}] Redeeming ${btcToSat(amountToRedeem.toString())} out of ${vault.issued_tokens} InterSatoshi from ${vault.id.toString()}`);
                    const requestResult = await this.polkaBtc.redeem.request(
                        amountToRedeem,
                        redeemAddress,
                        vault.id
                    ).catch(error => { throw new Error(error) });
                    const redeemRequestId = requestResult.id.toString();
                    const opreturnData = stripHexPrefix(redeemRequestId);

                    // Wait at most `timeoutMinutes` minutes to receive the BTC transaction with the
                    // redeemed funds.
                    await this.polkaBtc.electrsAPI.waitForOpreturn(opreturnData, timeoutMinutes * 60000, 5000)
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
