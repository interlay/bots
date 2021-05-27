import { ApiPromise, Keyring } from "@polkadot/api";
import { KeyringPair } from "@polkadot/keyring/types";
import * as bitcoinjs from "bitcoinjs-lib";
import Big from "big.js";

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
    DefaultTreasuryAPI
} from "@interlay/polkabtc";

import { DEFAULT_PARACHAIN_ENDPOINT } from "../config";

describe("Initialize parachain state", () => {
    let api: ApiPromise;
    let issueAPI: IssueAPI;
    let redeemAPI: RedeemAPI;
    let oracleAPI: OracleAPI;
    let electrsAPI: ElectrsAPI;
    let treasuryAPI: TreasuryAPI;
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

        // Sleep for 10 sec to wait for vaults to register
        await sleep(10 * 1000);
    });

    after(async () => {
        api.disconnect();
    });

    it("should issue 0.1 PolkaBTC with Charlie", async () => {
        const polkaBtcToIssue = new Big(0.1);
        await issue(api, electrsAPI, bitcoinCoreClient, alice, polkaBtcToIssue, charlie_stash.address);
    });

    it("should issue 1 PolkaBTC with Dave", async () => {
        const polkaBtcToIssue = new Big(1);
        await issue(api, electrsAPI, bitcoinCoreClient, alice, polkaBtcToIssue, dave_stash.address);
    });

});
