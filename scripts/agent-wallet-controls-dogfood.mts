/**
 * SLICE-176-12: dogfood — owner controls end-to-end on a live server
 * against Arc testnet. Proves all four controls with real payments:
 *   velocity deny → hold → approve → retry → settle (txHash) →
 *   suspend → deny → resume → kind_not_allowed deny → audit feed dump.
 *
 * Paid calls shell out to scripts/agent-wallet-x402-pay.mts (EIP-3009
 * self-settle on Arc testnet). Deny codes are captured from its stdout;
 * exit code stays 0 for 402 evidence captures.
 *
 * Env:
 *   BASE             — http://localhost:4021 (default)
 *   AGENT_WALLET_KEY — 0x… payer key, funded USDC on Arc testnet.
 *                      Wallet self-registers → its key is the registrant
 *                      (controller) for envelope/killswitch/approvals.
 *                      Omit → controls still exercised, on-chain settle skipped.
 *   OPERATOR_KEY     — optional extra EOA (display only)
 *   AGENT_WALLET     — reuse an existing agent wallet (or generated)
 *   PAY_URL          — gated endpoint, default /api/keeperhub/scan/premium
 *                      (kindFor() maps it to spend kind "x402")
 *   ARC_RPC          — Arc testnet RPC for the pay script
 */

import { privateKeyToAccount, generatePrivateKey } from "viem/accounts";
import { buildAccessChallenge } from "../src/server/middleware/agent-auth";

const BASE = process.env.BASE ?? "http://localhost:4021";
const PAY_URL = process.env.PAY_URL ?? "/api/eaas/verdicts";
const OPERATOR_KEY = process.env.OPERATOR_KEY as `0x${string}` | undefined;
const AGENT_WALLET_KEY = process.env.AGENT_WALLET_KEY as
  | `0x${string}`
  | undefined;

const operator = OPERATOR_KEY
  ? privateKeyToAccount(OPERATOR_KEY)
  : undefined;
const operatorAddr = operator?.address ?? "n/a";
/** Wallet self-registers — register sig must come from the address itself. */
const agentKey: `0x${string}` =
  AGENT_WALLET_KEY ?? generatePrivateKey();
const agent = privateKeyToAccount(agentKey);
const AGENT_WALLET =
  (process.env.AGENT_WALLET as `0x${string}` | undefined) ?? agent.address;

/** PATCH /envelope REPLACES the caps object — every call sends the full set. */
const ENVELOPE = {
  perTxUsd: 0.02,
  dailyUsd: 1,
  approvalAboveUsd: 0.005,
  maxTxPerHour: 10,
  maxAmountPerHour: 0.5,
  allowedKinds: ["eaas", "x402", "subscription"],
} as const;

let failed = 0;
const step = (msg: string) => console.log(`\n── ${msg}`);
const check = (ok: boolean, msg: string) => {
  console.log(`  ${ok ? "✓" : "✗"} ${msg}`);
  if (!ok) failed += 1;
};

/** EIP-191 over "wallet:method:path:timestamp" — buildAccessChallenge.
 *  signer = key producing the sig; wallet = the x-wallet identity claim.
 *  Self-signed when signer.address === wallet (registrant flow). */
async function signedHeaders(
  signer: { signMessage: (a: { message: string }) => Promise<string> },
  wallet: string,
  method: string,
  path: string,
): Promise<Record<string, string>> {
  const timestamp = Math.floor(Date.now() / 1000);
  const sig = await signer.signMessage({
    message: buildAccessChallenge({ wallet, method, path, timestamp }),
  });
  return {
    "x-wallet": wallet,
    "x-sig": sig,
    "x-timestamp": String(timestamp),
    "content-type": "application/json",
  };
}

async function api(
  method: string,
  path: string,
  wallet: string,
  body?: object,
  signer = agent,
): Promise<{ status: number; json: Record<string, never> }> {
  // Challenge signs the pathname only — c.req.path excludes query.
  const signPath = path.split("?")[0];
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: await signedHeaders(signer, wallet, method, signPath),
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const text = await res.text();
  let json: Record<string, never>;
  try {
    json = JSON.parse(text);
  } catch {
    json = {} as Record<string, never>;
  }
  console.log(`  ${method} ${path} → ${res.status} ${text.slice(0, 160)}`);
  return { status: res.status, json };
}

interface PayResult {
  denied?: string;
  settledTx?: string;
  skipped?: boolean;
  raw: string;
}

/** Paid call via the proven EIP-3009 self-settle script. Runs only when
 *  a real payer key was provided — a generated agent has no USDC. */
async function pay(): Promise<PayResult> {
  if (!AGENT_WALLET_KEY) {
    console.log("  (skip — AGENT_WALLET_KEY not set, no on-chain tx)");
    return { skipped: true, raw: "" };
  }
  const proc = Bun.spawn(["bun", "run", "scripts/agent-wallet-x402-pay.mts"], {
    env: {
      ...process.env,
      AGENT_WALLET_KEY: agentKey,
      ENDPOINT: BASE,
      PAY_URL,
      ...(process.env.ARC_RPC ? { ARC_RPC: process.env.ARC_RPC } : {}),
    },
    stdout: "pipe",
    stderr: "pipe",
  });
  const raw = (await new Response(proc.stdout).text()) +
    (await new Response(proc.stderr).text());
  await proc.exited;
  const deny = raw.match(/"error"\s*:\s*"([a-z_]+)"/)?.[1];
  const settledTx = raw.match(/settled tx: (0x[a-fA-F0-9]+)/)?.[1];
  const interesting = raw
    .split("\n")
    .filter((l) => /broadcast|paid response|deny|settled|error/i.test(l));
  for (const l of interesting) console.log(`  pay: ${l.trim()}`);
  return {
    ...(deny ? { denied: deny } : {}),
    ...(settledTx ? { settledTx } : {}),
    raw,
  };
}

step(`operator ${operatorAddr} · agent ${AGENT_WALLET}`);

step("1. register wallet");
{
  const r = await api(
    "POST",
    "/api/wallets",
    AGENT_WALLET,
    { address: AGENT_WALLET, label: "controls-dogfood", kind: "eoa" },
    agent,
  );
  check(
    [200, 201, 409].includes(r.status),
    `register → ${r.status} (200/201/409 ok)`,
  );
}

step("2. envelope: perTx $0.02 · daily $1 · approve >$0.005 · 10 tx/h · eaas only");
{
  const r = await api(
    "PATCH",
    `/api/wallets/${AGENT_WALLET}/envelope`,
    AGENT_WALLET,
    { ...ENVELOPE },
  );
  check(r.status === 200, `envelope set → ${r.status}`);
}

step("3. velocity deny — clamp maxAmountPerHour=$0.001 < $0.01 → denied velocity_tx");
{
  await api("PATCH", `/api/wallets/${AGENT_WALLET}/envelope`, AGENT_WALLET, {
    ...ENVELOPE,
    maxAmountPerHour: 0.001,
  });
  const r = await pay();
  check((r.denied ?? "").startsWith("velocity_") || r.skipped === true,
    `velocity deny → error=${r.denied ?? "skipped"}`);
  await api("PATCH", `/api/wallets/${AGENT_WALLET}/envelope`, AGENT_WALLET, {
    ...ENVELOPE,
  });
}

step("4. hold — pay > approvalAboveUsd → 402 approval_required + approvalId");
let approvalId: string | undefined;
{
  const r = await pay();
  check(r.denied === "approval_required" || r.skipped === true,
    `hold → error=${r.denied ?? "skipped"}`);
  // pending id from the approvals feed (robust vs stdout parsing)
  const list = await api(
    "GET",
    `/api/wallets/${AGENT_WALLET}/approvals?state=pending`,
    AGENT_WALLET,
  );
  const approvals =
    (list.json as { approvals?: { id: string }[] }).approvals ?? [];
  approvalId = approvals[0]?.id;
  check(Boolean(approvalId), `pending approval listed (id=${approvalId})`);
}

step("5. owner approve → POST .../approvals/:id/approve");
if (approvalId) {
  const r = await api(
    "POST",
    `/api/wallets/${AGENT_WALLET}/approvals/${approvalId}/approve`,
    AGENT_WALLET,
  );
  check(r.status === 200, `approve → ${r.status}`);
}

step("6. retry — same amount/kind → permit consumed → settle (txHash)");
{
  const r = await pay();
  check(Boolean(r.settledTx) || r.skipped === true,
    `settle → tx=${r.settledTx ?? "skipped"}`);
}

step("7. suspend → pay denied spend_suspended → resume");
{
  const s = await api(
    "POST",
    `/api/wallets/${AGENT_WALLET}/suspend`,
    AGENT_WALLET,
  );
  check(s.status === 200, `suspend → ${s.status}`);
  const d = await pay();
  check(d.denied === "spend_suspended" || d.skipped === true,
    `suspended deny → error=${d.denied ?? "skipped"}`);
  const ru = await api(
    "POST",
    `/api/wallets/${AGENT_WALLET}/resume`,
    AGENT_WALLET,
  );
  check(ru.status === 200, `resume → ${ru.status}`);
}
step("8. kind_not_allowed — allowedKinds=[x402] drops eaas → deny → restore");
{
  await api("PATCH", `/api/wallets/${AGENT_WALLET}/envelope`, AGENT_WALLET, {
    ...ENVELOPE,
    allowedKinds: ["x402"],
  });
  const r = await pay();
  check(r.denied === "kind_not_allowed" || r.skipped === true,
    `kind deny → error=${r.denied ?? "skipped"}`);
  await api("PATCH", `/api/wallets/${AGENT_WALLET}/envelope`, AGENT_WALLET, {
    ...ENVELOPE,
  });
}

step("9. audit feed — full control history");
{
  const r = await api("GET", `/api/wallets/${AGENT_WALLET}/audit`, AGENT_WALLET);
  const j = r.json as {
    entries?: { kind: string; state: string; txHash?: string }[];
    alerts?: { type: string }[];
  };
  const types = new Set((j.alerts ?? []).map((a) => a.type));
  console.log(`  entries: ${JSON.stringify(j.entries ?? [])}`);
  console.log(`  alert types: ${JSON.stringify([...types])}`);
  const need = [
    "spend.velocity_denied",
    "approval.requested",
    "approval.decided",
    "approval.consumed",
    "wallet.suspended",
    "wallet.suspended_deny",
    "wallet.resumed",
    "spend.kind_denied",
  ];
  for (const t of need) {
    check(
      types.has(t as never) || AGENT_WALLET_KEY === undefined,
      `audit alert present: ${t}`,
    );
  }
}

console.log(
  failed === 0
    ? "\n== dogfood done — all four controls proven"
    : `\n== dogfood FAILED — ${failed} check(s)`,
);
process.exit(failed === 0 ? 0 : 1);
