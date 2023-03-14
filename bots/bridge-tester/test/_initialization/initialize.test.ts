import { ApiPromise, Keyring } from "@polkadot/api";
import { KeyringPair } from "@polkadot/keyring/types";
import { assert } from "chai";

import {
  BitcoinCoreClient,
  issueSingle,
  InterBtcApi,
  DefaultInterBtcApi,
  createSubstrateAPI,
  WrappedCurrency,
  newMonetaryAmount,
  InterbtcPrimitivesVaultId,
  newVaultId,
  CollateralCurrencyExt
} from "@interlay/interbtc-api";
import {
  DEFAULT_PARACHAIN_ENDPOINT,
  DEFAULT_BITCOIN_CORE_NETWORK,
  DEFAULT_BITCOIN_CORE_HOST,
  DEFAULT_BITCOIN_CORE_USERNAME,
  DEFAULT_BITCOIN_CORE_PASSWORD,
  DEFAULT_BITCOIN_CORE_PORT,
  DEFAULT_BITCOIN_CORE_WALLET,
  DEFAULT_SUDO_URI,
  DEFAULT_USER_1_URI,
} from "../config";
import { u32 } from "@polkadot/types-codec";

describe.skip("Initialize parachain state", () => {
  let api: ApiPromise;
  let bitcoinCoreClient: BitcoinCoreClient;
  let keyring: Keyring;
  let userInterBtcApi: InterBtcApi;
  let wrappedCurrency: WrappedCurrency;
  let collateralCurrency: CollateralCurrencyExt;
  let vault_id: InterbtcPrimitivesVaultId;

  let sudoAccount: KeyringPair;
  let user1Account: KeyringPair;
  let charlie_stash: KeyringPair;

  function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  before(async function () {
    api = await createSubstrateAPI(DEFAULT_PARACHAIN_ENDPOINT);
    keyring = new Keyring({ type: "sr25519" });
    // Alice is also the root account
    user1Account = keyring.addFromUri(DEFAULT_USER_1_URI);
    charlie_stash = keyring.addFromUri("//Charlie//stash");
    sudoAccount = keyring.addFromUri(DEFAULT_SUDO_URI);

    bitcoinCoreClient = new BitcoinCoreClient(
      DEFAULT_BITCOIN_CORE_NETWORK,
      DEFAULT_BITCOIN_CORE_HOST,
      DEFAULT_BITCOIN_CORE_USERNAME,
      DEFAULT_BITCOIN_CORE_PASSWORD,
      DEFAULT_BITCOIN_CORE_PORT,
      DEFAULT_BITCOIN_CORE_WALLET
    );
    userInterBtcApi = new DefaultInterBtcApi(api, "regtest", user1Account);
    wrappedCurrency = userInterBtcApi.getWrappedCurrency();
    collateralCurrency = userInterBtcApi.api.consts.currency.getRelayChainCurrencyId;
    vault_id = newVaultId(
      api,
      charlie_stash.address,
      collateralCurrency,
      wrappedCurrency
    );
    // Sleep for 2 min to wait for vaults to register
    // await sleep(2 * 60 * 1000);
  });

  after(async () => {
    api.disconnect();
  });

    it("should set the stable confirmations and ready the BTC-Relay", async () => {
        // Speed up the process by only requiring 0 parachain and 0 bitcoin confirmations
        const stableBitcoinConfirmationsToSet = 0;
        const stableParachainConfirmationsToSet = 0;
        let [stableBitcoinConfirmations, stableParachainConfirmations] = await Promise.all([
            userInterBtcApi.btcRelay.getStableBitcoinConfirmations(),
            userInterBtcApi.btcRelay.getStableParachainConfirmations(),
        ]);

        if (stableBitcoinConfirmations != 0 || stableParachainConfirmations != 0) {
            console.log("Initializing stable block confirmations...");
            await setRawStorage(
                api,
                api.query.btcRelay.stableBitcoinConfirmations.key(),
                api.createType("u32", stableBitcoinConfirmationsToSet),
                sudoAccount
            );
            await setRawStorage(
                api,
                api.query.btcRelay.stableParachainConfirmations.key(),
                api.createType("u32", stableParachainConfirmationsToSet),
                sudoAccount
            );
            await bitcoinCoreClient.mineBlocks(3);
            [stableBitcoinConfirmations, stableParachainConfirmations] = await Promise.all([
                userInterBtcApi.btcRelay.getStableBitcoinConfirmations(),
                userInterBtcApi.btcRelay.getStableParachainConfirmations(),
            ]);
        }
        assert.equal(
            stableBitcoinConfirmationsToSet,
            stableBitcoinConfirmations,
            "Setting the Bitcoin confirmations failed"
        );
        assert.equal(
            stableParachainConfirmationsToSet,
            stableParachainConfirmations,
            "Setting the Parachain confirmations failed"
        );
    });


  it("should issue 0.1 InterBTC", async () => {
    const wrappedToIssue = newMonetaryAmount(0.00007, wrappedCurrency, true);
    await issueSingle(
      userInterBtcApi,
      bitcoinCoreClient,
      user1Account,
      wrappedToIssue,
      vault_id
    );
  });
});
function setRawStorage(api: ApiPromise, arg1: string, arg2: u32, sudoAccount: KeyringPair) {
  throw new Error("Function not implemented.");
}

