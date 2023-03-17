import { ChainBalance, CollateralPosition, CurrencyExt, InterBtcApi, LoansMarket, newMonetaryAmount, UndercollateralizedPosition, addressOrPairAsAccountId, DefaultTransactionAPI, decodePermill, decodeFixedPointType } from "@interlay/interbtc-api";
import { Currency, ExchangeRate, MonetaryAmount } from "@interlay/monetary-js";
import { AccountId } from "@polkadot/types/interfaces";
import { AddressOrPair } from "@polkadot/api/types";

type CollateralAndValue = {
    collateral: MonetaryAmount<Currency>,
    referenceValue: MonetaryAmount<Currency>
}

function referenceValue<C extends Currency>(
    balance: MonetaryAmount<CurrencyExt>,
    rate: ExchangeRate<C, CurrencyExt> | undefined,
    referenceCurrency: C
): MonetaryAmount<C> {
    if (!rate) {
        return new MonetaryAmount(referenceCurrency, 0);
    }
    // Convert to the reference currency (BTC)
    return rate.toBase(balance)
}

function findHighestValueCollateral<C extends Currency>(
    positions: CollateralPosition[],
    rates: Map<String, ExchangeRate<C, CurrencyExt>>,
    referenceCurrency: C
): CollateralAndValue | undefined {
    // It should be impossible to have no collateral currency locked, but just in case
    if (positions.length == 0) {
        return undefined;
    }
    const defaultValue = {
        collateral: positions[0].amount,
        referenceValue: referenceValue(
            newMonetaryAmount(0, positions[0].amount.currency),
            rates.get(positions[0].amount.currency.ticker),
            referenceCurrency
        )
    };
    return positions.reduce(
        (previous, current) => {
            const liquidatableValue = referenceValue(
                current.amount,
                rates.get(current.amount.currency.ticker),
                referenceCurrency
            );
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
    oracleRates: Map<String, ExchangeRate<Currency, CurrencyExt>>,
    undercollateralizedBorrowers: UndercollateralizedPosition[],
    markets: Map<Currency, LoansMarket>
): [MonetaryAmount<CurrencyExt>, CurrencyExt, AccountId] | undefined {
        const referenceCurrency = interBtcApi.getWrappedCurrency();
        let maxRepayableLoan = newMonetaryAmount(0, referenceCurrency);
        let result: [MonetaryAmount<CurrencyExt>, CurrencyExt, AccountId] | undefined;
        undercollateralizedBorrowers.forEach((position) => {
            // Among the collateral currencies locked by this borrower, which one is worth the most?
            const highestValueCollateral = findHighestValueCollateral(
                position.collateralPositions,
                oracleRates,
                referenceCurrency
            ); 
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
                    // `liquidationIncentive` includes the liquidation premium
                    // e.g. if the premium is 10%, `liquidationIncentive` is 110%  
                    const liquidationIncentive = decodeFixedPointType(loansMarket.liquidateIncentive)
                    const balance = liquidatorBalance.get(totalDebt.currency) as ChainBalance;
                    const rate = oracleRates.get(totalDebt.currency.ticker) as ExchangeRate<Currency, CurrencyExt>;
                    // Can only repay a fraction of the total debt, defined by the `closeFactor`
                    const repayableAmount = totalDebt.mul(closeFactor).min(balance.free);
                    const referenceRepayable = referenceValue(repayableAmount, rate, referenceCurrency);
                    if (
                        // The liquidation must be profitable
                        highestValueCollateral.referenceValue.gte(referenceRepayable.mul(liquidationIncentive)) && 
                        referenceRepayable.gt(maxRepayableLoan)
                    ) {
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
        const oracleRates: Map<String, ExchangeRate<Currency, CurrencyExt>> = new Map();
        const nativeCurrencies = [interBtcApi.getWrappedCurrency(), interBtcApi.getGovernanceCurrency(), interBtcApi.getRelayChainCurrency()]
        // This call slows down potential liquidations.
        // TODO: keep a local cache of foreign assets and fetch 
        const foreignAssets = await interBtcApi.assetRegistry.getForeignAssets();
        let chainAssets = new Set([...nativeCurrencies, ...foreignAssets]);

        const [_balancesPromise, _oraclePromise, undercollateralizedBorrowers, marketsArray] = await Promise.all([
            Promise.all([...chainAssets].map((asset) => interBtcApi.tokens.balance(asset, accountId).then((balance) => liquidatorBalance.set(asset, balance)))),
            Promise.all([...chainAssets].map((asset) =>
                interBtcApi.oracle.getExchangeRate(asset)
                    .then((rate) => oracleRates.set(asset.ticker, rate))
                    .catch((_) => {})
            )),
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
            await interBtcApi.loans.liquidateBorrowPosition(borrower, amountToRepay.currency, amountToRepay, collateralToLiquidate);
            // Try withdrawing the collateral reward (received as qTokens which need to be redeemed for the underlying).
            // This might fail if there is insufficient liquidity in the protocol.
            // TODO: periodically try withdrawing qToken balance
            interBtcApi.loans.withdrawAll(collateralToLiquidate).catch((error) => {
                console.error("Error redeeming collateral reward: ", error);
            });
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
