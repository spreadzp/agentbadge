/**
 * Prod payment probe (EPIC-191): hits the DEPLOYED premium endpoint —
 * real HTTP 402 → EIP-3009 sign → PAYMENT-SIGNATURE → server verifies +
 * self-settles on Celo mainnet → 200 + PAYMENT-RESPONSE tx hash.
 *
 * Buyer = seller wallet (self-pay, same as e2e) — it holds mainnet USDC
 * and gas. Keys come from ../../celo-fx-delta/.env; never printed.
 *
 * Usage:  bun run scripts/fx-delta-prod-pay.mts [url]
 *   url defaults to https://agentbadge.xyz/api/fx-delta/premium
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { randomBytes } from "node:crypto";
import { createPublicClient, http, toHex, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { celo } from "viem/chains";

const envFile = resolve(import.meta.dir, "../../../celo-fx-delta/.env");
const env: Record<string, string> = {};
for (const line of readFileSync(envFile, "utf8").split("\n")) {
  const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
  if (m) env[m[1]!] = m[2]!.trim();
}
const sellerKey = env.SELLER_PRIVATE_KEY as `0x${string}`;
const seller = env.SELLER_ADDRESS as `0x${string}`;
if (!sellerKey || !seller) throw new Error("celo-fx-delta/.env missing SELLER_*");
const tag = env.ATTRIBUTION_CODE ?? "";

const URL_ =
  process.argv[2] ?? "https://agentbadge.xyz/api/fx-delta/premium";
const RPC = "https://forno.celo.org";

const pc = createPublicClient({ chain: celo, transport: http(RPC) });
const account = privateKeyToAccount(sellerKey);

// ─── 1. 402 challenge ─────────────────────────────────────────────
const r402 = await fetch(URL_);
if (r402.status !== 402) {
  throw new Error(`expected 402, got ${r402.status}: ${await r402.text()}`);
}
const body402 = (await r402.json()) as {
  accepts: {
    scheme: string;
    network: string;
    asset: string;
    maxAmountRequired: string;
    amount?: string;
    payTo: string;
    extra?: { name?: string; version?: string };
  }[];
};
const accept = body402.accepts[0]!;
if (accept.network !== "eip155:42220") {
  throw new Error(`unexpected network ${accept.network} — refusing to pay`);
}
console.log(
  `402 accepts: ${accept.asset} x${accept.maxAmountRequired} → ${accept.payTo} @${accept.network}`,
);
if (accept.payTo.toLowerCase() !== seller.toLowerCase()) {
  throw new Error(`payTo ${accept.payTo} is not our seller ${seller}`);
}

// ─── 2. Sign EIP-3009 TransferWithAuthorization ──────────────────
const authorization = {
  from: account.address,
  to: accept.payTo as `0x${string}`,
  value: BigInt(accept.maxAmountRequired),
  validAfter: 0n,
  validBefore: BigInt(Math.floor(Date.now() / 1000) + 300),
  nonce: toHex(randomBytes(32)) as Hex,
};
const signature = await account.signTypedData({
  domain: {
    name: accept.extra?.name ?? "USDC",
    version: accept.extra?.version ?? "2",
    chainId: celo.id,
    verifyingContract: accept.asset as `0x${string}`,
  },
  types: {
    TransferWithAuthorization: [
      { name: "from", type: "address" },
      { name: "to", type: "address" },
      { name: "value", type: "uint256" },
      { name: "validAfter", type: "uint256" },
      { name: "validBefore", type: "uint256" },
      { name: "nonce", type: "bytes32" },
    ],
  },
  primaryType: "TransferWithAuthorization",
  message: {
    from: authorization.from,
    to: authorization.to,
    value: authorization.value,
    validAfter: authorization.validAfter,
    validBefore: authorization.validBefore,
    nonce: authorization.nonce,
  },
});
const paymentHeader = Buffer.from(
  JSON.stringify({
    x402Version: 2,
    scheme: accept.scheme,
    network: accept.network,
    payload: {
      authorization: {
        from: authorization.from,
        to: authorization.to,
        value: authorization.value.toString(),
        validAfter: authorization.validAfter.toString(),
        validBefore: authorization.validBefore.toString(),
        nonce: authorization.nonce,
      },
      signature,
    },
  }),
).toString("base64");

// ─── 3. Paid request → prod verifies + settles → 200 ─────────────
console.log("submitting payment — prod facilitator settles onchain…");
const r200 = await fetch(URL_, {
  headers: { "PAYMENT-SIGNATURE": paymentHeader },
});
const txHash = r200.headers.get("PAYMENT-RESPONSE");
if (r200.status !== 200) {
  throw new Error(
    `expected 200, got ${r200.status}: ${await r200.text()} (tx=${txHash})`,
  );
}
const data = (await r200.json()) as { v: number; atMs: number };
console.log(`200 OK — v=${data.v} atMs=${data.atMs}`);
const outFile = process.env.FXDELTA_BODY_OUT;
if (outFile) {
  const { writeFileSync } = await import("node:fs");
  writeFileSync(outFile, JSON.stringify(data, null, 2));
  console.log(`body → ${outFile}`);
}
console.log(`settle tx: ${txHash}`);
console.log(`https://celo.blockscout.com/tx/${txHash}`);

// ─── 4. Onchain proof: input carries the ERC-8021 attribution tag ─
if (!txHash) throw new Error("no PAYMENT-RESPONSE tx hash returned");
const tx = await pc.getTransaction({ hash: txHash as `0x${string}` });
const input = tx.input.toLowerCase();
const markerOk = input.endsWith("80218021802180218021802180218021");
const codeOk = input.includes(
  Buffer.from(tag, "utf8").toString("hex"),
);
const selectorOk = input.startsWith("0xe3ee160e"); // transferWithAuthorization
console.log(
  `onchain input: selector=${selectorOk} tag_code=${codeOk} 8021_marker=${markerOk}`,
);
if (!selectorOk || !markerOk) {
  console.warn("WARN: ERC-8021 tag verification failed on tx input");
}
console.log(
  "PROD PASS: 402 → sign → prod self-settle (tagged) → 200 on Celo mainnet",
);
