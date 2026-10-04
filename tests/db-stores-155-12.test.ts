/**
 * SLICE-155-12 tests: Postgres-backed store adapters (mirror + write-behind).
 *
 * Unit (always run):
 *  - every createDb*Store(null) → null → wiring falls back to json/memory
 *
 * Live-gated (skipped without DATABASE_ENABLED + DATABASE_URL — .env drives):
 *  - parity: same ops on memory backend and db backend → identical reads
 *  - restart: fresh adapter over same repo hydrates rows written by another
 */
import { describe, it, expect, afterAll } from "vitest";
import { randomBytes } from "node:crypto";
import type { Hex } from "viem";

import { getDatabase } from "../src/server/lib/database";
import { createDbSpendAlertStore } from "../src/server/lib/agent-wallet/alert-db";
import { createDbDelegateStore } from "../src/server/lib/agent-wallet/delegate-db";
import {
  createMemorySpendAlertStore,
  type SpendAlertEvent,
} from "../src/server/lib/agent-wallet/audit";
import {
  createMemoryDelegateStore,
  type DelegateRecord,
} from "../src/server/lib/agent-wallet/delegate";
import { createDbVerdictStore } from "../src/server/lib/eaas/store-db";
import { createJsonVerdictStore } from "../src/server/lib/eaas/store";
import type { StoredVerdict } from "../src/server/lib/eaas/store";
import type { VerdictArtifact } from "../src/server/lib/eaas/verdict";
import { createDbAnchorStore } from "../src/server/lib/eaas/anchor-db";
import {
  createMemoryAnchorStore,
  type AnchorRecord,
} from "../src/server/lib/eaas/anchor";
import { createDbRequestStore } from "../src/server/lib/eaas/requests-db";
import {
  createMemoryRequestStore,
  type EaasAsyncRequest,
} from "../src/server/lib/eaas/requests";
import { createDbSubscriptionStore } from "../src/server/lib/eaas/subscription-db";
import {
  createMemorySubscriptionStore,
  type EaasSubscription,
} from "../src/server/lib/eaas/subscription";
import { createDbContractStore } from "../src/server/lib/eaas/contracts-db";
import {
  createMemoryContractStore,
  type EaasContract,
} from "../src/server/lib/eaas/contracts";
import { createDbEvalStore } from "../src/server/lib/eaas/eval-store-db";
import {
  createMemoryEvalStore,
  type EvalJobRecord,
} from "../src/server/lib/eaas/eval-store";
import { initMarketplaceDbBackend } from "../src/server/lib/marketplace/db-backend";
import {
  upsertService,
  getService,
  putMeta,
  getMeta,
  resetStoreForTesting,
} from "../src/server/lib/marketplace/catalog";
import type { CatalogService } from "../src/server/lib/marketplace/types";

const runId = randomBytes(4).toString("hex");
const hex = (byte: string) =>
  `0x${randomBytes(30).toString("hex")}${byte}` as Hex;
const wallet = () =>
  `0x${randomBytes(20).toString("hex")}` as `0x${string}`;

/* ------------------------------- unit -------------------------------- */

describe("createDb*Store(null) → null (DATABASE_ENABLED fallback)", () => {
  it("all adapters return null without a repo", () => {
    expect(createDbSpendAlertStore(null)).toBeNull();
    expect(createDbDelegateStore(null)).toBeNull();
    expect(createDbVerdictStore(null)).toBeNull();
    expect(createDbAnchorStore(null)).toBeNull();
    expect(createDbRequestStore(null)).toBeNull();
    expect(createDbSubscriptionStore(null)).toBeNull();
    expect(createDbContractStore(null)).toBeNull();
    expect(createDbEvalStore(null)).toBeNull();
    expect(initMarketplaceDbBackend(null)).toBeNull();
  });
});

/* --------------------------- live Postgres ---------------------------- */

const handle = getDatabase();
const live = !!handle.db;

describe.skipIf(!live)("db stores (live Postgres)", () => {
  afterAll(() => {
    resetStoreForTesting();
  });

  it("spend alerts: parity + restart", async () => {
    const mem = createMemorySpendAlertStore();
    const db1 = createDbSpendAlertStore(handle.spendAlerts)!;
    await db1.ready();
    const ev: SpendAlertEvent = {
      id: `al_${runId}_1`,
      type: "spend.release_late",
      wallet: wallet(),
      venueId: `venue_${runId}`,
      at: Date.now(),
      data: { runId },
    };
    mem.add(ev);
    db1.add(ev);
    await db1.flush();
    // parity on filtered list
    expect(db1.list({ venueId: ev.venueId })).toEqual(
      mem.list({ venueId: ev.venueId }),
    );
    // restart: fresh adapter hydrates the row
    const db2 = createDbSpendAlertStore(handle.spendAlerts)!;
    await db2.ready();
    expect(
      db2.list({ wallet: ev.wallet }).some((e) => e.id === ev.id),
    ).toBe(true);
  });

  it("delegate store: parity + restart + revoke", async () => {
    const mem = createMemoryDelegateStore();
    const db1 = createDbDelegateStore(handle.delegates)!;
    await db1.ready();
    const rec: DelegateRecord = {
      ownerWallet: wallet(),
      delegate: wallet(),
      chain: `TestChain_${runId}`,
      spendCapUsd: 5,
      authorizedAt: Date.now(),
    };
    mem.put(rec);
    db1.put(rec);
    await db1.flush();
    expect(db1.get(rec.ownerWallet, rec.chain)).toEqual(
      mem.get(rec.ownerWallet, rec.chain),
    );
    const db2 = createDbDelegateStore(handle.delegates)!;
    await db2.ready();
    expect(db2.get(rec.ownerWallet, rec.chain)).toBeTruthy();
    db2.revoke(rec.ownerWallet, rec.chain);
    await db2.flush();
    const db3 = createDbDelegateStore(handle.delegates)!;
    await db3.ready();
    expect(db3.get(rec.ownerWallet, rec.chain)?.revokedAt).toBeDefined();
  });

  it("verdict store: idempotent put + restart", async () => {
    const artifact = {
      verdictId: hex("aa"),
      kind: "approve",
      policy: "hash-match",
      deliverableHash: hex("bb"),
      reason: "ok",
      reasonHash: hex("cc"),
      evidenceHash: hex("dd"),
      issuedAt: new Date().toISOString(),
    } as VerdictArtifact;
    const v: StoredVerdict = { artifact, consumerWallet: wallet() };
    const db1 = createDbVerdictStore(handle.eaasVerdicts)!;
    await db1.ready();
    db1.put(v);
    db1.put(v); // idempotent
    await db1.flush();
    expect(db1.get(artifact.verdictId)).toBeTruthy();
    expect(db1.getByDeliverable(artifact.deliverableHash!)).toHaveLength(1);
    const db2 = createDbVerdictStore(handle.eaasVerdicts)!;
    await db2.ready();
    expect(db2.get(artifact.verdictId)?.artifact.policy).toBe("hash-match");
    // parity: json store behaves identically
    const json = createJsonVerdictStore(
      `/tmp/verdicts-${runId}.json`,
    );
    await json.ready();
    json.put(v);
    expect(json.get(artifact.verdictId)).toEqual(db2.get(artifact.verdictId));
  });

  it("anchor store: put/patch parity + restart", async () => {
    const mem = createMemoryAnchorStore();
    const db1 = createDbAnchorStore(handle.eaasAnchors)!;
    await db1.ready();
    const rec: AnchorRecord = {
      verdictId: hex("e1"),
      memoId: hex("e2"),
      artifactHash: hex("e3"),
      status: "pending",
      attempts: 0,
    };
    mem.put(rec);
    db1.put(rec);
    mem.patch(rec.verdictId, { status: "anchored", attempts: 2 });
    db1.patch(rec.verdictId, { status: "anchored", attempts: 2 });
    await db1.flush();
    expect(db1.get(rec.verdictId)).toEqual(mem.get(rec.verdictId));
    const db2 = createDbAnchorStore(handle.eaasAnchors)!;
    await db2.ready();
    expect(db2.get(rec.verdictId)?.status).toBe("anchored");
  });

  it("request store: put/update/counts parity + restart", async () => {
    const mem = createMemoryRequestStore();
    const db1 = createDbRequestStore(handle.eaasRequests)!;
    await db1.ready();
    const req: EaasAsyncRequest = {
      id: `req_${runId}`,
      kind: "verdict",
      status: "pending",
      wallet: wallet(),
      attempts: 0,
      createdAt: new Date().toISOString(),
    };
    mem.put(req);
    db1.put(req);
    const done = { status: "done" as const, completedAt: new Date().toISOString() };
    mem.update(req.id, done);
    db1.update(req.id, done);
    await db1.flush();
    expect(db1.get(req.id)).toEqual(mem.get(req.id));
    const db2 = createDbRequestStore(handle.eaasRequests)!;
    await db2.ready();
    expect(db2.get(req.id)?.status).toBe("done");
    expect(db2.counts().done).toBeGreaterThan(0);
  });

  it("subscription store: put/get parity + restart", async () => {
    const mem = createMemorySubscriptionStore();
    const db1 = createDbSubscriptionStore(handle.eaasSubscriptions)!;
    await db1.ready();
    const sub: EaasSubscription = {
      wallet: wallet().toLowerCase(),
      tier: "basic",
      expiresAt: Math.floor(Date.now() / 1000) + 86400,
      quotaUsed: 3,
      resetAt: Math.floor(Date.now() / 1000) + 3600,
      updatedAt: new Date().toISOString(),
    };
    mem.put(sub);
    db1.put(sub);
    await db1.flush();
    expect(db1.get(sub.wallet)).toEqual(mem.get(sub.wallet));
    const db2 = createDbSubscriptionStore(handle.eaasSubscriptions)!;
    await db2.ready();
    expect(db2.get(sub.wallet)?.quotaUsed).toBe(3);
  });

  it("contract store: put/remove parity + restart", async () => {
    const mem = createMemoryContractStore();
    const db1 = createDbContractStore(handle.eaasContracts)!;
    await db1.ready();
    const c: EaasContract = {
      address: wallet(),
      chainId: 5042002,
      ownerWallet: wallet(),
      active: true,
      probedAt: Date.now(),
    };
    mem.put(c);
    db1.put(c);
    await db1.flush();
    expect(db1.get(c.address, c.chainId)).toEqual(
      mem.get(c.address, c.chainId),
    );
    const db2 = createDbContractStore(handle.eaasContracts)!;
    await db2.ready();
    expect(db2.get(c.address, c.chainId)).toBeTruthy();
    db2.remove(c.address, c.chainId);
    await db2.flush();
    const db3 = createDbContractStore(handle.eaasContracts)!;
    await db3.ready();
    expect(db3.get(c.address, c.chainId)).toBeUndefined();
  });

  it("eval job store: put/get parity + restart", async () => {
    const mem = createMemoryEvalStore();
    const db1 = createDbEvalStore(handle.eaasEvalJobs)!;
    await db1.ready();
    const rec = {
      key: `5042002:${wallet().toLowerCase()}:job_${runId}`,
      contract: wallet(),
      chainId: 5042002,
      jobId: `job_${runId}`,
      verdict: { verdict: "approve" },
      verdictId: hex("f1"),
    } as unknown as EvalJobRecord;
    mem.put(rec);
    db1.put(rec);
    await db1.flush();
    expect(db1.get(rec.key)).toEqual(mem.get(rec.key));
    const db2 = createDbEvalStore(handle.eaasEvalJobs)!;
    await db2.ready();
    expect(db2.get(rec.key)?.verdictId).toBe(rec.verdictId);
  });

  it("marketplace backend: hydrate mirror + persist + restart", async () => {
    const b1 = initMarketplaceDbBackend(handle.marketplace)!;
    await b1.ready();
    const svc = {
      serviceId: `svc_${runId}`,
      name: "durability probe",
      owner: wallet(),
      passportId: "p1",
      subId: "probe",
      description: "155-12 test",
      priceUsd: "1",
      priceBaseUnits: "1000000",
      durationDays: 30,
      metaURI: "ipfs://probe",
    } as CatalogService;
    upsertService(svc);
    const hash = putMeta({ probe: runId });
    await b1.flush();

    resetStoreForTesting(); // drop mirror — simulated restart
    const b2 = initMarketplaceDbBackend(handle.marketplace)!;
    await b2.ready();
    expect(getService(svc.serviceId)?.name).toBe("durability probe");
    expect((getMeta(hash) as { probe: string }).probe).toBe(runId);
  });
}, { timeout: 30_000 });
