import { KeyringPair } from "@polkadot/keyring/types";
import { Keyring } from "@polkadot/api";
import { Redeem } from "../../src/redeem";
import {
    BitcoinCoreClient,
    createInterbtcAPI,
    InterBTCAPI,
} from "@interlay/interbtc";
import { DEFAULT_PARACHAIN_ENDPOINT } from "../config";
import chai from "chai";
import { Bitcoin } from "@interlay/monetary-js";

let produceBlocksFlag = false;

async function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

async function produceBlocks(bitcoinCoreClient: BitcoinCoreClient, delayMs: number): Promise<void> {
    while(produceBlocksFlag) {
        await sleep(delayMs);
        await bitcoinCoreClient.mineBlocksWithoutDelay(1);
        console.log("~~~Mined a block");
    }
}

describe("redeem", () => {
    let interBtc: InterBTCAPI;
    let alice: KeyringPair;
    let bob: KeyringPair;
    let charlie_stash: KeyringPair;
    let dave_stash: KeyringPair;
    let keyring: Keyring;
    let redeem: Redeem;
    let redeemBtcAddress: string;
    let bitcoinCoreClient: BitcoinCoreClient;
    let vaultList: string[];

    before(async () => {
        interBtc = await createInterbtcAPI(DEFAULT_PARACHAIN_ENDPOINT, "regtest");
        keyring = new Keyring({ type: "sr25519" });
        alice = keyring.addFromUri("//Alice");
        bob = keyring.addFromUri("//Bob");
        charlie_stash = keyring.addFromUri("//Charlie//stash");
        dave_stash = keyring.addFromUri("//Dave//stash");
        interBtc.setAccount(alice);
        vaultList = [charlie_stash.address, dave_stash.address]
        redeemBtcAddress = "bcrt1qed0qljupsmqhxul67r7358s60reqa2qtte0kay";
        bitcoinCoreClient = new BitcoinCoreClient(
            "regtest",
            "0.0.0.0",
            "rpcuser",
            "rpcpassword",
            "18443",
            "Alice",
        );

        // Perform redeems while mining blocks in parallel.
        // OpReturn payments are not identified unless included in a block.
        produceBlocksFlag = true;
        produceBlocks(bitcoinCoreClient, 5000);
    });

    after(() => {
        produceBlocksFlag = false;
        return interBtc.api.disconnect();
    });

    it("should perform heartbeat redeems", async () => {
        redeem = new Redeem(interBtc);
        await redeem.performHeartbeatRedeems(
            alice,
            redeemBtcAddress,
            "0.0.0.0",
            "18443",
            "rpcuser",
            "rpcpassword",
            "regtest",
            "Alice",
            3
        );
        await redeem.getAliveVaults();
    });

    it("should issue tokens to be able to redeem", async () => {
        redeem = new Redeem(interBtc);
        const tokenBalance = await interBtc.tokens.balance(Bitcoin, interBtc.api.createType("AccountId", bob.address));
        chai.assert.equal(tokenBalance.toString(), "0");

        // Redeems should still work if the user has enough collateral to issue first
        await redeem.performHeartbeatRedeems(
            alice,
            redeemBtcAddress,
            "0.0.0.0",
            "18443",
            "rpcuser",
            "rpcpassword",
            "regtest",
            "Alice",
            3
        );
        await redeem.getAliveVaults();
    });
});
