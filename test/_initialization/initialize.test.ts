import { ApiPromise, Keyring } from "@polkadot/api";
import { KeyringPair } from "@polkadot/keyring/types";
import * as bitcoinjs from "bitcoinjs-lib";
import Big from "big.js";
import BN from "bn.js";

import { 
    IssueAPI, 
    ElectrsAPI, 
    BitcoinCoreClient, 
    createPolkadotAPI, 
    OracleAPI, 
    RedeemAPI, 
    TreasuryAPI,
    issue,
    DefaultElectrsAPI,
    DefaultIssueAPI,
    DefaultOracleAPI,
    DefaultRedeemAPI,
    DefaultTreasuryAPI,
    setNumericStorage,
    BTCRelayAPI,
    DefaultBTCRelayAPI
} from "@interlay/polkabtc";

import { DEFAULT_PARACHAIN_ENDPOINT } from "../config";
import { assert } from "chai";

describe("Initialize parachain state", () => {
    let api: ApiPromise;
    let issueAPI: IssueAPI;
    let redeemAPI: RedeemAPI;
    let oracleAPI: OracleAPI;
    let electrsAPI: ElectrsAPI;
    let treasuryAPI: TreasuryAPI;
    let btcRelayAPI: BTCRelayAPI;
    let bitcoinCoreClient: BitcoinCoreClient;
    let keyring: Keyring;

    let alice: KeyringPair;
    let bob: KeyringPair;
    let charlie_stash: KeyringPair;
    let dave_stash: KeyringPair;

    function sleep(ms: number): Promise<void> {
        return new Promise((resolve) => setTimeout(resolve, ms));
    }

    before(async function () {
        api = await createPolkadotAPI(DEFAULT_PARACHAIN_ENDPOINT);
        keyring = new Keyring({ type: "sr25519" });
        // Alice is also the root account
        alice = keyring.addFromUri("//Alice");
        bob = keyring.addFromUri("//Bob");
        charlie_stash = keyring.addFromUri("//Charlie//stash");
        dave_stash = keyring.addFromUri("//Dave//stash");

        electrsAPI = new DefaultElectrsAPI("http://0.0.0.0:3002");
        bitcoinCoreClient = new BitcoinCoreClient("regtest", "0.0.0.0", "rpcuser", "rpcpassword", "18443", "Alice");
        issueAPI = new DefaultIssueAPI(api, bitcoinjs.networks.regtest, electrsAPI, alice);
        redeemAPI = new DefaultRedeemAPI(api, bitcoinjs.networks.regtest, electrsAPI, alice);
        oracleAPI = new DefaultOracleAPI(api, bob);
        treasuryAPI = new DefaultTreasuryAPI(api, alice);
        btcRelayAPI = new DefaultBTCRelayAPI(api, electrsAPI);

        // Sleep for 2 mins to wait for vaults to register
        await sleep(3 * 60 * 1000);
    });

    after(async () => {
        api.disconnect();
    });

    it("should set the stable confirmations and ready the Btc Relay", async () => {
        // Speed up the process by only requiring 1 parachain and 1 bitcoin confirmation
        const stableBitcoinConfirmationsToSet = 1;
        const stableParachainConfirmationsToSet = 1;
        await setNumericStorage(api, "BTCRelay", "StableBitcoinConfirmations", new BN(stableBitcoinConfirmationsToSet), issueAPI);
        await setNumericStorage(api, "BTCRelay", "StableParachainConfirmations", new BN(stableParachainConfirmationsToSet), issueAPI);
        const stableBitcoinConfirmations = await btcRelayAPI.getStableBitcoinConfirmations();
        assert.equal(stableBitcoinConfirmationsToSet, stableBitcoinConfirmations, "Setting the Bitcoin confirmations failed");
        const stableParachainConfirmations = await btcRelayAPI.getStableParachainConfirmations();
        assert.equal(stableParachainConfirmationsToSet, stableParachainConfirmations, "Setting the Parachain confirmations failed");
        
        await bitcoinCoreClient.mineBlocksWithoutDelay(10);
        await sleep(10 * 1000);
    });

    it("should issue 0.1 PolkaBTC with Charlie//stash", async () => {
        const polkaBtcToIssue = new Big(0.1);
        await issue(api, electrsAPI, bitcoinCoreClient, alice, polkaBtcToIssue, charlie_stash.address);
    });

    it("should issue 1 PolkaBTC with Dave//stash", async () => {
        const polkaBtcToIssue = new Big(1);
        await issue(api, electrsAPI, bitcoinCoreClient, alice, polkaBtcToIssue, dave_stash.address);
    });

});
