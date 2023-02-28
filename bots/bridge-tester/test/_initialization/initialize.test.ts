import { ApiPromise, Keyring } from "@polkadot/api";
import { KeyringPair } from "@polkadot/keyring/types";
import { assert } from "chai";
import BN from "bn.js";

import {
  BitcoinCoreClient,
  setNumericStorage,
  issueSingle,
  InterBtcApi,
  DefaultInterBtcApi,
  createSubstrateAPI,
  WrappedCurrency,
  newMonetaryAmount,
  InterbtcPrimitivesVaultId,
  newVaultId,
  CollateralCurrency,
  getCorrespondingCollateralCurrency,
} from "@interlay/interbtc-api";
import {
  DEFAULT_PARACHAIN_ENDPOINT,
  DEFAULT_BITCOIN_CORE_NETWORK,
  DEFAULT_BITCOIN_CORE_HOST,
  DEFAULT_BITCOIN_CORE_USERNAME,
  DEFAULT_BITCOIN_CORE_PASSWORD,
  DEFAULT_BITCOIN_CORE_PORT,
  DEFAULT_BITCOIN_CORE_WALLET,
} from "../config";

describe.skip("Initialize parachain state", () => {
  let api: ApiPromise;
  let bitcoinCoreClient: BitcoinCoreClient;
  let keyring: Keyring;
  let interBtcAPI: InterBtcApi;
  let wrappedCurrency: WrappedCurrency;
  let collateralCurrency: CollateralCurrency;
  let vault_id: InterbtcPrimitivesVaultId;

  let alice: KeyringPair;
  let bob: KeyringPair;
  let charlie_stash: KeyringPair;

  function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  before(async function () {
    api = await createSubstrateAPI(DEFAULT_PARACHAIN_ENDPOINT);
    keyring = new Keyring({ type: "sr25519" });
    // Alice is also the root account
    alice = keyring.addFromUri("//Alice");
    bob = keyring.addFromUri("//Bob");
    charlie_stash = keyring.addFromUri("//Charlie//stash");

    bitcoinCoreClient = new BitcoinCoreClient(
      DEFAULT_BITCOIN_CORE_NETWORK,
      DEFAULT_BITCOIN_CORE_HOST,
      DEFAULT_BITCOIN_CORE_USERNAME,
      DEFAULT_BITCOIN_CORE_PASSWORD,
      DEFAULT_BITCOIN_CORE_PORT,
      DEFAULT_BITCOIN_CORE_WALLET
    );
    interBtcAPI = new DefaultInterBtcApi(api, "regtest", alice);
    wrappedCurrency = interBtcAPI.getWrappedCurrency();
    collateralCurrency = getCorrespondingCollateralCurrency(
      interBtcAPI.getGovernanceCurrency()
    );
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

  it("should set the stable confirmations and ready the Btc Relay", async () => {
    // Speed up the process by only requiring 0 parachain and 0 bitcoin confirmations
    const stableBitcoinConfirmationsToSet = 0;
    const stableParachainConfirmationsToSet = 0;
    await setNumericStorage(
      api,
      "BTCRelay",
      "StableBitcoinConfirmations",
      new BN(stableBitcoinConfirmationsToSet),
      alice
    );
    await setNumericStorage(
      api,
      "BTCRelay",
      "StableParachainConfirmations",
      new BN(stableParachainConfirmationsToSet),
      alice
    );
    const stableBitcoinConfirmations =
      await interBtcAPI.btcRelay.getStableBitcoinConfirmations();
    assert.equal(
      stableBitcoinConfirmationsToSet,
      stableBitcoinConfirmations,
      "Setting the Bitcoin confirmations failed"
    );
    const stableParachainConfirmations =
      await interBtcAPI.btcRelay.getStableParachainConfirmations();
    assert.equal(
      stableParachainConfirmationsToSet,
      stableParachainConfirmations,
      "Setting the Parachain confirmations failed"
    );
    await bitcoinCoreClient.mineBlocks(3);
  });

  it("should issue 0.1 InterBTC", async () => {
    const wrappedToIssue = newMonetaryAmount(0.00007, wrappedCurrency, true);
    await issueSingle(
      interBtcAPI,
      bitcoinCoreClient,
      alice,
      wrappedToIssue,
      vault_id
    );
  });
});
