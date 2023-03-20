import {
  InterBtcApi,
  stripHexPrefix,
  BitcoinCoreClient,
  sleep,
  BitcoinNetwork,
  WrappedCurrency,
  newMonetaryAmount,
  encodeVaultId,
} from "@interlay/interbtc-api";
import { MonetaryAmount } from "@interlay/monetary-js";
import { KeyringPair } from "@polkadot/keyring/types";
import { H256 } from "@polkadot/types/interfaces";
import Big from "big.js";
import _ from "underscore";

import { MS_IN_AN_HOUR, LOAD_TEST_REDEEM_AMOUNT } from "./consts";
import { Issue } from "./issue";
import logger from "./logger";

export class Redeem {
  vaultHeartbeats = new Map<string, number>();
  issue: Issue;
  private redeemDustValue:
    | MonetaryAmount<WrappedCurrency>
    | undefined;
  interBtc: InterBtcApi;
  expiredRedeemRequests: H256[] = [];
  constructor(
    interBtc: InterBtcApi,
    private issueTopUpAmount: MonetaryAmount<WrappedCurrency>
  ) {
    this.issue = new Issue(interBtc);
    this.interBtc = interBtc;
  }

  async getCachedRedeemDustValue(): Promise<
    MonetaryAmount<WrappedCurrency>
  > {
    if (!this.redeemDustValue) {
      this.redeemDustValue = await this.interBtc.redeem.getDustValue();
    }
    return this.redeemDustValue;
  }

  increaseByThirtyPercent(
    x: MonetaryAmount<WrappedCurrency>
  ): MonetaryAmount<WrappedCurrency> {
    return x.mul(new Big(13)).div(new Big(10));
  }

  async getMinimumBalanceForHeartbeat(
    vaultCount?: number
  ): Promise<MonetaryAmount<WrappedCurrency>> {
    if (!this.interBtc.vaults) {
      logger.error("Parachain not connected");
      return newMonetaryAmount(0, this.interBtc.getWrappedCurrency());
    }
    const redeemDustValue = await this.getCachedRedeemDustValue();
    if (vaultCount === undefined) {
      const vaults = await this.interBtc.vaults.list();
      vaultCount = vaults.length;
    }
    // Assume all vaults are online, so the bot needs more than `redeemDustValue * vaultCount`
    // to redeem from all. Thus, we add a 10% buffer to that minimum.
    return this.increaseByThirtyPercent(
      redeemDustValue.mul(new Big(vaultCount))
    );
  }

  async getMinRedeemableAmount(): Promise<
    MonetaryAmount<WrappedCurrency>
  > {
    const redeemDustValue = await this.getCachedRedeemDustValue();
    const bitcoinNetworkFees =
      await this.interBtc.redeem.getCurrentInclusionFee();
    const bridgeFee = await this.interBtc.redeem.getFeesToPay(redeemDustValue);
    // Redeeming exactly `redeemDustValue` fails, so increase this value by 10%
    return this.increaseByThirtyPercent(redeemDustValue)
      .add(bitcoinNetworkFees)
      .add(bridgeFee);
  }

  async request(): Promise<void> {
    if (!process.env.REDEEM_ADDRESS) {
      Promise.reject("Redeem Bitcoin address not set in the environment");
    }
    logger.info(`Requesting redeem...`);
    const amountToRedeem = newMonetaryAmount(
      LOAD_TEST_REDEEM_AMOUNT,
      this.interBtc.getWrappedCurrency(),
      true
    );
    try {
      await this.interBtc.redeem.request(
        amountToRedeem,
        process.env.REDEEM_ADDRESS as string
      );
      logger.info(
        `Sent redeem request for ${amountToRedeem.toHuman()} ${
          amountToRedeem.currency.ticker
        }`
      );
    } catch (e) {
      logger.error(`Error making redeem request: ${e}`);
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
    btcNetwork: BitcoinNetwork
  ) {
    const accountId = this.interBtc.api.createType(
      "AccountId",
      account.address
    );
    const minimumBalanceForHeartbeat = await this.getMinimumBalanceForHeartbeat(
      vaultCount
    );
    const redeemableInterBTCBalance = await this.interBtc.tokens.balance(
      this.interBtc.getWrappedCurrency(),
      accountId
    );
    if (redeemableInterBTCBalance.free.lte(minimumBalanceForHeartbeat)) {
      logger.info(`Issuing tokens to redeem later...`);
      this.issue.requestAndExecuteIssue(
        account,
        this.issueTopUpAmount,
        bitcoinCoreClient,
        btcNetwork
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
    if (!this.interBtc.vaults) {
      logger.error("Parachain not connected");
      return;
    }
    // TODO: Uncomment once `subscribeToRedeemExpiry` is reimplemented in the lib
    // logger.info(`Cancelling expired redeems...`);
    // const botAccountId = this.interBtc.api.createType("AccountId", account.address);
    // this.interBtc.redeem.subscribeToRedeemExpiry(botAccountId, (requestRedeemId: H256) => {
    //     console.log(`adding ${requestRedeemId.toHuman()}`);
    //     this.expiredRedeemRequests.push(requestRedeemId)
    // });
    // await this.cancelExpiredRedeems();
    logger.info(`Performing heartbeat redeems...`);
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
    logger.info(`There are ${vaults.length} registered vaults.`);
    for (const vault of vaults) {
      try {
        const currentBlock = await this.interBtc.system.getCurrentBlockNumber();
        if (
          vault.bannedUntil !== undefined &&
          vault.bannedUntil >= currentBlock
        ) {
          continue;
        }
        const issuedTokens = newMonetaryAmount(
          vault.issuedTokens.toString(),
          this.interBtc.getWrappedCurrency()
        );

        if (issuedTokens.gte(amountToRedeem)) {
          logger.info(
            `Redeeming ${amountToRedeem.toHuman()} out of ${issuedTokens.toHuman()} from vault ID ${encodeVaultId(
              this.interBtc.assetRegistry,
              this.interBtc.loans,
              vault.id
            )}`
          );
          const [requestResult] = await this.interBtc.redeem
            .request(amountToRedeem, redeemAddress, vault.id)
            .catch((error) => {
              throw new Error(error);
            });
          logger.info(
            `Requested redeem: ${
              requestResult.id
            } from vault ID ${encodeVaultId(
              this.interBtc.assetRegistry,
              this.interBtc.loans,
              vault.id
            )}`
          );
          // TODO: Uncomment once redeems are executed quickly by vaults.
          // const redeemRequestId = requestResult.id.toString();

          // // Wait at most `timeoutMinutes` minutes to receive the BTC transaction with the
          // // redeemed funds.
          // const opreturnData = stripHexPrefix(redeemRequestId);
          // await this.interBtc.electrsAPI.waitForOpreturn(opreturnData, timeoutMinutes * 60000, 5000)
          //     .catch(_ => { throw new Error(`Redeem request was not executed, timeout expired`) });
          this.vaultHeartbeats.set(vault.id.toString(), Date.now());
        }
      } catch (error) {
        logger.error(error);
      }
    }
  }

  async cancelExpiredRedeems(): Promise<void> {
    const remainingExpiredRequests: H256[] = [];
    for (const redeemId of this.expiredRedeemRequests) {
      try {
        logger.info(`Retrying redeem with id ${redeemId.toHuman()}...`);
        // Cancel redeem request and receive collateral compensation
        await this.interBtc.redeem.cancel(redeemId.toString(), false);
      } catch (error) {
        remainingExpiredRequests.push(redeemId);
        logger.info(
          `Error cancelling redeem ${redeemId.toHuman()}... : ${error}`
        );
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
