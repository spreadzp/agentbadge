#!/usr/bin/env bun
/**
 * SLICE-156-7: buyer cross-chain x402 sample — "my USDC is on Base
 * Sepolia, the seller settles on Arc".
 *
 * Flow (all client-side):
 *   1. probe the paid endpoint → 402 accepts[]
 *   2. pick the GatewayWalletBatched accept (cross-chain rail)
 *   3. check unified balance via gatewayBalance() — prints deposit
 *      instructions if underfunded (156-2 deposit-info route)
 *   4. sign EIP-3009 against the GatewayWallet (BatchEvmScheme) and
 *      resend with PAYMENT-SIGNATURE
 *   5. poll GET /api/pay/gateway/transfers/:id until terminal
 *      (settled = done; expired = automatic source refund, 156-5)
 *
 * Env:
 *   ENDPOINT    — server (default http://localhost:4021)
 *   PAY_URL     — paid route (default /api/eaas/status)
 *   BUYER_KEY   — 0x-prefixed buyer EOA key (required)
 *   PAY_METHOD  — HTTP method (default GET; POST + PAY_BODY for verdicts)
 *   PAY_BODY    — JSON body for POST routes
 */
import { privateKeyToAccount } from "viem/accounts";
import { toClientEvmSigner } from "@x402/evm";
import { BatchEvmScheme } from "@circle-fin/x402-batching/client";
import {
  BASE_SEPOLIA,
  gatewayBalance,
  type PaymentRequirements,
} from "@agentbadge/circle-payments";

const ENDPOINT = process.env.ENDPOINT ?? "http://localhost:4021";
const PAY_URL = process.env.PAY_URL ?? "/api/eaas/status";
const METHOD = process.env.PAY_METHOD ?? "GET";
const BODY = process.env.PAY_BODY;
const key = process.env.BUYER_KEY as `0x${string}` | undefined;
if (!key) throw new Error("BUYER_KEY required (buyer EOA private key)");

const account = privateKeyToAccount(key);
const SRC = BASE_SEPOLIA;

async function main() {
  // 1+2. probe → pick the gateway-batch accept (multi-chain settlement)
  const res = await fetch(ENDPOINT + PAY_URL, {
    method: METHOD,
    headers: BODY ? { "Content-Type": "application/json" } : {},
    ...(BODY ? { body: BODY } : {}),
  });
  if (res.status !== 402) {
    console.log(`no 402 (${res.status}) — route not paid or already paid`);
    return;
  }
  const reqJson = await res.json().catch(() => ({}));
  // x402 v2: accepts live in the base64 PAYMENT-REQUIRED header, not body.
  const hdr = res.headers.get("payment-required");
  const hdrJson = hdr
    ? JSON.parse(Buffer.from(hdr, "base64").toString())
    : {};
  const accepts = (hdrJson.accepts ?? reqJson.accepts ??
    []) as PaymentRequirements[];
  // PAY_NETWORK pins the destination accept (e.g. eip155:5042002 →
  // settle on Arc); default = first gateway accept.
  const gw = accepts.filter(
    (a) => a.extra?.name === "GatewayWalletBatched",
  );
  const accept = process.env.PAY_NETWORK
    ? gw.find((a) => a.network === process.env.PAY_NETWORK)
    : gw[0];
  if (!accept) {
    console.log("no gateway-batch accept — buyer rail unavailable");
    return;
  }
  console.log(
    `accept: ${accept.network} ${accept.amount} atomic ` +
      `feeHint=${JSON.stringify(accept.extra?.gatewayFeeHint ?? null)}`,
  );

  // 3. unified balance check → guided deposit if underfunded
  const bal = await gatewayBalance({
    depositor: account.address,
    chain: SRC,
  }).catch(() => null);
  if (bal && BigInt(bal.totalAtomic ?? "0") < BigInt(accept.amount)) {
    console.log(
      `underfunded: unified balance ${bal.totalAtomic} < ${accept.amount}\n` +
        `deposit: ${ENDPOINT}/api/pay/gateway/deposit-info ` +
        `(transfer USDC on ${SRC.name} → GatewayWallet)`,
    );
    return;
  }

  // 4. sign + pay — EIP-3009 to GatewayWallet, not the USDC contract
  const signer = toClientEvmSigner(account);
  const scheme = new BatchEvmScheme(signer as never);
  const { x402Version, payload } = await scheme.createPaymentPayload(
    2,
    accept as never,
  );
  // Server matches paymentPayload.accepted against its advertised
  // accepts (scheme+network+asset+extra.name) — echo the chosen entry.
  const sig = Buffer.from(
    JSON.stringify({
      x402Version,
      payload,
      accepted: accept,
      // Circle facilitator requires paymentPayload.resource on verify.
      resource: hdrJson.resource,
    }),
  ).toString("base64");
  const paid = await fetch(ENDPOINT + PAY_URL, {
    method: METHOD,
    headers: {
      "PAYMENT-SIGNATURE": sig,
      ...(BODY ? { "Content-Type": "application/json" } : {}),
    },
    ...(BODY ? { body: BODY } : {}),
  });
  console.log(`paid: ${paid.status}`);
  const receipt = paid.headers.get("x-payment-response");
  const decoded = receipt
    ? JSON.parse(Buffer.from(receipt, "base64").toString())
    : {};
  const tx = decoded.transaction ?? decoded.transferId;
  console.log(`receipt tx/transferId: ${tx ?? "(none — sync settle)"}`);
  console.log((await paid.text()).slice(0, 300));

  // 5. poll transfer status until terminal (156-5 endpoint)
  if (!tx) return;
  for (let i = 0; i < 12; i++) {
    await new Promise((r) => setTimeout(r, 5_000));
    const st = await (
      await fetch(`${ENDPOINT}/api/pay/gateway/transfers/${tx}`)
    ).json();
    console.log(`transfer ${String(tx).slice(0, 8)}… ${st.state ?? st.status}`);
    if (st.terminal || ["settled", "expired", "failed"].includes(st.state))
      break;
  }
}

await main();
