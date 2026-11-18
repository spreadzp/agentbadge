import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, describe, expect, it } from "vitest";

import { runInboxJanitor } from "../../src/server/lib/request-inbox/janitor";
import { createMemoryRequestInboxStores } from "../../src/server/lib/request-inbox/db-stores";
import type {
  RequestInboxStores,
  SubmitInput,
} from "../../src/server/lib/request-inbox/store";

/**
 * EPIC-252 (SLICE-252-1, decision 2026-11-14): janitor core.
 * Covers the two legs — expired hard-delete and terminal payload
 * purge — plus the optional JSONL archive and QA-corpus immunity.
 */

const tmpDirs: string[] = [];
afterAll(() => {
  for (const d of tmpDirs) rmSync(d, { recursive: true, force: true });
});

const mkSubmit = (over: Partial<SubmitInput>): SubmitInput => ({
  id: `rq_${Math.random().toString(16).slice(2)}`,
  state: "submitted",
  fingerprint: { ip: null, ua: "a/1", referer: null, src: null, headers: {} },
  fpHash: `fp_${Math.random().toString(16).slice(2)}`,
  payload: { prompt: "p" },
  expiresAtMs: Date.now() + 60_000,
  createdAtMs: Date.now(),
  ...over,
});

const seed = async (stores: RequestInboxStores, nowMs: number) => {
  // expired row (any state)
  await stores.requests.submit(
    mkSubmit({ id: "exp1", expiresAtMs: nowMs - 1 }),
  );
  // old terminal with payload → purge candidate
  await stores.requests.submit(
    mkSubmit({
      id: "old1",
      state: "completed",
      createdAtMs: nowMs - 40 * 24 * 3600 * 1000,
      expiresAtMs: nowMs + 60_000,
      payload: { prompt: "old prompt" },
    }),
  );
  // old terminal WITHOUT payload → not purgeable
  await stores.requests.submit(
    mkSubmit({
      id: "old-nopayload",
      state: "failed",
      createdAtMs: nowMs - 40 * 24 * 3600 * 1000,
      expiresAtMs: nowMs + 60_000,
      payload: undefined,
    }),
  );
  // fresh terminal → keep
  await stores.requests.submit(
    mkSubmit({
      id: "fresh1",
      state: "completed",
      createdAtMs: nowMs - 1000,
      expiresAtMs: nowMs + 60_000,
    }),
  );
  // old but non-terminal → keep payload (still in flight)
  await stores.requests.submit(
    mkSubmit({
      id: "old-open",
      state: "working",
      createdAtMs: nowMs - 40 * 24 * 3600 * 1000,
      expiresAtMs: nowMs + 60_000,
    }),
  );
};

describe("runInboxJanitor", () => {
  it("deletes expired rows and purges old terminal payloads, keeping metadata", async () => {
    const nowMs = Date.now();
    const stores = createMemoryRequestInboxStores();
    await seed(stores, nowMs);

    const res = await runInboxJanitor(stores, {
      payloadRetentionMs: 30 * 24 * 3600 * 1000,
      nowMs,
    });

    expect(res.expiredListed).toBe(1);
    expect(res.expiredDeleted).toBe(1);
    expect((await stores.requests.get("exp1")).record).toBeNull();

    expect(res.purgeableListed).toBe(1);
    expect(res.payloadsPurged).toBe(1);

    const purged = (await stores.requests.get("old1")).record!;
    expect(purged.payload).toBeNull();
    expect(purged.state).toBe("completed"); // metadata survives
    expect(purged.fpHash).not.toBe("");

    expect(
      (await stores.requests.get("fresh1")).record!.payload,
    ).not.toBeNull();
    expect(
      (await stores.requests.get("old-open")).record!.payload,
    ).not.toBeNull();
    expect(res.errors).toEqual([]);
  });

  it("--archive writes purged payloads to a dated JSONL file before purge", async () => {
    const nowMs = Date.now();
    const dir = mkdtempSync(join(tmpdir(), "janitor-archive-"));
    tmpDirs.push(dir);

    const stores = createMemoryRequestInboxStores();
    await seed(stores, nowMs);

    const res = await runInboxJanitor(stores, {
      payloadRetentionMs: 30 * 24 * 3600 * 1000,
      archiveDir: dir,
      nowMs,
    });

    expect(res.archived).toBe(1);
    expect(res.archiveFile).toBeTruthy();
    const files = readdirSync(dir);
    expect(files).toHaveLength(1);
    expect(files[0]).toMatch(/^agent-requests-\d{8}\.jsonl$/);

    const lines = readFileSync(join(dir, files[0]), "utf8")
      .trim()
      .split("\n")
      .map((l) => JSON.parse(l));
    expect(lines).toHaveLength(1);
    expect(lines[0].id).toBe("old1");
    expect(lines[0].payload).toEqual({ prompt: "old prompt" });
    expect(lines[0].archivedAtMs).toBe(nowMs);
  });

  it("QA pairs are never touched by the janitor (D-252-Q7)", async () => {
    const nowMs = Date.now();
    const stores = createMemoryRequestInboxStores();
    await stores.requests.upsertQaPair({
      id: "qa1",
      questionHash: "qh",
      question: "q",
      response: { t: "a" },
      sourceRequestId: "r",
      createdAtMs: nowMs - 365 * 24 * 3600 * 1000,
    });
    const res = await runInboxJanitor(stores, {
      payloadRetentionMs: 0, // aggressive — everything terminal+payload
      nowMs,
    });
    expect(res.errors).toEqual([]);
    expect((await stores.requests.getQaByHash("qh"))!.id).toBe("qa1");
  });
});
