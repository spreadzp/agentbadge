#!/usr/bin/env bun
/**
 * SLICE-236-7 (D-235-9): regenerate the dogfood conformance fixtures —
 * captures REAL emitted events of the live 3-hop dogfood chain
 * (org → agent → device → restaurant) through the production emitters,
 * dry-run addresses (deterministic, no keys, no secrets).
 *
 * Sources captured:
 *   supply_chain stream — makeChain(lifecycle:"verified") drives
 *     createShipment → accept → handoff(roles+evidence) → settle →
 *     verify through shipment.ts exactly as the dogfood script does.
 *   venue twin — emitEconomicBatch(venueJobToEconomic(job)) for each
 *     hop's jobId, the same mapper the indexer backfill produces for
 *     the dogfood's ERC-8183 jobs (funded→pay, submitted→deliver,
 *     completed→verify). hop1 carries proofOfDelivery, not
 *     deliverableHash → its submitted emit skips and its verify
 *     projects PARTIAL+ASSET_REF_MISSING — a documented PARTIAL in the
 *     fixture set, not a defect.
 *
 * Output: tests/process/fixtures/dogfood/events.json + manifest.json
 * (per-event canonical digest — the test recomputes and compares).
 * Run: bun scripts/dump-process-fixtures-236-7.mts
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { makeChain } from "../tests/supply-chain/helpers/chain-fixture";
import { emitEconomicBatch } from "../src/server/lib/econ-ledger/emit";
import { venueJobToEconomic } from "../src/server/lib/econ-ledger/venue";
import type { VenueJob } from "../src/server/lib/venue/store";
import { canonicalDigest, DIGEST_ALGORITHM } from "../tests/process/fixtures/dogfood/digest";

const OUT = new URL("../tests/process/fixtures/dogfood/", import.meta.url)
  .pathname;

// Dry-run party set — identical to supply-chain-dogfood.mts DRY block.
const ORG = `0x${"aa".repeat(20)}` as `0x${string}`;
const AGENT = `0x${"bb".repeat(20)}` as `0x${string}`;
const DEVICE = `0x${"cc".repeat(20)}` as `0x${string}`;
const RESTAURANT = ORG; // dry-run: restaurant defaults to org (3-wallet dogfood)
const SID = "dogfood-fish-114";
const hash = (n: number) =>
  `0x${String(n).padStart(64, "0")}` as `0x${string}`;

const chain = await makeChain({
  shipmentId: SID,
  client: ORG,
  lifecycle: "verified",
  hops: [
    {
      receiver: AGENT,
      amountUsdc: "0.01",
      what: "chilled fish lot FISH-114 — Bergen salmon, 400kg",
      where: "FishCo cold store, dock 3",
      why: "custody transfer to processing plant",
      roles: {
        custodian: { address: AGENT, type: "agent", label: "Plant intake" },
      },
      evidenceRefs: [
        { type: "gps", hash: hash(1), issuer: { address: AGENT, type: "agent" } },
        { type: "temperature", hash: hash(2), issuer: { address: DEVICE, type: "device", label: "reefer logger T-9" } },
        { type: "signature", hash: hash(3), issuer: { address: AGENT, type: "agent" } },
      ],
      deliverableHash: hash(10),
    },
    {
      receiver: DEVICE,
      amountUsdc: "0.01",
      what: "reefer van leg — plant to restaurant",
      where: "city corridor, cold chain 2-4C",
      why: "last-mile transport",
      roles: {
        custodian: { address: DEVICE, type: "device", label: "ColdVan unit" },
      },
      evidenceRefs: [
        { type: "temperature", hash: hash(4), issuer: { address: DEVICE, type: "device" } },
        { type: "signature", hash: hash(5), issuer: { address: DEVICE, type: "device", label: "dropoff signature" } },
      ],
      proofOfDelivery: "pod-coldvan-114",
    },
    {
      receiver: RESTAURANT,
      amountUsdc: "0.01",
      what: "delivery acceptance — lot FISH-114",
      where: "Restaurant receiving dock",
      why: "receiver-accept, verify, settle",
      roles: {
        custodian: { address: RESTAURANT, type: "org", label: "Restaurant" },
      },
      evidenceRefs: [
        { type: "signature", hash: hash(6), issuer: { address: RESTAURANT, type: "org", label: "receiver-accept" } },
      ],
      deliverableHash: hash(12),
    },
  ],
});

// ── venue twin: what the indexer backfill lands for these hop jobs ──
const hopDeliverables: (string | undefined)[] = [hash(10), undefined, hash(12)];
const receivers = [AGENT, DEVICE, RESTAURANT];
for (let i = 0; i < 3; i++) {
  const base: Omit<VenueJob, "status"> = {
    jobId: chain.jobId(i),
    title: `shipment ${SID} hop ${i}`,
    description: `supply-chain dogfood hop ${i}`,
    budgetUsdc: 0.01,
    client: ORG,
    provider: receivers[i],
    evaluator: chain.verifyActor(i),
    ...(hopDeliverables[i] ? { deliverableHash: hopDeliverables[i] } : {}),
  };
  for (const status of ["funded", "submitted", "completed"] as const) {
    await emitEconomicBatch(
      venueJobToEconomic({ ...base, status }),
      chain.deps.ledger,
    );
  }
}

// ── collect: supply_chain stream + every venue job stream ──
const stored = [
  ...(await chain.deps.ledger.listBySourceId("supply_chain", SID)),
  ...(
    await Promise.all(
      receivers.map((_, i) =>
        chain.deps.ledger.listBySourceId("venue", chain.jobId(i)),
      ),
    )
  ).flat(),
].sort((a, b) => Number(a.ledgerSeq - b.ledgerSeq));

const events = stored.map((s) => s.event);
const manifest = {
  spec: "process-fixture-manifest/1",
  generator: "scripts/dump-process-fixtures-236-7.mts",
  algorithm: DIGEST_ALGORITHM,
  shipmentId: SID,
  parties: { org: ORG, agent: AGENT, device: DEVICE, restaurant: RESTAURANT },
  events: events.map((e) => ({
    idempotencyKey: e.idempotencyKey,
    source: e.source,
    sourceId: e.sourceId,
    kind: e.kind,
    seq: e.seq,
    sha256: canonicalDigest(e),
  })),
};

mkdirSync(OUT, { recursive: true });
writeFileSync(`${OUT}events.json`, `${JSON.stringify(events, null, 2)}\n`);
writeFileSync(`${OUT}manifest.json`, `${JSON.stringify(manifest, null, 2)}\n`);
console.error(
  `[fixtures] ${events.length} events → ${OUT}{events,manifest}.json`,
);
