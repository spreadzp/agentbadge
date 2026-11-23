// EPIC-262 (SLICE-262-30 early dogfooding): run agentbadge.xyz
// through the REAL pipeline — real routes, real safeFetch over the
// network, real ruleset + signing. Only persistence is memory.
// Usage: bun run scripts/intel-dogfood.mts [hostname]
import { Hono } from "hono";
import {
  createMemoryIntelRegistry,
  createIntelRegistryService,
} from "../src/server/lib/intel/registry";
import { inviteOperator } from "../src/server/lib/intel/registry/operators";
import { createMemoryIntelEvidenceStore } from "../src/server/lib/intel/evidence/store";
import { createMemoryEntitlementStore } from "../src/server/lib/intel/entitlement";
import {
  createMemoryIntelConsentStore,
  grantConsent,
} from "../src/server/lib/intel/consent";
import { createMemoryScanJobStore } from "../src/server/lib/intel/scan/memory";
import {
  createSafeScanFetch,
  SCAN_PLAN,
} from "../src/server/lib/intel/scan";
import { INTEL_WP_PROFILE_V1 } from "../src/server/lib/intel/rules";
import { createIntelApiRoutes, createIntelUiRoutes } from "../src/server/routes/intel";
import { resolveIntelSigningKey } from "../src/server/lib/intel/keys";
import { createMemoryIntelClientReportStore } from "../src/server/lib/intel/client-report";

const HOST = process.argv[2] ?? "agentbadge.xyz";

const key = resolveIntelSigningKey({
  enabled: true,
  keyId: "intel-dogfood-1",
  signingPrivateKey: Buffer.alloc(32, 9).toString("base64"),
})!;

async function main() {
  console.log(`\n=== EPIC-262 dogfood: ${HOST} through the real pipeline ===\n`);

  // ── registry: tenant → customer → site → site_key ──
  const stores = createMemoryIntelRegistry();
  const registry = createIntelRegistryService(stores);
  const tenant = await registry.createTenant({ slug: "agentbadge", name: "AgentBadge" });
  const customer = await registry.createCustomer(tenant.id, { name: "self" });
  const site = await registry.createSite(customer.id, { domains: [HOST] });
  const siteKey = (await registry.mintSiteKey(site.id)).plaintext;
  const op = await inviteOperator(stores, tenant.id, { email: "op@agentbadge.xyz", role: "operator" });
  console.log(`site ${site.id} · tenant ${tenant.id} · keys minted`);

  // ── consent + entitlement (required gates) ──
  const consent = createMemoryIntelConsentStore();
  await grantConsent(consent, site.id, "audit", { principal: "site_key", id: "dogfood" });
  const entitlement = createMemoryEntitlementStore();
  const now = new Date().toISOString();
  await entitlement.upsert({
    id: "ent_dogfood", tenantId: tenant.id, plan: "pilot", status: "active",
    coveredSiteIds: [site.id], perSiteLimits: {},
    validFrom: "2020-01-01T00:00:00Z", validUntil: "2030-01-01T00:00:00Z",
    graceUntil: "2030-01-08T00:00:00Z", createdAt: now, updatedAt: now,
  });
  console.log("audit consent granted · entitlement active\n");

  // ── real routes + REAL network fetch ──
  const evidence = createMemoryIntelEvidenceStore();
  const scanJobs = createMemoryScanJobStore();
  const clientReports = createMemoryIntelClientReportStore();
  const deps = {
    key, registry, registryStores: stores,
    evidence, evidenceRetentionDays: 400, entitlement, scanJobs,
    ruleset: INTEL_WP_PROFILE_V1,
    scanFetch: createSafeScanFetch(), // ← real network, SSRF-pinned
    consent, clientReports,
  };
  const app = new Hono();
  app.route("/api/intel", createIntelApiRoutes(deps));
  app.route("/intel", createIntelUiRoutes(deps));

  console.log(`POST /api/intel/scans — ${SCAN_PLAN.length} probes against https://${HOST} …\n`);
  const t0 = Date.now();
  const res = await app.request("/api/intel/scans", {
    method: "POST",
    headers: { authorization: `Bearer ${siteKey}` },
  });
  const body = await res.json() as {
    job?: { id: string; status: string; probeFailures: number; error?: string };
    report?: {
      scores: { readiness: { score: number | null }; exposure: { score: number | null } };
      findings: { rule_id: string; status: string; name: string }[];
      integrity: { content_hash: string };
      evidence: { envelope_count: number; provenance: Record<string, number> };
      previous_hash: string | null;
    };
    error?: string;
  };
  console.log(`→ ${res.status} in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  if (!body.report) {
    console.log("NO REPORT — job:", JSON.stringify(body.job ?? body, null, 2));
    process.exit(1);
  }
  const r = body.report!;
  console.log(`job ${body.job!.id} = ${body.job!.status} (${body.job!.probeFailures} probe failures)`);
  console.log(`readiness ${r.scores.readiness.score ?? "—"} · exposure ${r.scores.exposure.score ?? "—"} · envelopes ${r.evidence.envelope_count} (${Object.entries(r.evidence.provenance).map(([k, v]) => `${k}:${v}`).join(" ")})`);
  console.log(`hash ${r.integrity.content_hash.slice(0, 24)}… · chain ${r.previous_hash ?? "genesis"}\n`);

  const order = { fail: 0, warn: 1, unknown: 2, pass: 3 } as Record<string, number>;
  console.log("— findings (fails/unknowns first) —");
  for (const f of [...r.findings].sort((a, b) => order[a.status] - order[b.status])) {
    const mark = f.status === "fail" ? "✗" : f.status === "warn" ? "!" : f.status === "unknown" ? "?" : "·";
    console.log(` ${mark} [${f.status.padEnd(7)}] ${f.rule_id.padEnd(17)} ${f.name}`);
  }

  // ── second scan → previous_hash chain ──
  console.log("\n— second scan → chain check —");
  const res2 = await app.request("/api/intel/scans", {
    method: "POST",
    headers: { authorization: `Bearer ${siteKey}` },
  });
  const b2 = await res2.json() as { report?: { previous_hash: string | null; integrity: { content_hash: string } } };
  console.log(`prev_hash = ${b2.report?.previous_hash?.slice(0, 30)}… (expected: first report hash ${r.integrity.content_hash.slice(0, 22)}…)`);
  console.log(`chain ok: ${b2.report?.previous_hash === r.integrity.content_hash}`);

  // ── dashboard render via operator session ──
  console.log("\n— operator dashboard render —");
  const login = await app.request("/intel/login", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: `key=${encodeURIComponent(op.plaintext)}`,
  });
  const cookie = login.headers.get("set-cookie")!.split(";")[0];
  const portfolio = await (await app.request("/intel", { headers: { cookie } })).text();
  const sitePage = await (await app.request(`/intel/sites/${site.id}`, { headers: { cookie } })).text();
  const job = (await scanJobs.forSite(site.id))[0];
  const reportPage = await (await app.request(`/intel/reports/${job.id}`, { headers: { cookie } })).text();
  console.log(`portfolio ${portfolio.length}b · site page ${sitePage.length}b · report page ${reportPage.length}b`);
  console.log(`site page shows scores: ${sitePage.includes("Agent readiness") && sitePage.includes("Surface exposure")}`);
  console.log(`site page shows MoM line: ${sitePage.includes("vs previous scan")}`);

  // ── client report generation ──
  const cr = await app.request(`/intel/sites/${site.id}/client-report`, {
    method: "POST", headers: { cookie },
  });
  const crId = cr.headers.get("location")!.split("/").pop()!;
  const crPage = await (await app.request(`/intel/client-reports/${crId}`, { headers: { cookie } })).text();
  const crMd = await (await app.request(`/intel/client-reports/${crId}.md`, { headers: { cookie } })).text();
  console.log(`client report ${crId}: html ${crPage.length}b · md ${crMd.length}b · delta in md: ${crMd.includes("Finding delta")}`);

  // save canonical report for review
  const { writeFileSync } = await import("node:fs");
  writeFileSync("/tmp/dogfood-report.json", JSON.stringify(body.report, null, 2));
  console.log("\nreport saved → /tmp/dogfood-report.json");
}

main().catch((e) => { console.error("dogfood failed:", e); process.exit(1); });
