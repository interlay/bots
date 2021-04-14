import { PolkaBTCAPI, FaucetClient } from "@interlay/polkabtc";
import Keyring from "@polkadot/keyring";

export class Faucet {
    private keyring = new Keyring({ type: "sr25519" });
    constructor() { }

    async floodFaucet(polkaBtc: PolkaBTCAPI, accountCount: number) {
        if (!process.env.FAUCET_URL) {
            Promise.reject("FAUCET_URL not set in the environment");
        }
        let faucet = new FaucetClient(process.env.FAUCET_URL as string);
        const promises = [];
        for (let i = 0; i < accountCount; i++) {
            const rand = Math.floor(Math.random() * 10000000);
            const account = this.keyring.createFromUri(`//${rand}`);
            console.log(`Generated ${account.address} from Uri //${rand}`);
            promises.push(
                faucet.fundAccount(
                    polkaBtc.api.createType("AccountId", account.address)
                )
            );
        }
        await Promise.all(promises);
        console.log(`Successfully requested ${accountCount} times from faucet`);
    }

}
