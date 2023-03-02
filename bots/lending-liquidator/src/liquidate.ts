import { ChainBalance, CurrencyExt, InterBtcApi, newAccountId, newMonetaryAmount } from "@interlay/interbtc-api";
import { Currency, ExchangeRate, MonetaryAmount } from "@interlay/monetary-js";
import { NATIVE_CURRENCIES } from "./consts";

function referencePrice(balance: MonetaryAmount<CurrencyExt>, rate: ExchangeRate<Currency, CurrencyExt>): MonetaryAmount<Currency> {
    // Convert to the reference currency (BTC)
    return rate.toBase(balance)
}

async function start(interBtcApi: InterBtcApi): Promise<void> {
    const foreignAssets = await interBtcApi.assetRegistry.getForeignAssets();
    let chainAssets = [...NATIVE_CURRENCIES, ...foreignAssets];
    if (!interBtcApi.account) {
        return Promise.reject("No account set for the lending-liquidator");
    }
    const accountId = newAccountId(interBtcApi.api, interBtcApi.account.toString());
    await interBtcApi.api.rpc.chain.subscribeNewHeads(async (header) => {

        const [balances, oraclePrices, undercollateralizedBorrowers, foreignAssets] = await Promise.all([
            Promise.all(chainAssets.map((asset) => interBtcApi.tokens.balance(asset, accountId))),
            Promise.all(chainAssets.map((asset) => interBtcApi.oracle.getExchangeRate(asset))),
            interBtcApi.loans.getUndercollateralizedBorrowers(),
            interBtcApi.assetRegistry.getForeignAssets()
        ]);
        
        const balancesAndPrices: Map<Currency, [ChainBalance, ExchangeRate<Currency, CurrencyExt>]> = new Map();
        chainAssets
            .forEach(
                (v, index) => 
                    balancesAndPrices.set(v, [balances[index], oraclePrices[index]])
            );
        
        // TODO: refactor to a `strategy(...)` function that takes balances, prices, and undercollateralized borrowers
        // and returns amountToRepay and collateralToLiquidate
        
        let maxRepayableLoan = newMonetaryAmount(0, interBtcApi.getWrappedCurrency());
        let maxRepayment: MonetaryAmount<CurrencyExt>;
        let collateralToLiquidate: CurrencyExt;
        undercollateralizedBorrowers.forEach((position) => {
            position.borrowPositions.forEach((loan) => {
                if (balancesAndPrices.has(loan.amount.currency)) {
                    const [balance, rate] = balancesAndPrices.get(loan.amount.currency) as [ChainBalance, ExchangeRate<Currency, CurrencyExt>];
                    const repayableAmount = loan.amount.min(balance.free);
                    const referenceDebt = referencePrice(repayableAmount, rate);
                    if (referenceDebt.gt(maxRepayableLoan)) {
                        maxRepayableLoan = referenceDebt;
                        maxRepayment = repayableAmount;
                    }

                }
            })
        });

        chainAssets = [...NATIVE_CURRENCIES, ...foreignAssets];
        console.log(`Scanned block: #${header.number}`);
    });
}
