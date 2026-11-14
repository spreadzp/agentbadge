import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, describe, expect, it } from "vitest";
import { Hono } from "hono";

import {
  buildFingerprint,
  sanitizeHeaders,
} from "../src/server/lib/request-inbox/fingerprint";
import { createSubmitLanes } from "../src/server/lib/request-inbox/intake";
import { runInboxJanitor } from "../src/server/lib/request-inbox/janitor";
import { createMemoryRequestInboxStores } from "../src/server/lib/request-inbox/db-stores";
import { createAgentRequestRoutes } from "../src/server/routes/agent-requests-api";
import { payloadQuestionText } from "../src/server/lib/request-inbox/qa";
import type { SubmitInput } from "../src/server/lib/request-inbox/store";

/**
 * EPIC-252 (SLICE-252-8): regression suite for the Arc Studio
 * adversarial audit — every Critical/High finding gets a test that
 * fails on the pre-fix code and passes after.
 */

const tmpDirs: string[] = [];
afterAll(() => {
  for (const d of tmpDirs) rmSync(d, { recursive: true, force: true });
});

const ENV = {
  fingerprintSalt: "audit-test-salt",
  requestTtlMs: 60_000,
  payloadRetentionMs: 30 * 24 * 3600_000,
};

// ── C-1: IP-carrier headers never persist in the snapshot ──────
describe("C-1: snapshot strips IP-carrier headers", () => {
  it("fly-client-ip / x-forwarded-for / x-real-ip / cf-connecting-ip are dropped", () => {
    const { fingerprint } = buildFingerprint({
      ip: "1.2.3.4",
      ua: "agent/1.0",
      salt: "audit-salt-1",
      headers: {
        "fly-client-ip": "1.2.3.4",
        "x-forwarded-for": "1.2.3.4",
        "x-real-ip": "1.2.3.4",
        "cf-connecting-ip": "1.2.3.4",
        "true-client-ip": "1.2.3.4",
        forwarded: "for=1.2.3.4",
        "user-agent-ok": "fine",
      },
    });
    // Amended privacy posture: resolved IP IS stored at fingerprint.ip
    // (ops visibility) — the invariant is only that IP-carrier *headers*
    // never persist.
    expect(fingerprint.ip).toBe("1.2.3.4");
    const headersJson = JSON.stringify(fingerprint.headers);
    expect(headersJson).not.toContain("1.2.3.4");
    expect(fingerprint.headers["fly-client-ip"]).toBeUndefined();
    expect(fingerprint.headers["x-forwarded-for"]).toBeUndefined();
    expect(fingerprint.headers["x-real-ip"]).toBeUndefined();
    // Allowlist snapshot (C-1 round-3): unvetted benign headers
    // no longer persist either.
    expect(fingerprint.headers["user-agent-ok"]).toBeUndefined();
  });
});

// ── C-2: arbitrary headers can't rotate the digest/lanes ────────
describe("C-2: digest allowlist ignores non-identity headers", () => {
  it("x-pad / fly-request-id / content-length do not shift fpHash or softFpHash", () => {
    const base = buildFingerprint({
      ip: "1.2.3.4",
      ua: "agent/1.0",
      salt: "audit-salt-1",
      headers: { "accept-language": "en" },
    });
    const padded = buildFingerprint({
      ip: "1.2.3.4",
      ua: "agent/1.0",
      salt: "audit-salt-1",
      headers: {
        "accept-language": "en",
        "x-pad": "n=12345",
        "fly-request-id": "req_abc",
        "content-length": "42",
        "x-request-id": "r9",
      },
    });
    expect(padded.softFpHash).toBe(base.softFpHash);
    expect(padded.fpHash).toBe(base.fpHash);
  });

  it("identity headers still differentiate the soft lane", () => {
    const a = buildFingerprint({
      ip: "1.2.3.4",
      ua: "agent/1.0",
      salt: "audit-salt-1",
      headers: { "accept-language": "en" },
    });
    const b = buildFingerprint({
      ip: "1.2.3.4",
      ua: "agent/1.0",
      salt: "audit-salt-1",
      headers: { "accept-language": "de" },
    });
    expect(b.softFpHash).not.toBe(a.softFpHash);
  });

  it("credential headers still strip from the snapshot", () => {
    const out = sanitizeHeaders({
      "x-admin-key": "k",
      "x-agent-key": "k",
      "x-session-id": "s",
      "x-hub-signature": "sha1=x",
      "x-jwt-assertion": "jwt",
      accept: "application/json",
    });
    expect(Object.keys(out)).toEqual(["accept"]);
  });
});

// ── H-1: soft lane only counts after hard passes ───────────────
describe("H-1: hard-limited requests don't burn soft quota", () => {
  it("soft lane counter stays at 0 while hard rejects", () => {
    const lanes = createSubmitLanes({
      windowMs: 60_000,
      max: 1,
      softMax: 100,
    });
    // exhaust the hard lane for an anonymous caller
    expect(lanes.check(null, "fpA", "softA")).toBeNull();
    // same fpHash → hard rejects from here on
    const r1 = lanes.check(null, "fpA", "softA");
    expect(r1).not.toBeNull();
    const r2 = lanes.check(null, "fpA", "softA");
    expect(r2).not.toBeNull();
    // a fresh fpHash on the same soft signature must still pass —
    // the two hard-rejected calls above consumed no soft quota.
    expect(lanes.check(null, "fpB", "softA")).toBeNull();
  });
});

// ── H-3: streaming byte-cap on the intake body ──────────────────
describe("H-3: oversized chunked body → 413 before parse", () => {
  it("a body over BODY_MAX without content-length is rejected", async () => {
    const stores = createMemoryRequestInboxStores();
    const app = new Hono<{ Variables: Record<string, unknown> }>();
    app.route("/", createAgentRequestRoutes({ stores, env: ENV }));
    const big = JSON.stringify({ payload: { prompt: "x".repeat(600_000) } });
    const res = await app.request("/api/requests", {
      method: "POST",
      // no content-length → simulates a chunked stream
      body: big,
      headers: { "content-type": "application/json" },
    });
    expect(res.status).toBe(413);
  });
});

// ── H-5: survey answer claim is atomic ──────────────────────────
describe("H-5: putAnswer claim is atomic → 409 on dup", () => {
  it("memory store throws on a same-identity second answer", async () => {
    const stores = createMemoryRequestInboxStores();
    const mk = (id: string) => ({
      id,
      surveyId: "sv1",
      agentId: null,
      fpHash: "fp_same",
      answers: { q: "a" },
      rated: false,
      createdAtMs: 1,
    });
    await stores.surveys.putAnswer(mk("ans1"));
    await expect(stores.surveys.putAnswer(mk("ans2"))).rejects.toThrow(
      /already exists/,
    );
  });
});

// ── H-6: no QA materialization without an explicit question ────
describe("H-6: opaque payloads never materialize into the QA corpus", () => {
  it("object without prompt/question/text → null, not JSON.stringify", () => {
    expect(payloadQuestionText({ account: "0x", token: "t" })).toBeNull();
    expect(payloadQuestionText({ nested: { secret: "s" } })).toBeNull();
    expect(payloadQuestionText({ prompt: "how?" })).toBe("how?");
    expect(payloadQuestionText("plain string")).toBe("plain string");
  });
});

// ── H-7: janitor skips purge when the archive fails ─────────────
describe("H-7: purge never runs without a durable archive", () => {
  const mkSubmit = (id: string): SubmitInput => ({
    id,
    state: "completed",
    fingerprint: { ip: null, ua: "a/1", referer: null, src: null, headers: {} },
    fpHash: `fp_${id}`,
    payload: { prompt: "p" },
    expiresAtMs: Date.now() + 60_000,
    createdAtMs: Date.now() - 40 * 24 * 3600_000, // old → purgeable
  });

  it("archive failure → payloadsPurged 0 and an error recorded", async () => {
    const stores = createMemoryRequestInboxStores();
    await stores.requests.submit(mkSubmit("r1"));
    const res = await runInboxJanitor(stores, {
      payloadRetentionMs: 30 * 24 * 3600_000,
      archiveDir: "/dev/null/impossible", // write must fail
    });
    expect(res.purgeableListed).toBe(1);
    expect(res.payloadsPurged).toBe(0);
    expect(res.errors.some((e) => e.includes("archive"))).toBe(true);
    const { record } = await stores.requests.get("r1");
    expect(record?.payload).not.toBeNull(); // not purged
  });

  it("second same-day run appends instead of overwriting; file is 0600", async () => {
    const dir = mkdtempSync(join(tmpdir(), "jan-2528-"));
    tmpDirs.push(dir);
    const stores = createMemoryRequestInboxStores();
    await stores.requests.submit(mkSubmit("r1"));
    const r1 = await runInboxJanitor(stores, {
      payloadRetentionMs: 30 * 24 * 3600_000,
      archiveDir: dir,
    });
    expect(r1.archived).toBe(1);

    const stores2 = createMemoryRequestInboxStores();
    await stores2.requests.submit(mkSubmit("r2"));
    const r2 = await runInboxJanitor(stores2, {
      payloadRetentionMs: 30 * 24 * 3600_000,
      archiveDir: dir,
    });
    expect(r2.archived).toBe(1);

    const files = readdirSync(dir);
    expect(files).toHaveLength(1); // same-day file, appended
    const body = readFileSync(join(dir, files[0]), "utf8");
    expect(body).toContain('"r1"');
    expect(body).toContain('"r2"');
    if (process.platform !== "win32") {
      expect(statSync(join(dir, files[0])).mode & 0o777).toBe(0o600);
    }
  });
});

// ── M-11: same idempotency-key + different payload → 422 ────────
describe("M-11: idempotency-key replay validates the payload", () => {
  it("key reused with a different payload → 422", async () => {
    const stores = createMemoryRequestInboxStores();
    const app = new Hono<{ Variables: Record<string, unknown> }>();
    app.route("/", createAgentRequestRoutes({ stores, env: ENV }));
    const h = {
      "content-type": "application/json",
      "idempotency-key": "key-12345",
      "fly-client-ip": "1.2.3.4",
    };
    await app.request("/api/requests", {
      method: "POST",
      body: JSON.stringify({ payload: { prompt: "first" } }),
      headers: h,
    });
    const res = await app.request("/api/requests", {
      method: "POST",
      body: JSON.stringify({ payload: { prompt: "different" } }),
      headers: h,
    });
    expect(res.status).toBe(422);
  });

  it("malformed/short idempotency-key → 400", async () => {
    const stores = createMemoryRequestInboxStores();
    const app = new Hono<{ Variables: Record<string, unknown> }>();
    app.route("/", createAgentRequestRoutes({ stores, env: ENV }));
    const res = await app.request("/api/requests", {
      method: "POST",
      body: JSON.stringify({ payload: { prompt: "p" } }),
      headers: {
        "content-type": "application/json",
        "idempotency-key": "ab",
      },
    });
    expect(res.status).toBe(400);
  });
});

// ── M-12: short fingerprintSalt rejected at route build ─────────
describe("M-12: weak salt fails fast", () => {
  it("salt < 8 chars → factory throws", () => {
    const stores = createMemoryRequestInboxStores();
    expect(() =>
      createAgentRequestRoutes({
        stores,
        env: {
          fingerprintSalt: "short",
          requestTtlMs: 60_000,
          payloadRetentionMs: 30 * 24 * 3600_000,
        },
      }),
    ).toThrow(/fingerprintSalt/);
  });
});
