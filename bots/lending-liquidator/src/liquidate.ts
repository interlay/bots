import { ChainBalance, CollateralPosition, CurrencyExt, InterBtcApi, LoansMarket, newMonetaryAmount, UndercollateralizedPosition, addressOrPairAsAccountId, DefaultTransactionAPI, decodePermill } from "@interlay/interbtc-api";
import { Currency, ExchangeRate, MonetaryAmount } from "@interlay/monetary-js";
import { AccountId } from "@polkadot/types/interfaces";
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
            const highestValueCollateral = findHighestValueCollateral(position.collateralPositions, oracleRates); 
            if (!highestValueCollateral) {
                return;
            }
            position.borrowPositions.forEach((loan) => {
                const totalDebt = loan.amount.add(loan.accumulatedDebt);
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
    
    export async function startLiquidator(interBtcApi: InterBtcApi): Promise<void> {
        console.log("Starting lending liquidator...");
        const foreignAssets = await interBtcApi.assetRegistry.getForeignAssets();
        
        let nativeCurrency = [interBtcApi.getWrappedCurrency(), interBtcApi.getGovernanceCurrency(), interBtcApi.getRelayChainCurrency()]
        let chainAssets = new Set([...nativeCurrency, ...foreignAssets]);
        if (interBtcApi.account == undefined) {
            return Promise.reject("No account set for the lending-liquidator");
        }
        const accountId = addressOrPairAsAccountId(interBtcApi.api, interBtcApi.account);
        console.log("Listening to new blocks...");
        let flagPromiseResolve: () => void;
        const flagPromise = new Promise<void>((resolve) => flagPromiseResolve = () => { resolve(); })
        // The block subscription is a Promise that never resolves
        const subscriptionPromise = new Promise(() => {
            interBtcApi.api.rpc.chain.subscribeNewHeads(async (header) => {
                console.log(`Scanning block: #${header.number}`);
                const liquidatorBalance: Map<Currency, ChainBalance> = new Map();
                const oracleRates: Map<Currency, ExchangeRate<Currency, CurrencyExt>> = new Map();
                try {
                    const [_balancesPromise, _oraclePromise, undercollateralizedBorrowers, marketsArray, foreignAssets] = await Promise.all([
                        Promise.all([...chainAssets].map((asset) => interBtcApi.tokens.balance(asset, accountId).then((balance) => liquidatorBalance.set(asset, balance)))),
                        Promise.all([...chainAssets].map((asset) => interBtcApi.oracle.getExchangeRate(asset).then((rate) => oracleRates.set(asset, rate)))),
                        interBtcApi.loans.getUndercollateralizedBorrowers(),
                        interBtcApi.loans.getLoansMarkets(),
                        interBtcApi.assetRegistry.getForeignAssets()
                    ]);
                    
                    console.log(`undercollateralized borrowers: ${undercollateralizedBorrowers.length}`);
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
                                waitForEvent(interBtcApi.api, interBtcApi.api.events.loans.ActivatedMarket, 10 * APPROX_BLOCK_TIME_MS),
                                interBtcApi.loans.liquidateBorrowPosition(borrower, amountToRepay.currency, amountToRepay, collateralToLiquidate)
                            ]);
                        }
                    
                    // Add any new foreign assets to `chainAssets`
                    chainAssets = new Set([...Array.from(chainAssets), ...foreignAssets]);
                } catch (error) {
                    if (interBtcApi.api.isConnected) {
                        console.log(error);
                    } else {
                        flagPromiseResolve();
                    }
                }
            });
        });
        await Promise.race([
            flagPromise,
            subscriptionPromise
        ]);
        // TODO: investigate why the process doesn't gracefully terminate here even though `Promise.race` finished
        // Likely because of a `setTimeout` created by polkadot-js
        // Kill the process for now
        process.exit(0);
}
