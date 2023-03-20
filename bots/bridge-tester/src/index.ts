import {
  BitcoinNetwork,
  createInterBtcApi,
  InterBtcApi,
  newMonetaryAmount,
  sleep,
} from "@interlay/interbtc-api";
import { KeyringPair } from "@polkadot/keyring/types";
import { Keyring } from "@polkadot/api";
import { cryptoWaitReady } from "@polkadot/util-crypto";

import { MS_IN_AN_HOUR } from "./consts";
import { Issue } from "./issue";
import { Redeem } from "./redeem";
import logger from "./logger";
import { Bitcoin } from "@interlay/monetary-js";

const yargs = require("yargs/yargs");
const { hideBin } = require("yargs/helpers");
const argv = yargs(hideBin(process.argv))
  .option("heartbeats", {
    type: "boolean",
    description:
      "Try to issue and redeem slightly more than the redeem dust value with every registered vault. Mutually exclusive with the `execute-pending-redeems` flag.",
    default: true,
  })
  .option("wait-interval", {
    type: "number",
    description:
      "Delay between rounds of issuing and redeeming with each vault in the system. Example: 2 => issue and redeem every two hours.",
    default: 8,
  })
  .option("execute-pending-redeems", {
    type: "boolean",
    description:
      "Try to execute redeem requests whose BTC payment has already been made. Mutually exclusive with the `heartbeats` flag.",
    default: false,
  }).argv;

enum InputFlag {
  heartbeats,
  executePendingRedeems,
}

function parseArgs(argv: any): [InputFlag, number] {
  if (argv.executePendingRedeems) {
    return [InputFlag.executePendingRedeems, argv.waitInterval * MS_IN_AN_HOUR];
  }
  return [InputFlag.heartbeats, argv.waitInterval * MS_IN_AN_HOUR];
}

let keyring = new Keyring({ type: "sr25519" });

main(...parseArgs(argv)).catch((err) => {
  logger.error("Error during bot operation:");
  logger.error(err);
});

function connectToParachain(): Promise<InterBtcApi> {
  if (!process.env.BITCOIN_NETWORK || !process.env.PARACHAIN_URL) {
    Promise.reject(
      "Parachain URL and Bitcoin network environment variables not set"
    );
  }
  return createInterBtcApi(
    process.env.PARACHAIN_URL as string,
    process.env.BITCOIN_NETWORK as BitcoinNetwork
  );
}

async function heartbeats(
  account: KeyringPair,
  redeemAddress: string
): Promise<void> {
  try {
    const interBtcApi = await connectToParachain();
    interBtcApi.setAccount(account);
    if (
      !process.env.BITCOIN_RPC_HOST ||
      !process.env.BITCOIN_RPC_PORT ||
      !process.env.BITCOIN_RPC_USER ||
      !process.env.BITCOIN_RPC_PASS ||
      !process.env.BITCOIN_NETWORK ||
      !process.env.BITCOIN_RPC_WALLET ||
      !process.env.REDEEM_ADDRESS ||
      !process.env.ISSUE_TOP_UP_AMOUNT
    ) {
      logger.error(
        "Bitcoin Node environment variables not set. Not performing issue and redeem heartbeats."
      );
    } else {
      const issue = new Issue(interBtcApi);
      await issue.performHeartbeatIssues(
        account,
        process.env.BITCOIN_RPC_HOST,
        process.env.BITCOIN_RPC_PORT,
        process.env.BITCOIN_RPC_USER,
        process.env.BITCOIN_RPC_PASS,
        process.env.BITCOIN_NETWORK as BitcoinNetwork,
        process.env.BITCOIN_RPC_WALLET
      );
      const redeem = new Redeem(
        interBtcApi,
        newMonetaryAmount(process.env.ISSUE_TOP_UP_AMOUNT, Bitcoin, true)
      );
      await redeem.performHeartbeatRedeems(
        account,
        redeemAddress,
        process.env.BITCOIN_RPC_HOST,
        process.env.BITCOIN_RPC_PORT,
        process.env.BITCOIN_RPC_USER,
        process.env.BITCOIN_RPC_PASS,
        process.env.BITCOIN_NETWORK as BitcoinNetwork,
        process.env.BITCOIN_RPC_WALLET
      );
      const aliveVaults = await redeem.getAliveVaults();
      logger.info("Vaults that redeemed within the last 12 hours:");
      aliveVaults.forEach((vault) =>
        logger.info(`${vault[0]}, at ${new Date(vault[1]).toLocaleString()}`)
      );
    }
  } catch (error) {
    logger.error(error);
  }
}

async function main(inputFlag: InputFlag, requestWaitingTime: number) {
  if (!process.env.INTERBTC_BOT_ACCOUNT) {
    Promise.reject("Bot account mnemonic not set in the environment");
  }
  await cryptoWaitReady();
  await sleep(5000);
  let account = keyring.addFromUri(`${process.env.INTERBTC_BOT_ACCOUNT}`);
  logger.info(`Bot account: ${account.address}`);
  logger.info(
    `Waiting time between bot runs: ${
      requestWaitingTime / (60 * 60 * 1000)
    } hours`
  );

  switch (inputFlag) {
    case InputFlag.executePendingRedeems: {
      // TODO: Uncomment once index client is finalised
      // if (!process.env.REDEEM_ADDRESS) {
      //     Promise.reject("Redeem Bitcoin address not set in the environment");
      // }
      // const interBtcApi = await connectToParachain();
      // interBtcApi.setAccount(account);
      // const redeem = new Redeem(interBtcApi);
      // await redeem.executePendingRedeems();
      break;
    }
    case InputFlag.heartbeats: {
      heartbeats(account, process.env.REDEEM_ADDRESS as string);
      setInterval(heartbeats, requestWaitingTime, account, process.env.REDEEM_ADDRESS as string);
      break;
    }
  }
}
