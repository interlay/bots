
import { CurrencyExt, InterBtcApi, storageKeyToNthInner, getStorageMapItemKey, createExchangeRateOracleKey, setStorageAtKey } from "@interlay/interbtc-api";

export async function setExchangeRate(
    sudoInterBtcAPI: InterBtcApi,
    currency: CurrencyExt,
    newExchangeRateHex: `0x${string}`
): Promise<void> {
    const { account: sudoAccount, api } = sudoInterBtcAPI;
    if (!sudoAccount) {
        throw new Error("callWithExchangeRate: sudo account is not set.");
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

    const exchangeRateStorageKey = getStorageMapItemKey("Oracle", "Aggregate", exchangeRateOracleKey.toHex());
    await setStorageAtKey(sudoInterBtcAPI.api, exchangeRateStorageKey, newExchangeRateHex, sudoAccount);
}
