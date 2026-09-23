import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { resetConfigCache } from "../../../src/config/env";
import { resetDatabaseForTests } from "../../../src/server/lib/database";
import { ChatRegistry } from "../../../src/server/services/chat-registry";
import { setupMockEnv } from "../../e2e/helpers";

/**
 * SLICE-145-3: ChatRegistry — async write-through + sync reads over a
 * hydrated Map. DATABASE_ENABLED unset → in-memory fallback (zero behavior
 * change vs the old Map-only registry).
 */
describe("ChatRegistry (DATABASE_ENABLED unset → in-memory)", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env = { ...originalEnv };
    setupMockEnv();
    delete process.env.DATABASE_ENABLED;
    delete process.env.DATABASE_URL;
    resetConfigCache();
    resetDatabaseForTests();
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    resetConfigCache();
    resetDatabaseForTests();
  });

  it("register → sync reads see the binding immediately", async () => {
    const reg = new ChatRegistry();
    const p = reg.register(123, "@alice");
    // Map update is synchronous — visible before the promise resolves
    expect(reg.has(123)).toBe(true);
    expect(reg.findByUsername("@alice")).toBe(123);
    expect(reg.findByUsername("alice")).toBe(123); // @ optional
    await p;
  });

  it("list returns all registered chats", async () => {
    const reg = new ChatRegistry();
    await reg.register(1, "@a");
    await reg.register(2, "@b");
    const list = reg.list();
    expect(list).toHaveLength(2);
    expect(list.map((c) => c.chatId).sort()).toEqual([1, 2]);
  });

  it("duplicate username/chatId → upsert, not error", async () => {
    const reg = new ChatRegistry();
    await reg.register(123, "@alice");
    await reg.register(123, "@alice2"); // same chatId, new username
    expect(reg.findByUsername("@alice2")).toBe(123);
    expect(reg.list()).toHaveLength(1);
  });

  it("hydrate restores bindings into a fresh registry (simulated restart)", async () => {
    const reg1 = new ChatRegistry();
    await reg1.register(777, "@carol");
    await reg1.register(888, "@dave");

    // Simulate restart: new registry instance, same store
    const reg2 = new ChatRegistry();
    expect(reg2.has(777)).toBe(false);
    await reg2.hydrate();
    expect(reg2.has(777)).toBe(true);
    expect(reg2.findByUsername("@dave")).toBe(888);
    expect(reg2.list()).toHaveLength(2);
  });

  it("register awaits hydration — write lands in the store", async () => {
    const reg = new ChatRegistry();
    await reg.register(999, "@eve");

    const { getDatabase } = await import(
      "../../../src/server/lib/database"
    );
    const row = await getDatabase().chatSubscriptions.findByUsername("@eve");
    expect(row).not.toBeNull();
    expect(Number(row?.chatId)).toBe(999);
  });

  it("works with zero env (pure in-memory, no config)", async () => {
    delete process.env.MOCK_HEDERA;
    delete process.env.HEDERA_OPERATOR_ID;
    resetConfigCache();
    resetDatabaseForTests();

    const reg = new ChatRegistry();
    await reg.register(42, "@noenv");
    expect(reg.has(42)).toBe(true);
    expect(reg.findByUsername("@noenv")).toBe(42);
  });
});

describe("ChatRegistry PG mode (opt-in: DATABASE_URL_LIVE)", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env = { ...originalEnv };
    setupMockEnv();
    resetConfigCache();
    resetDatabaseForTests();
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    resetConfigCache();
    resetDatabaseForTests();
  });

  it("register → restart → hydrate restores from PG", async () => {
    if (!process.env.DATABASE_URL_LIVE) return; // opt-in: local docker PG
    process.env.DATABASE_ENABLED = "true";
    process.env.DATABASE_URL = process.env.DATABASE_URL_LIVE;
    resetConfigCache();
    resetDatabaseForTests();

    const tag = Date.now() % 1_000_000_000;
    const reg1 = new ChatRegistry();
    await reg1.register(tag, `@pg${tag}`);

    // Simulate restart: fresh registry + fresh db singleton
    resetDatabaseForTests();
    const reg2 = new ChatRegistry();
    await reg2.hydrate();
    expect(reg2.findByUsername(`@pg${tag}`)).toBe(tag);
  });
});
