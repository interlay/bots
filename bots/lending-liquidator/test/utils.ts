
import { CurrencyExt, InterBtcApi, storageKeyToNthInner, createExchangeRateOracleKey, setStorageAtKey, sleep, SLEEP_TIME_MS } from "@interlay/interbtc-api";

import { ApiPromise } from "@polkadot/api";

export async function setExchangeRate(
    sudoInterBtcAPI: InterBtcApi,
    currency: CurrencyExt,
    newExchangeRateHex: `0x${string}`
): Promise<void> {
    const { account: sudoAccount, api } = sudoInterBtcAPI;
    if (!sudoAccount) {
        throw new Error("setExchangeRate: sudo account is not set.");
    }
    // Remove authorized oracle to make sure price won't be fed.
    const authorizedOracles = await api.query.oracle.authorizedOracles.entries();
    const authorizedOraclesAccountIds = authorizedOracles.map(([key]) => storageKeyToNthInner(key));
    const removeAllOraclesExtrinsic = api.tx.utility.batchAll(
        authorizedOraclesAccountIds.map((accountId) => api.tx.oracle.removeAuthorizedOracle(accountId))
    );
    await api.tx.sudo.sudo(removeAllOraclesExtrinsic).signAndSend(sudoAccount);

    // Change Exchange rate storage for currency.
    const exchangeRateOracleKey = createExchangeRateOracleKey(api, currency);
    const exchangeRateStorageKey = sudoInterBtcAPI.api.query.oracle.aggregate.key(exchangeRateOracleKey);
    await setStorageAtKey(sudoInterBtcAPI.api, exchangeRateStorageKey, newExchangeRateHex, sudoAccount);
}

export async function waitForNthBlock(api: ApiPromise, n: number = 2): Promise<void> {
    while (true) {
        const currentBlockNo = await api.query.system.number();
        if (currentBlockNo.toNumber() >= n) {
            return;
        }
        console.log(`Waiting for ${n} blocks to be produced... Current block is ${currentBlockNo}`);
        await sleep(SLEEP_TIME_MS);
    }
}

export async function waitRegisteredLendingMarkets(api: ApiPromise): Promise<void> {
    while (true) {
        const currentBlockNo = await api.query.loans.markets.entries();
        if (currentBlockNo.length > 0) {
            return;
        }
        console.log(`Waiting for lending markets to be registered`);
        await sleep(SLEEP_TIME_MS);
    }
}