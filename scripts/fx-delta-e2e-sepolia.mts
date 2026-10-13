/**
 * SLICE-191-6 e2e — x402 self-settle on Celo Sepolia (deferred AC).
 *
 * In-process Hono app with the real fx-delta premium gate + REAL onchain
 * settle: 402 → EIP-3009 sign (self-pay) → PAYMENT-SIGNATURE → verify →
 * our tagged transferWithAuthorization tx → 200 + PAYMENT-RESPONSE txHash
 * → onchain decode proves the ERC-8021 suffix.
 *
 * Keys come from ../../celo-fx-delta/.env (SELLER_PRIVATE_KEY,
 * SELLER_ADDRESS, ATTRIBUTION_CODE). Sepolia is forced — never mainnet.
 *
 * Run: bun scripts/fx-delta-e2e-sepolia.mts
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { Hono } from "hono";
import {
  createPublicClient,
  http,
  toHex,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { celoSepolia } from "viem/chains";
import { randomBytes } from "node:crypto";

// ─── env: seller key/tag from celo-fx-delta/.env, chain forced to sepolia ──
const envFile = resolve(import.meta.dir, "../../../celo-fx-delta/.env");
const env: Record<string, string> = {};
for (const line of readFileSync(envFile, "utf8").split("\n")) {
  const m = line.match(/^\s*([A-Z_]+)\s*=\s*(.+?)\s*$/);
  if (m && !line.trim().startsWith("#")) env[m[1]!] = m[2]!;
}
const sellerKey = env.SELLER_PRIVATE_KEY as `0x${string}`;
const seller = env.SELLER_ADDRESS as `0x${string}`;
if (!sellerKey || !seller) throw new Error("celo-fx-delta/.env missing SELLER_*");

process.env.FXDELTA_PAY_TO = seller;
process.env.X402_PAY_TO = seller;
process.env.SELLER_PRIVATE_KEY = sellerKey;
process.env.ATTRIBUTION_CODE =
  env.ATTRIBUTION_CODE ?? "celo_24acc530146f";
process.env.X402_MODE = "self";
process.env.CELO_CHAIN_ID = "11142220";
process.env.CELO_RPC_URL =
  "https://forno.celo-sepolia.celo-testnet.org";

// imports AFTER env — facilitator singleton is lazy but routes read env too
const { fxDeltaRoutes } = await import("../src/server/routes/fx-delta-api");
const { setFxDeltaRuntime } = await import("../src/server/lib/fx-delta");
const { CELO_SEPOLIA_X402_ASSETS, CELO_X402_NETWORK_SEPOLIA } =
  await import("../src/server/lib/fx-delta/celo-assets");

// Stub runtime — payment path is under test, not the feed engine.
setFxDeltaRuntime({
  engine: {
    getAll: () => [],
    getView: () => null,
    getHistory: () => [],
    getEvents: () => [],
  },
  corridors: [],
  sources: () => ({
    uniswap: { connected: false, lastTickMs: 0 },
    mento: { connected: false, lastTickMs: 0 },
    fxRef: { connected: false, lastTickMs: 0 },
  }),
  startedAtMs: Date.now(),
});

const USDC = CELO_SEPOLIA_X402_ASSETS.USDC;
const pc = createPublicClient({
  chain: celoSepolia,
  transport: http(process.env.CELO_RPC_URL),
});
const account = privateKeyToAccount(sellerKey);

const usdcOf = (raw: bigint) => `${Number(raw) / 1e6} USDC`;
const readBal = () =>
  pc.readContract({
    address: USDC.address as `0x${string}`,
    abi: [
      {
        name: "balanceOf",
        type: "function",
        stateMutability: "view",
        inputs: [{ name: "a", type: "address" }],
        outputs: [{ type: "uint256" }],
      },
    ],
    functionName: "balanceOf",
    args: [seller],
  } as never) as Promise<bigint>;

console.log(`seller/payer: ${seller} (self-pay)`);
console.log(`sepolia USDC: ${USDC.address}  network: ${CELO_X402_NETWORK_SEPOLIA}`);
console.log(`tag: ${process.env.ATTRIBUTION_CODE}`);
const before = await readBal();
console.log(`USDC before: ${usdcOf(before)}`);

// ─── 1. 402 challenge ─────────────────────────────────────────────
const app = new Hono();
app.route("/", fxDeltaRoutes);
const r402 = await app.request("/api/fx-delta/premium");
if (r402.status !== 402) {
  throw new Error(`expected 402, got ${r402.status}: ${await r402.text()}`);
}
const body402 = (await r402.json()) as {
  accepts: {
    scheme: string;
    network: string;
    asset: string;
    maxAmountRequired: string;
    payTo: string;
    extra?: { name?: string; version?: string };
  }[];
};
const accept =
  body402.accepts.find(
    (a) => a.asset.toLowerCase() === USDC.address.toLowerCase(),
  ) ?? body402.accepts[0]!;
console.log(
  `402 accepts: ${accept.asset} x${accept.maxAmountRequired} → ${accept.payTo} @${accept.network}`,
);

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
    name: accept.extra?.name ?? USDC.name,
    version: accept.extra?.version ?? USDC.version,
    chainId: celoSepolia.id,
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
    ...authorization,
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

// ─── 3. Paid request → verify → settle (our tagged tx) → 200 ─────
console.log("submitting payment — facilitator settles onchain…");
const r200 = await app.request("/api/fx-delta/premium", {
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
console.log(`settle tx: ${txHash}`);
console.log(`https://celo-sepolia.blockscout.com/tx/${txHash}`);

// ─── 4. Onchain proof: input ends with ERC-8021 suffix + our code ─
const tx = await pc.getTransaction({ hash: txHash as `0x${string}` });
const input = tx.input.toLowerCase();
const markerOk = input.endsWith("80218021802180218021802180218021");
const codeHex = Buffer.from(process.env.ATTRIBUTION_CODE!, "utf8").toString(
  "hex",
);
const codeOk = input.includes(codeHex);
const selectorOk = input.startsWith("0xe3ee160e"); // transferWithAuthorization
console.log(`onchain input: selector=${selectorOk} tag_code=${codeOk} 8021_marker=${markerOk}`);
if (!selectorOk || !codeOk || !markerOk) {
  throw new Error("ERC-8021 tag verification failed on tx input");
}

const after = await readBal();
console.log(`USDC after: ${usdcOf(after)} (paid ${usdcOf(before - after)})`);
console.log("E2E PASS: 402 → sign → self-settle (tagged) → 200 on Celo Sepolia");
