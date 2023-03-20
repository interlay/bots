import {
  InterBtcApi,
  issueSingle,
  BitcoinCoreClient,
  BitcoinNetwork,
  InterbtcPrimitivesVaultId,
  WrappedCurrency,
  newMonetaryAmount,
  encodeVaultId,
} from "@interlay/interbtc-api";
import { Currency, MonetaryAmount } from "@interlay/monetary-js";
import { KeyringPair } from "@polkadot/keyring/types";
import Big from "big.js";
import _ from "underscore";

import { LOAD_TEST_ISSUE_AMOUNT } from "./consts";
import logger from "./logger";
import { sleep } from "./utils";

export class Issue {
  interBtcApi: InterBtcApi;
  private redeemDustValue:
    | MonetaryAmount<WrappedCurrency>
    | undefined;

  constructor(interBtc: InterBtcApi) {
    this.interBtcApi = interBtc;
  }

  async request(requester: KeyringPair) {
    logger.info("Requesting issue...");

    const requesterAccountId = this.interBtcApi.api.createType(
      "AccountId",
      requester.address
    );
    const collateralCurrency = this.interBtcApi.api.consts.currency.getRelayChainCurrencyId;
    const balance = await this.interBtcApi.tokens.balance(
      collateralCurrency,
      requesterAccountId
    );
    logger.info(
      `${balance.currency.ticker} balance (${requester.address}): ${balance}`
    );
    try {
      const amountToIssue = newMonetaryAmount(
        LOAD_TEST_ISSUE_AMOUNT,
        this.interBtcApi.getWrappedCurrency(),
        true
      );
      await this.interBtcApi.issue.request(amountToIssue);
      logger.info(
        `Sent issue request for ${amountToIssue.toHuman()} ${
          amountToIssue.currency.ticker
        }`
      );
      logger.info(
        `${balance.currency.ticker} balance (${requester.address}): ${balance}`
      );
    } catch (e) {
      logger.error(`Error making issue request: ${e}`);
    }
  }

  async requestAndExecuteIssue(
    requester: KeyringPair,
    amount: MonetaryAmount<WrappedCurrency>,
    bitcoinCoreClient: BitcoinCoreClient,
    vaultId?: InterbtcPrimitivesVaultId
  ): Promise<boolean> {
    try {
      const issueRequest = await issueSingle(
        this.interBtcApi,
        bitcoinCoreClient,
        requester,
        amount,
        vaultId
      );
      logger.info(`Executed issue: ${issueRequest.request.id}`);
      return true;
    } catch (error) {
      logger.error(`Error issuing ${amount.currency.ticker}`);
      logger.error(error);
    }
    return false;
  }

  async getCachedRedeemDustValue(): Promise<
    MonetaryAmount<WrappedCurrency>
  > {
    if (!this.redeemDustValue) {
      this.redeemDustValue = await this.interBtcApi.redeem.getDustValue();
    }
    return this.redeemDustValue;
  }

  increaseByFiftyPercent(
    x: MonetaryAmount<Currency>
  ): MonetaryAmount<Currency> {
    return x.mul(new Big(15)).div(new Big(10));
  }

  async getAmountToIssue(): Promise<
    MonetaryAmount<WrappedCurrency>
  > {
    const redeemDustValue = await this.getCachedRedeemDustValue();
    // We need to account for redeem fees to redeem later
    const bitcoinNetworkFees =
      await this.interBtcApi.redeem.getCurrentInclusionFee();
    const redeemBridgeFee = await this.interBtcApi.redeem.getFeesToPay(
      redeemDustValue
    );
    const issueBridgeFee = await this.interBtcApi.issue.getFeesToPay(
      redeemDustValue
    );
    // Return 10% more than the redeem dust amount, as some of it gets lost to fees.
    return this.increaseByFiftyPercent(redeemDustValue)
      .add(bitcoinNetworkFees)
      .add(redeemBridgeFee)
      .add(issueBridgeFee);
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
    if (!this.interBtcApi.vaults) {
      logger.info("Parachain not connected");
      return;
    }
    logger.info(`Performing heartbeat issues...`);
    const bitcoinCoreClient = new BitcoinCoreClient(
      btcNetwork,
      btcHost,
      btcRpcUser,
      btcRpcPass,
      btcRpcPort,
      btcRpcWallet
    );
    const vaults = _.shuffle(await this.interBtcApi.vaults.list());
    const amountToIssue = await this.getAmountToIssue();
    logger.info(`There are ${vaults.length} registered vaults.`);
    for (const vault of vaults) {
      try {
        logger.info(
          `Issuing ${amountToIssue.toString(false)} ${
            amountToIssue.currency.ticker
          } with vault ID ${encodeVaultId(this.interBtcApi.assetRegistry, this.interBtcApi.loans, vault.id)}`
        );
        this.requestAndExecuteIssue(
          account,
          amountToIssue,
          bitcoinCoreClient,
          vault.id
        );
        // Wait for issue request to be broadcast
        await sleep(60000);
      } catch (error) {
        logger.error(error);
      }
    }
  }
}
