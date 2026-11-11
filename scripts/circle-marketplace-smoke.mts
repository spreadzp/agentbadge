#!/usr/bin/env bun
/**
 * Pre-flight smoke for the Circle Agent Marketplace listing.
 * Read-only: no payments, no onchain writes. Verifies that every endpoint
 * we plan to list behaves the way Circle's reviewers/agents will see it.
 *
 * Checks:
 *   1. /health                                  → 200
 *   2. /openapi.json                            → 200, lists our paid routes
 *   3. POST /api/total-scan {}                  → 402 + PAYMENT-REQUIRED decodes:
 *      x402Version=2, accepts[] non-empty, every payTo == EXPECTED_PAYTO,
 *      at least one Arc entry, bazaar extension present
 *   4. POST /api/market/passport {}             → 400 (preCheck: no wallet sig)
 *      — 402 unreachable without sig by design; flagged, not failed
 *   5. POST /api/market/buy/<zero-id>           → 404 unknown serviceId (preCheck)
 *   6. /.well-known/agentbadge-machine.json     → 200 (optional, warns)
 *   7. Circle Discovery API (opt-in --discovery) → our resource indexed
 *
 * Env:
 *   ENDPOINT=https://agentbadge.xyz   — target (default prod)
 *   EXPECTED_PAYTO=0x...              — payout address we submitted to Circle
 *
 * Usage:
 *   EXPECTED_PAYTO=0x... bun run scripts/circle-marketplace-smoke.mts
 *   EXPECTED_PAYTO=0x... bun run scripts/circle-marketplace-smoke.mts --discovery
 */

const ENDPOINT = (process.env.ENDPOINT ?? "https://agentbadge.xyz").replace(/\/$/, "");
const EXPECTED_PAYTO = (process.env.EXPECTED_PAYTO ?? "").toLowerCase();
const CHECK_DISCOVERY = process.argv.includes("--discovery");

const ZERO_ID = `0x${"0".repeat(64)}`;

let pass = 0;
let warn = 0;
let fail = 0;

function ok(name: string, detail = ""): void {
  pass++;
  console.log(`PASS  ${name}${detail ? `  [${detail}]` : ""}`);
}
function wrn(name: string, detail = ""): void {
  warn++;
  console.log(`WARN  ${name}${detail ? `  [${detail}]` : ""}`);
}
function bad(name: string, detail = ""): void {
  fail++;
  console.log(`FAIL  ${name}${detail ? `  [${detail}]` : ""}`);
}

async function post(path: string, body: unknown): Promise<Response> {
  return fetch(`${ENDPOINT}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(15_000),
  });
}

function decodePaymentRequired(res: Response): Record<string, any> | null {
  const h = res.headers.get("PAYMENT-REQUIRED");
  if (!h) return null;
  try {
    return JSON.parse(Buffer.from(h, "base64").toString("utf8"));
  } catch {
    return null;
  }
}

console.log(`=== Circle marketplace pre-flight against ${ENDPOINT} ===\n`);
if (!EXPECTED_PAYTO) wrn("EXPECTED_PAYTO", "not set — payTo checks skipped");

// 1. health
try {
  const res = await fetch(`${ENDPOINT}/health`, { signal: AbortSignal.timeout(10_000) });
  res.status === 200 ? ok("health") : bad("health", `status ${res.status}`);
} catch (e) {
  bad("health", String(e));
}

// 2. openapi
try {
  const res = await fetch(`${ENDPOINT}/openapi.json`, { signal: AbortSignal.timeout(15_000) });
  const text = await res.text();
  if (res.status !== 200) bad("openapi.json", `status ${res.status}`);
  else if (!text.includes("/api/total-scan")) bad("openapi.json", "/api/total-scan not documented");
  else ok("openapi.json", "paid routes documented");
} catch (e) {
  bad("openapi.json", String(e));
}

// 3. total-scan 402 shape
try {
  const res = await post("/api/total-scan", {});
  if (res.status !== 402) {
    bad("total-scan unpaid", `status ${res.status}, expected 402 — payment gate off?`);
  } else {
    const pr = decodePaymentRequired(res);
    if (!pr) {
      bad("total-scan PAYMENT-REQUIRED", "header missing or undecodable");
    } else {
      pr.x402Version === 2
        ? ok("total-scan x402Version", "2")
        : bad("total-scan x402Version", String(pr.x402Version));

      const accepts: any[] = Array.isArray(pr.accepts) ? pr.accepts : [];
      if (accepts.length === 0) {
        bad("total-scan accepts[]", "empty");
      } else {
        ok("total-scan accepts[]", `${accepts.length} entries`);
        const payTos = [...new Set(accepts.map((a) => String(a.payTo ?? "").toLowerCase()))];
        if (EXPECTED_PAYTO) {
          payTos.every((p) => p === EXPECTED_PAYTO)
            ? ok("total-scan payTo", EXPECTED_PAYTO)
            : bad("total-scan payTo", `mismatch — saw ${payTos.join(", ")}, expected ${EXPECTED_PAYTO}`);
        } else {
          wrn("total-scan payTo", payTos.join(", "));
        }
        const networks = accepts.map((a) => String(a.network));
        networks.some((n) => n.includes("5042"))
          ? ok("total-scan Arc rail", networks.join(", "))
          : wrn("total-scan Arc rail", `no eip155:5042* network in ${networks.join(", ")}`);
      }
      pr.extensions?.bazaar
        ? ok("total-scan bazaar ext")
        : wrn("total-scan bazaar ext", "no extensions.bazaar — inputSchema won't reach Discovery API");
      pr.resource?.description ? ok("total-scan description", pr.resource.description) : wrn("total-scan description", "missing");
    }
  }
} catch (e) {
  bad("total-scan unpaid", String(e));
}

// 4. marketplace passport — preCheck requires wallet sig BEFORE the 402,
//    so an unsigned probe must get 400. If we ever get 402 here, sig check broke.
try {
  const res = await post("/api/market/passport", {});
  if (res.status === 400) ok("market passport gate", "400 — sig preCheck before 402 (by design)");
  else if (res.status === 402) bad("market passport gate", "402 without wallet sig — preCheck bypassed!");
  else wrn("market passport gate", `status ${res.status}`);
} catch (e) {
  bad("market passport gate", String(e));
}

// 5. buy unknown serviceId → 404 preCheck
try {
  const res = await post(`/api/market/buy/${ZERO_ID}`, {});
  res.status === 404
    ? ok("market buy preCheck", "404 unknown serviceId")
    : wrn("market buy preCheck", `status ${res.status} — gate off or service exists?`);
} catch (e) {
  bad("market buy preCheck", String(e));
}

// 6. machine descriptor
try {
  const res = await fetch(`${ENDPOINT}/.well-known/agentbadge-machine.json`, {
    signal: AbortSignal.timeout(10_000),
  });
  res.status === 200
    ? ok("machine descriptor")
    : wrn("machine descriptor", `status ${res.status}`);
} catch (e) {
  wrn("machine descriptor", String(e));
}

// 7. Discovery API — only meaningful after Circle approves the listing
if (CHECK_DISCOVERY) {
  try {
    const res = await fetch(
      `https://api.circle.com/v2/x402/discovery/resources?limit=50`,
      { signal: AbortSignal.timeout(15_000) },
    );
    const data = await res.json();
    const items: any[] = data?.items ?? data?.resources ?? [];
    const ours = items.filter((i) => String(i.resource ?? "").includes(new URL(ENDPOINT).hostname));
    ours.length > 0
      ? ok("circle discovery", `${ours.length} resource(s) indexed`)
      : wrn("circle discovery", "not indexed yet (expected if listing pending)");
  } catch (e) {
    wrn("circle discovery", String(e));
  }
}

console.log(`\n=== RESULT: ${pass} PASS, ${warn} WARN, ${fail} FAIL ===`);
process.exit(fail === 0 ? 0 : 1);
