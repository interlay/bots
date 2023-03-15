import { ChainBalance, CollateralPosition, CurrencyExt, InterBtcApi, LoansMarket, newMonetaryAmount, UndercollateralizedPosition, addressOrPairAsAccountId, DefaultTransactionAPI, decodePermill } from "@interlay/interbtc-api";
import { Currency, ExchangeRate, MonetaryAmount } from "@interlay/monetary-js";
import { AccountId } from "@polkadot/types/interfaces";
import { AddressOrPair } from "@polkadot/api/types";

import { APPROX_BLOCK_TIME_MS } from "./consts";
import { waitForEvent } from "./utils";

type CollateralAndValue = {
    collateral: MonetaryAmount<Currency>,
    referenceValue: MonetaryAmount<Currency>
}

function referenceValue(balance: MonetaryAmount<CurrencyExt>, rate: ExchangeRate<Currency, CurrencyExt> | undefined): MonetaryAmount<Currency> {
    if (!rate) {
        return new MonetaryAmount(balance.currency, 0);
    }
    // Convert to the reference currency (BTC)
    return rate.toBase(balance)
}

function findHighestValueCollateral(
    positions: CollateralPosition[],
    rates: Map<Currency, ExchangeRate<Currency, CurrencyExt>>
): CollateralAndValue | undefined {
    // It should be impossible to have no collateral currency locked, but just in case
    if (positions.length == 0) {
        return undefined;
    }
    const defaultValue = {
        collateral: positions[0].amount,
        referenceValue: referenceValue(
            newMonetaryAmount(0, positions[0].amount.currency),
            rates.get(positions[0].amount.currency)
        )
    };
    return positions.reduce(
        (previous, current) => {
            const liquidatableValue = referenceValue(current.amount, rates.get(current.amount.currency));
            if (previous.referenceValue.gt(liquidatableValue)) {
                return previous;
            }
            return {
                collateral: current.amount,
                referenceValue: liquidatableValue
            }
        },
        defaultValue
    );
}

function liquidationStrategy(
    interBtcApi: InterBtcApi,
    liquidatorBalance: Map<Currency, ChainBalance>,
    oracleRates: Map<Currency, ExchangeRate<Currency, CurrencyExt>>,
    undercollateralizedBorrowers: UndercollateralizedPosition[],
    markets: Map<Currency, LoansMarket>
): [MonetaryAmount<CurrencyExt>, CurrencyExt, AccountId] | undefined {
        let maxRepayableLoan = newMonetaryAmount(0, interBtcApi.getWrappedCurrency());
        let result: [MonetaryAmount<CurrencyExt>, CurrencyExt, AccountId] | undefined;
        undercollateralizedBorrowers.forEach((position) => {
            // Among the collateral currencies locked by this borrower, which one is worth the most?
            const highestValueCollateral = findHighestValueCollateral(position.collateralPositions, oracleRates); 
            if (!highestValueCollateral) {
                return;
            }
            // Among the borrowed currencies of this borrower, which one accepts the biggest repayment?
            // (i.e. is worth the most after considering the close factor)
            position.borrowPositions.forEach((loan) => {
                const totalDebt = loan.amount.add(loan.accumulatedDebt);
                // If this loan can be repaid using the lending-liquidator's balance
                if (liquidatorBalance.has(totalDebt.currency)) {
                    const loansMarket = markets.get(totalDebt.currency) as LoansMarket;
                    const closeFactor = decodePermill(loansMarket.closeFactor);
                    const balance = liquidatorBalance.get(totalDebt.currency) as ChainBalance;
                    const rate = oracleRates.get(totalDebt.currency) as ExchangeRate<Currency, CurrencyExt>;
                    // Can only repay a fraction of the total debt, defined by the `closeFactor`
                    const repayableAmount = totalDebt.mul(closeFactor).min(balance.free);
                    const referenceRepayable = referenceValue(repayableAmount, rate).min(highestValueCollateral.referenceValue);
                    if (referenceRepayable.gt(maxRepayableLoan)) {
                        maxRepayableLoan = referenceRepayable;
                        result = [repayableAmount, highestValueCollateral.collateral.currency, position.accountId];
                    }
                }
            })
        });
        return result;
    }
    
    async function checkForLiquidations(interBtcApi: InterBtcApi): Promise<void> {
        const accountId = addressOrPairAsAccountId(interBtcApi.api, interBtcApi.account as AddressOrPair);
        const liquidatorBalance: Map<Currency, ChainBalance> = new Map();
        const oracleRates: Map<Currency, ExchangeRate<Currency, CurrencyExt>> = new Map();
        const nativeCurrencies = [interBtcApi.getWrappedCurrency(), interBtcApi.getGovernanceCurrency(), interBtcApi.getRelayChainCurrency()]
        // This call slows down potential liquidations.
        // TODO: keep a local cache of foreign assets and fetch 
        const foreignAssets = await interBtcApi.assetRegistry.getForeignAssets();
        let chainAssets = new Set([...nativeCurrencies, ...foreignAssets]);

        const [_balancesPromise, _oraclePromise, undercollateralizedBorrowers, marketsArray] = await Promise.all([
            Promise.all([...chainAssets].map((asset) => interBtcApi.tokens.balance(asset, accountId).then((balance) => liquidatorBalance.set(asset, balance)))),
            Promise.all([...chainAssets].map((asset) => interBtcApi.oracle.getExchangeRate(asset).then((rate) => oracleRates.set(asset, rate)))),
            interBtcApi.loans.getUndercollateralizedBorrowers(),
            interBtcApi.loans.getLoansMarkets(),
        ]);
        
        console.log(`undercollateralized borrowers: ${undercollateralizedBorrowers.length}`);
        // Run the liquidation strategy to find the most profitable liquidation
        const potentialLiquidation = liquidationStrategy(
            interBtcApi,
            liquidatorBalance,
            oracleRates,
            undercollateralizedBorrowers,
            new Map(marketsArray)
        ) as [MonetaryAmount<CurrencyExt>, CurrencyExt, AccountId];
        if (potentialLiquidation) {
            const [amountToRepay, collateralToLiquidate, borrower] = potentialLiquidation;
            console.log(`Liquidating ${borrower.toString()} with ${amountToRepay.toHuman()} ${amountToRepay.currency.ticker}, collateral: ${collateralToLiquidate.ticker}`);
            // Either our liquidation will go through, or someone else's will
            await Promise.all([
                waitForEvent(interBtcApi.api, interBtcApi.api.events.loans.LiquidatedBorrow, 10 * APPROX_BLOCK_TIME_MS),
                interBtcApi.loans.liquidateBorrowPosition(borrower, amountToRepay.currency, amountToRepay, collateralToLiquidate)
            ]);
        }
    }

    export async function startLiquidator(interBtcApi: InterBtcApi): Promise<() => void> {
        if (interBtcApi.account == undefined) {
            throw new Error("No account set for the lending-liquidator");
        }

        let flagPromiseResolve: (() => void) | undefined;
        const flagPromise = new Promise<void>((resolve) => flagPromiseResolve = () => { resolve(); })
        console.log("Starting lending liquidator...");
        console.log("Listening to new blocks...");
        const unsubscribe = await interBtcApi.api.rpc.chain.subscribeNewHeads(async (header) => {
            console.log(`Scanning block: #${header.number}`);
            await checkForLiquidations(interBtcApi).catch((reason) => {
                console.error(reason);
            });
        });
        // TODO: investigate why the process doesn't gracefully terminate here even though to 
        // block listener is unsubscribed from and the api is disconnected
        // Likely because of a `setTimeout` created by polkadot-js
        // Kill the process for now
        flagPromise.then(async () => {
            unsubscribe();
            await interBtcApi.disconnect();
            process.exit(0);
        });

        return flagPromiseResolve as () => void;
}
