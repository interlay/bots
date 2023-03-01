import { createSubstrateAPI, CurrencyExt, DefaultInterBtcApi, DefaultTransactionAPI, InterBtcApi, InterbtcPrimitivesCurrencyId, newAccountId, newCurrencyId, LendToken, newMonetaryAmount, currencyIdToMonetaryCurrency, sleep, SLEEP_TIME_MS } from "@interlay/interbtc-api";
import { ApiPromise, Keyring } from "@polkadot/api";
import { KeyringPair } from "@polkadot/keyring/types";
import { AccountId } from "@polkadot/types/interfaces";
import { expect } from "chai";

import { APPROX_BLOCK_TIME_MS, DEFAULT_PARACHAIN_ENDPOINT, DEFAULT_SUDO_URI, DEFAULT_USER_1_URI, DEFAULT_USER_2_URI } from "../config";
import { setExchangeRate } from "../utils";

describe("liquidate", () => {
    const approx10Blocks = 10 * APPROX_BLOCK_TIME_MS;
    let api: ApiPromise;
    let keyring: Keyring;
    let userInterBtcAPI: InterBtcApi;
    let user2InterBtcAPI: InterBtcApi;
    let sudoInterBtcAPI: InterBtcApi;

    let userAccount: KeyringPair;
    let user2Account: KeyringPair;
    let userAccountId: AccountId;
    let sudoAccount: KeyringPair;
    let sudoAccountId: AccountId;

    let lendTokenId1: InterbtcPrimitivesCurrencyId;
    let lendTokenId2: InterbtcPrimitivesCurrencyId;
    let lendTokenId3: InterbtcPrimitivesCurrencyId;
    let underlyingCurrencyId1: InterbtcPrimitivesCurrencyId;
    let underlyingCurrency1: CurrencyExt;
    let underlyingCurrencyId2: InterbtcPrimitivesCurrencyId;
    let underlyingCurrency2: CurrencyExt;
    let underlyingCurrencyId3: InterbtcPrimitivesCurrencyId;
    let underlyingCurrency3: CurrencyExt;

    before(async function () {
        // Sleep for 30s while the parachain is registering
        // TODO: Check the chain state for when the parachain has already produces a few blocks
        const sleepTimeMs = 30_000;
        await sleep(sleepTimeMs);
        this.timeout(approx10Blocks + sleepTimeMs);

        api = await createSubstrateAPI(DEFAULT_PARACHAIN_ENDPOINT);
        keyring = new Keyring({ type: "sr25519" });
        userAccount = keyring.addFromUri(DEFAULT_USER_1_URI);
        user2Account = keyring.addFromUri(DEFAULT_USER_2_URI);
        userInterBtcAPI = new DefaultInterBtcApi(api, "regtest", userAccount);
        user2InterBtcAPI = new DefaultInterBtcApi(api, "regtest", user2Account);

        sudoAccount = keyring.addFromUri(DEFAULT_SUDO_URI);
        sudoAccountId = newAccountId(api, sudoAccount.address);
        sudoInterBtcAPI = new DefaultInterBtcApi(api, "regtest", sudoAccount);
        userAccountId = newAccountId(api, userAccount.address);
        lendTokenId1 = newCurrencyId(api, { lendToken: { id: 1 } } as LendToken);
        lendTokenId2 = newCurrencyId(api, { lendToken: { id: 2 } } as LendToken);
        lendTokenId3 = newCurrencyId(api, { lendToken: { id: 3 } } as LendToken);

        underlyingCurrencyId1 = api.consts.escrowRewards.getNativeCurrencyId;
        underlyingCurrency1 = await currencyIdToMonetaryCurrency(sudoInterBtcAPI.assetRegistry, sudoInterBtcAPI.loans, underlyingCurrencyId1);
        underlyingCurrencyId2 = api.consts.currency.getRelayChainCurrencyId;
        underlyingCurrency2 = await currencyIdToMonetaryCurrency(sudoInterBtcAPI.assetRegistry, sudoInterBtcAPI.loans, underlyingCurrencyId2);
        underlyingCurrencyId3 = api.consts.currency.getWrappedCurrencyId;
        underlyingCurrency3 = await currencyIdToMonetaryCurrency(sudoInterBtcAPI.assetRegistry, sudoInterBtcAPI.loans, underlyingCurrencyId3);

        const percentageToPermill = (percentage: number) => percentage * 10000;

        const marketData = (id: InterbtcPrimitivesCurrencyId) => ({
            collateralFactor: percentageToPermill(50),
            liquidationThreshold: percentageToPermill(55),
            reserveFactor: percentageToPermill(15),
            closeFactor: percentageToPermill(50),
            liquidateIncentive: "1100000000000000000",
            liquidateIncentiveReservedFactor: percentageToPermill(3),
            rateModel: {
                Jump: {
                    baseRate: "20000000000000000",
                    jumpRate: "100000000000000000",
                    fullRate: "320000000000000000",
                    jumpUtilization: percentageToPermill(80),
                },
            },
            state: "Pending",
            supplyCap: "5000000000000000000000",
            borrowCap: "5000000000000000000000",
            lendTokenId: id,
        });

        const addMarket1Extrinsic = sudoInterBtcAPI.api.tx.loans.addMarket(
            underlyingCurrencyId1,
            marketData(lendTokenId1)
        );
        const addMarket2Extrinsic = sudoInterBtcAPI.api.tx.loans.addMarket(
            underlyingCurrencyId2,
            marketData(lendTokenId2)
        );
        const addMarket3Extrinsic = sudoInterBtcAPI.api.tx.loans.addMarket(
            underlyingCurrencyId3,
            marketData(lendTokenId3)
        );
        const activateMarket1Extrinsic = sudoInterBtcAPI.api.tx.loans.activateMarket(underlyingCurrencyId1);
        const activateMarket2Extrinsic = sudoInterBtcAPI.api.tx.loans.activateMarket(underlyingCurrencyId2);
        const activateMarket3Extrinsic = sudoInterBtcAPI.api.tx.loans.activateMarket(underlyingCurrencyId3);
        const addMarkets = sudoInterBtcAPI.api.tx.utility.batchAll([
            addMarket1Extrinsic,
            addMarket2Extrinsic,
            addMarket3Extrinsic,
            activateMarket1Extrinsic,
            activateMarket2Extrinsic,
            activateMarket3Extrinsic,
        ]);

        const [eventFound] = await Promise.all([
            DefaultTransactionAPI.waitForEvent(sudoInterBtcAPI.api, sudoInterBtcAPI.api.events.sudo.Sudid, approx10Blocks),
            api.tx.sudo.sudo(addMarkets).signAndSend(sudoAccount),
        ]);
        expect(
            eventFound,
            `Sudo event to create new market not found - timed out after ${approx10Blocks} ms`
        ).to.be.true;
    });

    after(async () => {
        api.disconnect();
    });

    it("should lend expected amount of currency to protocol", async function () {
        this.timeout(20 * approx10Blocks);

        const depositAmount = newMonetaryAmount(1000, underlyingCurrency1, true);
        const borrowAmount1 = newMonetaryAmount(100, underlyingCurrency2, true);
        const borrowAmount2 = newMonetaryAmount(1, underlyingCurrency3, true);

        await userInterBtcAPI.loans.lend(underlyingCurrency1, depositAmount);
        await userInterBtcAPI.loans.enableAsCollateral(underlyingCurrency1);

        // Deposit cash in the currencies to be borrowed by the user
        await sudoInterBtcAPI.loans.lend(borrowAmount1.currency, borrowAmount1);
        // Mint some `borrowAmount2.currency` to the sudo account to ensure the tx works
        await sudoInterBtcAPI.tokens.setBalance(
            sudoAccountId,
            borrowAmount2,
            borrowAmount2.withAmount(0)
        );
        await sudoInterBtcAPI.loans.lend(borrowAmount2.currency, borrowAmount2);

        // Borrow
        await userInterBtcAPI.loans.borrow(borrowAmount1.currency, borrowAmount1);
        await userInterBtcAPI.loans.borrow(borrowAmount2.currency, borrowAmount2);

        // start liquidation listener
        // lendingLiquidationChecker(user2InterBtcAPI)
        // TODO!: start the bot listener logic
        const liquidationEventFoundPromise = DefaultTransactionAPI.waitForEvent(sudoInterBtcAPI.api, sudoInterBtcAPI.api.events.loans.LiquidatedBorrow, approx10Blocks);

        // crash the collateral exchange rate
        const newExchangeRate = "0x00000000000000000001000000000000";
        await setExchangeRate(sudoInterBtcAPI, depositAmount.currency, newExchangeRate);

        // expect liquidation event to happen
        const liquidationOccured = await liquidationEventFoundPromise;
        expect(
            liquidationOccured,
            `Expected the bot to have liquidated user ${userAccountId.toString()}, in collateral currency ${depositAmount.currency.ticker}`
        ).to.be.true;
    });
});
