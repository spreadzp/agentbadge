/**
 * SLICE-191-10 demo: owner-controlled wallet buys a paid data call
 * through the @celo/buy gateway, spend-gated by agent-wallet envelope.
 *
 * Prereqs:
 *   npx @celo/buy@0.8.1 setup --name buy          # wallet → OS keychain
 *   (fund the printed address with USDC on Celo mainnet)
 *
 * Env:
 *   BUY_GATEWAY_ENABLED=true          kill-switch (required)
 *   BUY_WALLET=0x...                  registered wallet (envelope applies)
 *   BUY_FX_API_URL=<capability url>   paid endpoint to buy
 *   BUY_FX_API_METHOD=POST            default POST
 *   BUY_GATEWAY_URL=...               override catalog base (optional)
 *
 * Run:
 *   npx tsx scripts/buy-gateway-demo.mts [query]
 */

import { fetchCatalog, buyQuote, buyPay } from "../src/server/lib/buy/gateway";
import { createBuyFx } from "../src/server/lib/buy/fx-rate";
import { createMemoryAgentWalletStore } from "../src/server/lib/agent-wallet/registry";
import { createMemorySpendLedger } from "../src/server/lib/agent-wallet/ledger";
import { createMemoryApprovalStore } from "../src/server/lib/agent-wallet/approvals";

const WALLET = (process.env.BUY_WALLET ?? "") as `0x${string}`;
const CAPABILITY_URL = process.env.BUY_FX_API_URL;
const QUERY = process.argv[2] ?? "fx";
// Request body must match the capability schema — override per route.
const BODY =
  process.env.BUY_DEMO_BODY ??
  JSON.stringify({ script: "echo hello fx-delta", machineType: "e2-micro" });

async function main() {
  console.log("== buy-gateway demo ==\n");

  if (!CAPABILITY_URL || !WALLET) {
    console.log("Set BUY_FX_API_URL and BUY_WALLET first.");
    console.log("Tip: pick a capability from the catalog below.\n");
  }

  // 1. Free live catalog — pick a capability by description/platform.
  console.log("[1] GET", "https://gateway.usebuy.ai/v1/catalog");
  const catalog = (await fetchCatalog()) as {
    capabilities?: { url?: string; platform?: string; description?: string; price?: string }[];
  };
  const caps = catalog?.capabilities ?? [];
  console.log(`    ${caps.length} capabilities; matching "${QUERY}":`);
  for (const c of caps
    .filter((c) =>
      `${c.platform} ${c.description} ${c.url}`
        .toLowerCase()
        .includes(QUERY.toLowerCase()),
    )
    .slice(0, 8)) {
    console.log(`    - ${c.platform} ${c.price ?? "?"} ${c.url}`);
  }

  if (!CAPABILITY_URL) {
    console.log("\nStopped before quote — set BUY_FX_API_URL to continue.");
    return;
  }

  // 2. Free 402 quote — challenge is the price authority.
  const body = BODY;
  console.log("\n[2] quote", CAPABILITY_URL, body);
  const quote = await buyQuote(
    CAPABILITY_URL,
    process.env.BUY_FX_API_METHOD ?? "POST",
    body,
  );
  console.log("    maxAmountRequired:", quote.maxAmount);

  // 3. Wire the owner-control gate (same deps as prod enforcer).
  const store = createMemoryAgentWalletStore();
  const ledger = createMemorySpendLedger();
  const approvals = createMemoryApprovalStore();
  await store.put({
    address: WALLET,
    label: "buy-demo",
    kind: "eoa",
    envelope: {
      perTxUsd: 0.5,
      dailyUsd: 2,
      approvalAboveUsd: 0.25,
      allowedKinds: ["buy-gateway"],
    },
    registeredBy: WALLET,
    createdAt: Date.now(),
    active: true,
  });
  const gate = { registry: store, ledger, approvals };

  // 4. Pay — envelope checked before spawn; refusal-only retries.
  console.log("\n[3] buyPay (envelope: perTx $0.50, approval >$0.25)");
  const res = await buyPay(quote, WALLET, "demo:buy-gateway", {
    gate,
    maxRetries: 1,
  });
  console.log("    →", res.status, `(${res.attempts} attempt(s))`);
  if (res.txHash) console.log("    tx:", res.txHash);
  if (res.deny) console.log("    deny:", JSON.stringify(res.deny));
  if (res.output) console.log("    output:", res.output.slice(0, 400));

  // 5. Ledger trail + the buyfx adapter path (what FxRefSource sees).
  console.log("\n[4] ledger entries:");
  for (const e of await ledger.listByWallet(WALLET)) {
    console.log(`    ${e.id} ${e.kind} $${e.amountUsd} → ${e.state}`);
  }
  const rates = await createBuyFx({ gate })(["NGN", "KES"]);
  console.log("\n[5] createBuyFx → FxRefSource map:", rates ?? "(skipped)");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
