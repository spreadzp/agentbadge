/**
 * EPIC-144 e2e: cache layer wiring.
 *
 * - CACHE_ENABLED off → `config.cache` undefined → zero behavior change
 *   (rate-limit MemoryStore, badge InMemoryCache).
 * - CACHE_ENABLED on (memory backend) → shared provider: rate-limit
 *   counters and badge entries persist across store instances
 *   (restart simulation) and drop on `invalidateDomain`.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { loadConfig, resetConfigCache } from "../../src/config/env";
import { getCache, resetCacheForTests, invalidateDomain } from "../../src/server/lib/cache";
import { CacheRateLimitStore } from "../../src/server/middleware/rate-limit-redis-store";
import { BadgeCache } from "../../src/agent-readiness/badge/badge-cache";
import { InMemoryCache } from "@agentbadge/cache";

const REQUIRED_ENV: Record<string, string> = {
  HEDERA_OPERATOR_ID: "0.0.5266613",
  HEDERA_OPERATOR_KEY: "302e020100300506032b657004220420abcdef",
  HEDERA_NETWORK: "testnet",
  PASSPORT_TOKEN_ID: "0.0.1234567",
  AUDIT_TOPIC_ID: "0.0.7654321",
  DIRECTORY_TOPIC_ID: "0.0.8765432",
  x402_FACILITATOR_URL: "https://api.testnet.blocky402.com",
  x402_FEE_PAYER: "0.0.7162784",
  x402_TREASURY: "0.0.8011510",
  IPFS_API_KEY: "test-key",
  IPFS_API_SECRET: "test-secret",
  PORT: "4021",
};

describe("e2e: cache layer (EPIC-144)", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env = { ...originalEnv, ...REQUIRED_ENV };
    delete process.env.CACHE_ENABLED;
    delete process.env.CACHE_BACKEND;
    delete process.env.CACHE_URL;
    delete process.env.CACHE_TOKEN;
    resetConfigCache();
    resetCacheForTests();
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    resetConfigCache();
    resetCacheForTests();
  });

  describe("CACHE_ENABLED off → zero change", () => {
    it("config.cache is undefined", () => {
      const config = loadConfig();
      expect(config.cache).toBeUndefined();
    });

    it("getCache() still returns a working InMemoryCache", async () => {
      const cache = getCache();
      expect(cache).toBeInstanceOf(InMemoryCache);
      await cache.set("k", "v", { ttlSec: 60 });
      expect(await cache.get("k")).toBe("v");
    });
  });

  describe("CACHE_ENABLED on (memory backend)", () => {
    beforeEach(() => {
      process.env.CACHE_ENABLED = "true";
      process.env.CACHE_BACKEND = "memory";
      resetConfigCache();
      resetCacheForTests();
    });

    it("config.cache.enabled = true", () => {
      const config = loadConfig();
      expect(config.cache?.enabled).toBe(true);
      expect(config.cache?.backend).toBe("memory");
    });

    it("rate-limit counters persist across store instances (restart)", async () => {
      const provider = getCache();
      const storeA = new CacheRateLimitStore(provider);
      const storeB = new CacheRateLimitStore(provider); // "new instance"

      const first = await storeA.hit("ip:1.2.3.4", 60_000);
      const second = await storeB.hit("ip:1.2.3.4", 60_000);

      expect(first.count).toBe(1);
      expect(second.count).toBe(2); // shared counter survives "restart"
    });

    it("badge entries persist across BadgeCache instances", async () => {
      const provider = getCache();
      const a = new BadgeCache(provider);
      const b = new BadgeCache(provider);

      const entry = {
        svg: "<svg>badge</svg>",
        generatedAt: "2026-09-22T10:00:00.000Z",
        reportId: "01HTEST",
      };
      await a.set("example.com", entry);

      expect(await b.get("example.com")).toEqual(entry);
    });

    it("invalidateDomain drops badge entries via domain tag", async () => {
      const provider = getCache();
      const badge = new BadgeCache(provider);
      await badge.set("example.com", {
        svg: "<svg/>",
        generatedAt: "2026-09-22T10:00:00.000Z",
        reportId: "01H",
      });

      const removed = await invalidateDomain("example.com");

      expect(removed).toBe(1);
      expect(await badge.get("example.com")).toBeUndefined();
    });
  });
});
