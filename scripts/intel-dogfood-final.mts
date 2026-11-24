// EPIC-262 (SLICE-262-30 FINAL dogfood — server surface): the whole
// trust loop end-to-end as an acceptance GATE. Real routes, real
// safeFetch over the network, real signing — only persistence is
// memory. Each step asserts; any FAIL exits 1.
//   registry → consent(audit+publication) → entitlement(assignPlan)
//   → scan×2 (chain) → attest (sig verify) → public verify page
//   → report-diff (signed, sarif) → alerts → export
//   → billing webhook (stripe, HMAC) → transfer (authority reset)
//   → re-activation
// Usage: bun run scripts/intel-dogfood-final.mts [hostname]
import { Hono } from "hono";
import { createHmac } from "node:crypto";
import {
  createMemoryIntelRegistry,
  createIntelRegistryService,
} from "../src/server/lib/intel/registry";
import { inviteOperator } from "../src/server/lib/intel/registry/operators";
import { createMemoryIntelEvidenceStore } from "../src/server/lib/intel/evidence/store";
import {
  createMemoryEntitlementStore,
  createMemoryEntitlementEventStore,
  assignPlan,
} from "../src/server/lib/intel/entitlement";
import {
  createMemoryIntelConsentStore,
  grantConsent,
  hasActiveConsent,
} from "../src/server/lib/intel/consent";
import { createMemoryScanJobStore } from "../src/server/lib/intel/scan/memory";
import { createSafeScanFetch } from "../src/server/lib/intel/scan";
import { INTEL_WP_PROFILE_V1 } from "../src/server/lib/intel/rules";
import {
  createIntelApiRoutes,
  createIntelVerifyRoutes,
} from "../src/server/routes/intel";
import { resolveIntelSigningKey } from "../src/server/lib/intel/keys";
import { createMemoryIntelClientReportStore } from "../src/server/lib/intel/client-report";
import { createMemoryAttestationStore, verifyAttestation } from "../src/server/lib/intel/attestation";
import { verifyReportDiff } from "../src/server/lib/intel/report-diff";

const HOST = process.argv[2] ?? "agentbadge.xyz";
const STRIPE_SECRET = "whsec_dogfood";

const key = resolveIntelSigningKey({
  enabled: true,
  keyId: "intel-dogfood-final",
  signingPrivateKey: Buffer.alloc(32, 9).toString("base64"),
})!;

let passed = 0, failed = 0;
const check = (name: string, cond: boolean, detail = "") => {
  if (cond) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; console.log(`  ✗ FAIL ${name}${detail ? ` — ${detail}` : ""}`); }
};

const stripeSig = (body: string) => {
  const t = Math.floor(Date.now() / 1000);
  const v1 = createHmac("sha256", STRIPE_SECRET).update(`${t}.${body}`).digest("hex");
  return `t=${t},v1=${v1}`;
};

async function main() {
  console.log(`\n=== EPIC-262 FINAL dogfood (server): ${HOST} — full trust loop ===\n`);

  const stores = createMemoryIntelRegistry();
  const registry = createIntelRegistryService(stores);
  const consent = createMemoryIntelConsentStore();
  const entitlement = createMemoryEntitlementStore();
  const entEvents = createMemoryEntitlementEventStore();
  const evidence = createMemoryIntelEvidenceStore();
  const scanJobs = createMemoryScanJobStore();
  const attestations = createMemoryAttestationStore();
  const clientReports = createMemoryIntelClientReportStore();

  // ── setup ──
  const tenant = await registry.createTenant({ slug: "agentbadge", name: "AgentBadge" });
  const customer = await registry.createCustomer(tenant.id, { name: "self" });
  const site = await registry.createSite(customer.id, { domains: [HOST] });
  const siteKey = (await registry.mintSiteKey(site.id)).plaintext;
  const op = await inviteOperator(stores, tenant.id, { email: "op@ab.dev", role: "operator" });
  const viewer = await inviteOperator(stores, tenant.id, { email: "v@ab.dev", role: "viewer" });
  await registry.recordOwnershipProof(site.id, "domain_control", {
    method: "dns_txt", verifiedAt: new Date(),
  });
  await grantConsent(consent, site.id, "audit", { principal: "site_key", id: "dogfood" });
  await grantConsent(consent, site.id, "publication", { principal: "operator", id: op.record.id });
  const now = new Date().toISOString();
  await assignPlan(
    { entitlements: entitlement, events: entEvents },
    { tenantId: tenant.id, planCode: "pilot", tenantSiteIds: [site.id], now, actor: { principal: "operator", id: op.record.id } },
  );

  const deps = {
    key, registry, registryStores: stores,
    evidence, evidenceRetentionDays: 400, entitlement, scanJobs,
    ruleset: INTEL_WP_PROFILE_V1,
    scanFetch: createSafeScanFetch(), // real network, SSRF-pinned
    consent, clientReports, attestations,
    entitlementEvents: entEvents,
    billingSecrets: { stripe: STRIPE_SECRET },
  };
  const app = new Hono();
  app.route("/api/intel", createIntelApiRoutes(deps));
  app.route("/", createIntelVerifyRoutes(deps));

  const jpost = (p: string, tok: string, body?: unknown) =>
    app.request(`/api/intel${p}`, {
      method: "POST",
      headers: { authorization: `Bearer ${tok}`, ...(body ? { "content-type": "application/json" } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
  const jget = (p: string, tok: string) =>
    app.request(`/api/intel${p}`, { headers: { authorization: `Bearer ${tok}` } });

  // ── scan ×2 + chain ──
  console.log("— scan ×2 (real network) —");
  const r1 = await (await jpost("/scans", siteKey)).json() as any;
  check("scan1 report produced", !!r1.report);
  check("scan1 0 probe failures", r1.job?.probeFailures === 0, `${r1.job?.probeFailures}`);
  check(
    "provenance all EXTERNAL_OBSERVED",
    Object.keys(r1.report?.evidence?.provenance ?? {}).every((k) => k === "EXTERNAL_OBSERVED"),
    JSON.stringify(r1.report?.evidence?.provenance),
  );
  check("scores present", typeof r1.report?.scores?.readiness?.score === "number");
  const job1 = r1.job.id;
  const r2 = await (await jpost("/scans", siteKey)).json() as any;
  check("hash chain: scan2.previous = scan1.hash",
    r2.report?.previous_hash === r1.report?.integrity?.content_hash);
  console.log(`  readiness ${r1.report?.scores?.readiness?.score} · exposure ${r1.report?.scores?.exposure?.score}`);

  // ── attestation + sig verify ──
  console.log("— attestation —");
  const job = (await scanJobs.forSite(site.id)).find((x) => x.id === job1)!;
  const attRes = await jpost(`/scans/${job.scanId}/attest`, op.plaintext);
  check("attest 2xx", attRes.status === 200 || attRes.status === 201, `${attRes.status}`);
  const att = (await attRes.json() as any).attestation;
  const v = await verifyAttestation(att, [{ keyId: key.keyId, publicKey: key.publicKey }]);
  check("attestation signature verifies", v.ok === true, JSON.stringify(v));
  check("attestation bound to report bytes", att.content_hash === r1.report.integrity.content_hash);

  // ── public verify page ──
  console.log("— public verification —");
  const page = await app.request(`/verify/agent-surface/${site.id}`);
  check("verify page 200 (publication consent)", page.status === 200, `${page.status}`);
  const html = await page.text();
  check("verify page shows ACTIVE", /active/i.test(html));
  const json = await app.request(`/verify/agent-surface/${site.id}`, {
    headers: { accept: "application/json" },
  });
  const vj = await json.json() as any;
  check("verify JSON signature_valid", vj.signature_valid === true);

  // ── report-diff (site_key) ──
  console.log("— report-diff —");
  const diff = await jget(`/report-diff?site=${site.id}`, siteKey);
  check("report-diff 200", diff.status === 200, `${diff.status}`);
  const dp = await diff.json() as any;
  check("diff mode = diff (chain-resolved)", dp.mode === "diff", dp.mode);
  const dv = await verifyReportDiff(dp, [{ keyId: key.keyId, publicKey: key.publicKey }]);
  check("diff signature verifies", dv.ok === true);
  const sarif = await jget(`/report-diff?site=${site.id}&format=sarif`, siteKey);
  const sj = await sarif.json() as any;
  check("SARIF 2.1.0 shape", sj.version === "2.1.0" && Array.isArray(sj.runs?.[0]?.results));

  // ── alerts ──
  console.log("— alerts feed —");
  const alerts = await (await jget("/alerts", op.plaintext)).json() as any;
  check("alerts is array", Array.isArray(alerts.alerts ?? alerts));

  // ── export ──
  console.log("— export —");
  const ex = await (await jget("/export", viewer.plaintext)).json() as any;
  check("export format agentbadge-export/1", ex.format === "agentbadge-export/1");
  check("export has no keyHash", !JSON.stringify(ex).includes("keyHash"));
  check("export carries attestations", ex.sites?.[0]?.attestations?.length === 1);

  // ── billing webhook e2e (stripe, real HMAC) ──
  console.log("— billing webhook —");
  const stripeBody = JSON.stringify({
    id: "evt_dogfood", type: "invoice.payment_failed",
    created: Math.floor(Date.now() / 1000),
    data: { object: { metadata: { tenant_id: tenant.id } } },
  });
  const billRes = await app.request("/api/intel/billing/webhook/stripe", {
    method: "POST",
    headers: { "content-type": "application/json", "stripe-signature": stripeSig(stripeBody) },
    body: stripeBody,
  });
  check("webhook applied", billRes.status === 200 && (await billRes.json() as any).results?.[0]?.applied === true);
  check("entitlement → past_due", (await entitlement.getByTenant(tenant.id))?.status === "past_due");

  // ── transfer to tenant B (authority reset) ──
  console.log("— transfer —");
  const tenant2 = await registry.createTenant({ slug: "agency", name: "Agency" });
  const customer2 = await registry.createCustomer(tenant2.id, { name: "A" });
  const op2 = await inviteOperator(stores, tenant2.id, { email: "o@a.dev", role: "operator" });
  await assignPlan(
    { entitlements: entitlement, events: entEvents },
    { tenantId: tenant2.id, planCode: "pilot", tenantSiteIds: [], now, actor: { principal: "operator", id: op2.record.id } },
  );
  const tr = await jpost(`/sites/${site.id}/transfer`, op.plaintext, { to_customer: customer2.id });
  check("transfer 200", tr.status === 200, `${tr.status}`);
  const tj = await tr.json() as any;
  check("site_id preserved", tj.site?.id === site.id);
  check("consent revoked by transfer", tj.consent_revocations === 2);
  check("audit consent dead post-transfer", !(await hasActiveConsent(consent, site.id, "audit")));
  // publication revoked → verify page goes dark immediately
  const dark = await app.request(`/verify/agent-surface/${site.id}`);
  check("verify page 404 post-transfer (publication revoked)", dark.status === 404);
  // old tenant locked out
  const locked = await jpost(`/sites/${site.id}/transfer`, op.plaintext, { to_customer: customer.id });
  check("old tenant 404 (access lost)", locked.status === 404);
  check("site under new tenant coverage",
    (await entitlement.getByTenant(tenant2.id))?.coveredSiteIds?.includes(site.id) === true);

  // ── re-activation: cancel → assignPlan ──
  console.log("— re-activation —");
  await jpost("/entitlement/transition", op2.plaintext, { action: "cancel" });
  check("canceled", (await entitlement.getByTenant(tenant2.id))?.status === "canceled");
  const re = await app.request("/api/intel/entitlement/plan", {
    method: "PUT",
    headers: { "content-type": "application/json", authorization: `Bearer ${op2.plaintext}` },
    body: JSON.stringify({ plan: "pilot" }),
  });
  check("re-activation via assignPlan", re.status === 200 &&
    (await entitlement.getByTenant(tenant2.id))?.status === "active");

  console.log(`\n=== ${passed} passed · ${failed} failed ===`);
  process.exit(failed ? 1 : 0);
}

main().catch((e) => { console.error("dogfood failed:", e); process.exit(1); });
