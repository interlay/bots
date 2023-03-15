import { createInterBtcApi } from "@interlay/interbtc-api";
import { Keyring } from "@polkadot/api";
import { cryptoWaitReady } from "@polkadot/util-crypto";
import { startLiquidator } from "./liquidate";
export { startLiquidator };

async function main() {
    if (!process.env.LENDING_LIQUIDATOR_ACCOUNT || !process.env.PARACHAIN_URL) {
        Promise.reject(
            "`PARACHAIN_URL` and `LENDING_LIQUIDATOR_ACCOUNT` environment variables not set"
        );
    }
    await cryptoWaitReady();
    let keyring = new Keyring({ type: "sr25519" });
    let account = keyring.addFromUri(`${process.env.LENDING_LIQUIDATOR_ACCOUNT}`);
    console.log(`Bot account: ${account.address}`);
    const interBtcApi = await createInterBtcApi(
        process.env.PARACHAIN_URL as string,
        undefined,
        account
    );
    await new Promise(async () => await startLiquidator(interBtcApi));
}

main().catch((err) => {
    console.error("Error during bot operation:");
    console.error(err);
});
