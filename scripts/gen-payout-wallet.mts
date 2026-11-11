#!/usr/bin/env bun
/**
 * Generate a dedicated EVM payout wallet (e.g. for Circle Agent Marketplace
 * payouts). Prints a fresh private key + address.
 *
 * SECURITY:
 *   - Run locally only. Never commit the printed key.
 *   - The ADDRESS goes to production env (X402_PAY_TO etc. — it's public).
 *   - The PRIVATE KEY goes ONLY to your local ops env / secrets store —
 *     it is NOT needed on the server (receiving is keyless); you need it
 *     later to sweep USDC out via contracts/scripts/chain-cli.ts.
 *
 * Usage:
 *   bun ./scripts/gen-payout-wallet.mts          # print
 *   bun ./scripts/gen-payout-wallet.mts --json   # machine-readable
 */
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";

const pk = generatePrivateKey();
const account = privateKeyToAccount(pk);

if (process.argv.includes("--json")) {
  console.log(JSON.stringify({ address: account.address, privateKey: pk }));
} else {
  console.log(`Address:     ${account.address}`);
  console.log(`Private key: ${pk}`);
  console.log(`
Next steps:
  1. PROD env (public address only):
       X402_PAY_TO=${account.address}
       MARKETPLACE_TREASURY=${account.address}   # if overriding marketplace fallback
       CIRCLE_SELLER_ADDRESS=${account.address}  # circle-payments runtime seller
  2. OPS env (local secrets store, NOT prod):
       CIRCLE_PAYOUT_KEY=${pk}
  3. Submit ${account.address} as the payout wallet in the Circle
     marketplace seller form (they screen it — it's clean by construction).
  4. Sweep later (USDC on Arc, ERC-20):
       bun ./scripts/chain-cli.ts balance ${account.address} \\
         --network arc-mainnet --token <USDC_ADDR>
       bun ./scripts/chain-cli.ts transfer <TREASURY> <amount> \\
         --network arc-mainnet --token <USDC_ADDR> \\
         --key $CIRCLE_PAYOUT_KEY`);
}
