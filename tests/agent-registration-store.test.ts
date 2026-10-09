import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createJsonAgentRegistrationStore,
  createMemoryAgentRegistrationStore,
  type AgentRegistration,
  type AgentRegistrationStore,
} from "../src/server/lib/agent-registration/store";
import {
  issueApiKey,
  hashApiKey,
  isApiKeyFormat,
  lookupAgentByKey,
  revokeApiKey,
} from "../src/server/lib/agent-registration/api-keys";

function makeRecord(overrides: Partial<AgentRegistration> = {}): AgentRegistration {
  return {
    agentId: "eip155:5042:0x8004A169FB4a3325136EB29fA0ceB6D2e539a432:1",
    registryAddress: "0x8004A169FB4a3325136EB29fA0ceB6D2e539a432",
    registryTx: "0xabc123",
    name: "test-agent",
    endpoint: "https://agent.example.com",
    keyHash: "a".repeat(64),
    tier: "observer",
    status: "active",
    createdAt: 1000,
    ...overrides,
  };
}

/* ---------------- api-keys ---------------- */

describe("issueApiKey", () => {
  it("issues an agb_-prefixed key with 32B base64url body", () => {
    const { key } = issueApiKey();
    expect(key).toMatch(/^agb_[A-Za-z0-9_-]{43}$/);
  });

  it("issues unique keys", () => {
    const a = issueApiKey();
    const b = issueApiKey();
    expect(a.key).not.toBe(b.key);
    expect(a.keyHash).not.toBe(b.keyHash);
  });

  it("keyHash matches hashApiKey(key)", () => {
    const { key, keyHash } = issueApiKey();
    expect(hashApiKey(key)).toBe(keyHash);
    expect(keyHash).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("hashApiKey / isApiKeyFormat", () => {
  it("hashApiKey is deterministic sha256 hex", () => {
    const k = "agb_testkey";
    expect(hashApiKey(k)).toBe(hashApiKey(k));
    expect(hashApiKey(k)).toMatch(/^[0-9a-f]{64}$/);
  });

  it("isApiKeyFormat accepts only agb_ + 43 base64url chars", () => {
    const { key } = issueApiKey();
    expect(isApiKeyFormat(key)).toBe(true);
    expect(isApiKeyFormat("")).toBe(false);
    expect(isApiKeyFormat("agb_")).toBe(false);
    expect(isApiKeyFormat("xxx_" + "a".repeat(43))).toBe(false);
    expect(isApiKeyFormat("agb_" + "a".repeat(42))).toBe(false);
    expect(isApiKeyFormat("agb_" + "a".repeat(44))).toBe(false);
    expect(isApiKeyFormat("agb_" + "!".repeat(43))).toBe(false);
    expect(isApiKeyFormat("agb_" + "a".repeat(42) + "+")).toBe(false);
  });
});

/* ---------------- store conformance ---------------- */

function conformance(
  backendName: string,
  makeStore: () => AgentRegistrationStore,
  cleanup?: () => void,
) {
  describe(`AgentRegistrationStore conformance [${backendName}]`, () => {
    let store: AgentRegistrationStore;
    beforeEach(() => {
      store = makeStore();
    });
    afterEach(() => cleanup?.());

    it("put → get round-trips the record", async () => {
      const rec = makeRecord();
      await store.put(rec);
      expect(await store.get(rec.agentId)).toEqual(rec);
    });

    it("get returns undefined for unknown agentId", async () => {
      expect(await store.get("eip155:5042:0x0:999")).toBeUndefined();
    });

    it("byKeyHash finds the record", async () => {
      const rec = makeRecord({ keyHash: "b".repeat(64) });
      await store.put(rec);
      expect(await store.byKeyHash("b".repeat(64))).toEqual(rec);
      expect(await store.byKeyHash("c".repeat(64))).toBeUndefined();
    });

    it("list returns all records newest first", async () => {
      await store.put(makeRecord({ agentId: "a1", createdAt: 100 }));
      await store.put(makeRecord({ agentId: "a2", createdAt: 300 }));
      await store.put(makeRecord({ agentId: "a3", createdAt: 200 }));
      const list = await store.list();
      expect(list.map((r) => r.agentId)).toEqual(["a2", "a3", "a1"]);
    });

    it("revoke flips status and stamps revokedAt/By", async () => {
      const rec = makeRecord();
      await store.put(rec);
      expect(await store.revoke(rec.agentId, "admin")).toBe(true);
      const got = await store.get(rec.agentId);
      expect(got?.status).toBe("revoked");
      expect(got?.revokedBy).toBe("admin");
      expect(got?.revokedAt).toBeTypeOf("number");
    });

    it("revoke is idempotent on an already-revoked record", async () => {
      const rec = makeRecord();
      await store.put(rec);
      expect(await store.revoke(rec.agentId, "admin")).toBe(true);
      expect(await store.revoke(rec.agentId, "admin")).toBe(true);
    });

    it("revoke returns false for unknown agentId", async () => {
      expect(await store.revoke("nope", "admin")).toBe(false);
    });
  });
}

let tmpDir: string | undefined;
conformance("memory", () => createMemoryAgentRegistrationStore());
conformance(
  "json",
  () => {
    tmpDir = mkdtempSync(join(tmpdir(), "agb-reg-"));
    return createJsonAgentRegistrationStore(join(tmpDir, "regs.json"));
  },
  () => {
    if (tmpDir) rmSync(tmpDir, { recursive: true, force: true });
    tmpDir = undefined;
  },
);

describe("json store persistence", () => {
  it("survives store re-instantiation on the same file", async () => {
    const dir = mkdtempSync(join(tmpdir(), "agb-reg-"));
    try {
      const path = join(dir, "regs.json");
      const rec = makeRecord({ agentId: "persist-1" });
      await createJsonAgentRegistrationStore(path).put(rec);
      const reloaded = createJsonAgentRegistrationStore(path);
      expect(await reloaded.get("persist-1")).toEqual(rec);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("never serializes the plaintext api key", async () => {
    const dir = mkdtempSync(join(tmpdir(), "agb-reg-"));
    try {
      const path = join(dir, "regs.json");
      const { key, keyHash } = issueApiKey();
      await createJsonAgentRegistrationStore(path).put(
        makeRecord({ agentId: "k1", keyHash }),
      );
      const raw = readFileSync(path, "utf8");
      expect(raw).not.toContain(key);
      expect(raw).toContain(keyHash);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

/* ---------------- lookup/revoke helpers ---------------- */

describe("lookupAgentByKey / revokeApiKey", () => {
  let store: AgentRegistrationStore;
  beforeEach(() => {
    store = createMemoryAgentRegistrationStore();
  });

  it("lookup by key returns the active registration", async () => {
    const { key, keyHash } = issueApiKey();
    const rec = makeRecord({ agentId: "agent-1", keyHash });
    await store.put(rec);
    expect(await lookupAgentByKey(store, key)).toEqual(rec);
  });

  it("lookup on bad format misses without hitting the store", async () => {
    const spy = new Proxy(store, {
      get(target, prop) {
        if (prop === "byKeyHash") {
          throw new Error("store must not be hit for malformed keys");
        }
        return Reflect.get(target, prop);
      },
    });
    expect(await lookupAgentByKey(spy, "totally-not-a-key")).toBeUndefined();
  });

  it("lookup returns undefined for revoked registration", async () => {
    const { key, keyHash } = issueApiKey();
    const rec = makeRecord({ agentId: "agent-2", keyHash });
    await store.put(rec);
    await store.revoke("agent-2", "admin");
    expect(await lookupAgentByKey(store, key)).toBeUndefined();
  });

  it("revokeApiKey delegates to store.revoke", async () => {
    const rec = makeRecord({ agentId: "agent-3" });
    await store.put(rec);
    expect(await revokeApiKey(store, "agent-3", "self")).toBe(true);
    expect((await store.get("agent-3"))?.status).toBe("revoked");
    expect((await store.get("agent-3"))?.revokedBy).toBe("self");
  });
});
