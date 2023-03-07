import { ChainBalance, CollateralPosition, CurrencyExt, InterBtcApi, newAccountId, newMonetaryAmount, UndercollateralizedPosition } from "@interlay/interbtc-api";
import { Currency, ExchangeRate, MonetaryAmount } from "@interlay/monetary-js";
import { AccountId } from "@polkadot/types/interfaces";
import { NATIVE_CURRENCIES } from "./consts";

type CollateralAndValue = {
    collateral: CollateralPosition,
    referenceValue: MonetaryAmount<Currency>
}

function referencePrice(balance: MonetaryAmount<CurrencyExt>, rate: ExchangeRate<Currency, CurrencyExt> | undefined): MonetaryAmount<Currency> {
    if (!rate) {
        return new MonetaryAmount(balance.currency, 0);
    }
    // Convert to the reference currency (BTC)
    return rate.toBase(balance)
}

function findHighestValueCollateral(positions: CollateralPosition[], rates: Map<Currency, ExchangeRate<Currency, CurrencyExt>>): CollateralAndValue | undefined {
    // It should be impossible to have no collateral currency locked, but just in case
    if (positions.length == 0) {
        return undefined;
    }
    const defaultValue = {
        collateral: positions[0],
        referenceValue: referencePrice(positions[0].amount, rates.get(positions[0].amount.currency))
    };
    return positions.reduce(
        (previous, current) => {
            const currentReferencePrice = referencePrice(current.amount, rates.get(current.amount.currency));
            if (previous.collateral.amount.gt(currentReferencePrice)) {
                return previous;
            }
            return {
                collateral: current,
                referenceValue: currentReferencePrice
            }
        },
        defaultValue
    );
}

function liquidationStrategy(
    interBtcApi: InterBtcApi,
    chainAssets: Set<CurrencyExt>,
    liquidatorBalance: Map<Currency, ChainBalance>,
    oracleRates: Map<Currency, ExchangeRate<Currency, CurrencyExt>>,
    undercollateralizedBorrowers: UndercollateralizedPosition[]
): [MonetaryAmount<CurrencyExt>, CurrencyExt, AccountId] | undefined {
        let maxRepayableLoan = newMonetaryAmount(0, interBtcApi.getWrappedCurrency());
        let result: [MonetaryAmount<CurrencyExt>, CurrencyExt, AccountId] | undefined;
        undercollateralizedBorrowers.forEach((position) => {
            const highestValueCollateral = findHighestValueCollateral(position.collateralPositions, oracleRates); 
            if (!highestValueCollateral) {
                return;
            }
            position.borrowPositions.forEach((loan) => {
                if (chainAssets.has(loan.accumulatedDebt.currency)) {
                    const balance = liquidatorBalance.get(loan.accumulatedDebt.currency) as ChainBalance;
                    const rate = oracleRates.get(loan.accumulatedDebt.currency) as ExchangeRate<Currency, CurrencyExt>;
                    const repayableAmount = loan.accumulatedDebt.min(balance.free);
                    // TODO: Take close factor into account when consider the collateral's reference value
                    const referenceRepayable = referencePrice(repayableAmount, rate).min(highestValueCollateral.referenceValue);
                    if (referenceRepayable.gt(maxRepayableLoan)) {
                        maxRepayableLoan = referenceRepayable;
                        result = [repayableAmount, highestValueCollateral.collateral.amount.currency, position.accountId];
                    }
                }
            })
        });
        return result;
}

async function start(interBtcApi: InterBtcApi): Promise<void> {
    const foreignAssets = await interBtcApi.assetRegistry.getForeignAssets();
    let chainAssets = new Set([...NATIVE_CURRENCIES, ...foreignAssets]);
    if (!interBtcApi.account) {
        return Promise.reject("No account set for the lending-liquidator");
    }
    const accountId = newAccountId(interBtcApi.api, interBtcApi.account.toString());
    await interBtcApi.api.rpc.chain.subscribeNewHeads(async (header) => {

        const liquidatorBalance: Map<Currency, ChainBalance> = new Map();
        const oracleRates: Map<Currency, ExchangeRate<Currency, CurrencyExt>> = new Map();
        const [_balancesPromise, _oraclePromise, undercollateralizedBorrowers, foreignAssets] = await Promise.all([
            Promise.all([...chainAssets].map((asset) => interBtcApi.tokens.balance(asset, accountId).then((balance) => liquidatorBalance.set(asset, balance)))),
            Promise.all([...chainAssets].map((asset) => interBtcApi.oracle.getExchangeRate(asset).then((rate) => oracleRates.set(asset, rate)))),
            interBtcApi.loans.getUndercollateralizedBorrowers(),
            interBtcApi.assetRegistry.getForeignAssets()
        ]);
        
        if (undercollateralizedBorrowers.length > 0) {
            const [amountToRepay, collateralToLiquidate, borrower] = liquidationStrategy(
                interBtcApi,
                chainAssets,
                liquidatorBalance,
                oracleRates,
                undercollateralizedBorrowers
            ) as [MonetaryAmount<CurrencyExt>, CurrencyExt, AccountId];
            await interBtcApi.loans.liquidateBorrowPosition(borrower, amountToRepay.currency, amountToRepay, collateralToLiquidate);
        }
        
        // Add any new foreign assets to `chainAssets`
        chainAssets = new Set([...Array.from(chainAssets), ...foreignAssets]);
        console.log(`Scanned block: #${header.number}`);
    });
}
