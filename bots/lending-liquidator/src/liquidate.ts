import { ChainBalance, CollateralPosition, CurrencyExt, InterBtcApi, newAccountId, newMonetaryAmount, UndercollateralizedPosition, addressOrPairAsAccountId, DefaultTransactionAPI } from "@interlay/interbtc-api";
import { Currency, ExchangeRate, MonetaryAmount } from "@interlay/monetary-js";
import { AccountId } from "@polkadot/types/interfaces";
import { APPROX_BLOCK_TIME_MS } from "./consts";

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
            if (previous.referenceValue.gt(currentReferencePrice)) {
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
                const totalDebt = loan.amount.add(loan.accumulatedDebt);
                console.log("debt currency", totalDebt.currency);
                console.log("highest value collateral ", highestValueCollateral.collateral.amount.currency.ticker, highestValueCollateral.referenceValue.toHuman());
                if (liquidatorBalance.has(totalDebt.currency)) {
                    const balance = liquidatorBalance.get(totalDebt.currency) as ChainBalance;
                    console.log("free bot balance ", balance.free.toHuman());
                    console.log("borrower debt", totalDebt.toHuman());
                    const rate = oracleRates.get(totalDebt.currency) as ExchangeRate<Currency, CurrencyExt>;
                    const repayableAmount = totalDebt.min(balance.free);
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
    await interBtcApi.api.rpc.chain.subscribeNewHeads(async (header) => {
        console.log(`Scanning block: #${header.number}`);
        const liquidatorBalance: Map<Currency, ChainBalance> = new Map();
        const oracleRates: Map<Currency, ExchangeRate<Currency, CurrencyExt>> = new Map();
        console.log("awaiting big promise");
        try {
            const [_balancesPromise, _oraclePromise, undercollateralizedBorrowers, foreignAssets] = await Promise.all([
                Promise.all([...chainAssets].map((asset) => interBtcApi.tokens.balance(asset, accountId).then((balance) => liquidatorBalance.set(asset, balance)))),
                Promise.all([...chainAssets].map((asset) => interBtcApi.oracle.getExchangeRate(asset).then((rate) => oracleRates.set(asset, rate)))),
                interBtcApi.loans.getUndercollateralizedBorrowers(),
                interBtcApi.assetRegistry.getForeignAssets()
            ]);
            
            console.log(`undercollateralized borrowers: ${undercollateralizedBorrowers.length}`);
            const potentialLiquidation = liquidationStrategy(
                interBtcApi,
                liquidatorBalance,
                oracleRates,
                undercollateralizedBorrowers
            ) as [MonetaryAmount<CurrencyExt>, CurrencyExt, AccountId];
            if (potentialLiquidation) {
                const [amountToRepay, collateralToLiquidate, borrower] = potentialLiquidation;
                console.log(`Liquidating ${borrower.toString()} with ${amountToRepay.toHuman()} ${amountToRepay.currency.ticker}, collateral: ${collateralToLiquidate.ticker}`);
                // Either our liquidation will go through, or someone else's will
                await Promise.all([
                    DefaultTransactionAPI.waitForEvent(interBtcApi.api, interBtcApi.api.events.loans.ActivatedMarket, 10 * APPROX_BLOCK_TIME_MS),
                    interBtcApi.loans.liquidateBorrowPosition(borrower, amountToRepay.currency, amountToRepay, collateralToLiquidate)
                ]);
            }
            
        } catch (error) {
            console.log("found an error: ", error);   
        }
        
        // Add any new foreign assets to `chainAssets`
        chainAssets = new Set([...Array.from(chainAssets), ...foreignAssets]);
    });
}
