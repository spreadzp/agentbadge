import { describe, it, expect, beforeEach } from "vitest";
import { BadgeCache, type CacheEntry } from "../../../src/agent-readiness/badge/badge-cache";

describe("SLICE-38-5: Badge Cache", () => {
  let cache: BadgeCache;

  beforeEach(() => {
    cache = new BadgeCache();
  });

  describe("set + get", () => {
    it("stores and retrieves an entry by scope", async () => {
      const entry: CacheEntry = {
        svg: "<svg>test</svg>",
        generatedAt: "2025-01-15T10:00:00.000Z",
        reportId: "01HTEST",
      };
      await cache.set("my-api", entry);
      const result = await cache.get("my-api");
      expect(result).toEqual(entry);
    });

    it("returns undefined for missing scope", async () => {
      expect(await cache.get("unknown")).toBeUndefined();
    });

    it("overwrites existing entry on re-set", async () => {
      const entry1: CacheEntry = {
        svg: "<svg>v1</svg>",
        generatedAt: "2025-01-15T10:00:00.000Z",
        reportId: "01HTEST1",
      };
      const entry2: CacheEntry = {
        svg: "<svg>v2</svg>",
        generatedAt: "2025-01-16T10:00:00.000Z",
        reportId: "01HTEST2",
      };
      await cache.set("my-api", entry1);
      await cache.set("my-api", entry2);
      expect((await cache.get("my-api"))?.svg).toBe("<svg>v2</svg>");
    });
  });

  describe("has", () => {
    it("returns true for existing scope", async () => {
      await cache.set("my-api", {
        svg: "<svg></svg>",
        generatedAt: "2025-01-15T10:00:00.000Z",
        reportId: "01HTEST",
      });
      expect(await cache.has("my-api")).toBe(true);
    });

    it("returns false for missing scope", async () => {
      expect(await cache.has("unknown")).toBe(false);
    });
  });

  describe("invalidate", () => {
    it("removes entry and returns true", async () => {
      await cache.set("my-api", {
        svg: "<svg></svg>",
        generatedAt: "2025-01-15T10:00:00.000Z",
        reportId: "01HTEST",
      });
      expect(await cache.invalidate("my-api")).toBe(true);
      expect(await cache.has("my-api")).toBe(false);
    });

    it("returns false for missing scope", async () => {
      expect(await cache.invalidate("unknown")).toBe(false);
    });
  });

  describe("clear", () => {
    it("removes all entries", async () => {
      await cache.set("a", { svg: "<svg/>", generatedAt: "", reportId: "" });
      await cache.set("b", { svg: "<svg/>", generatedAt: "", reportId: "" });
      await cache.clear();
      expect(cache.size()).toBe(0);
      expect(await cache.has("a")).toBe(false);
      expect(await cache.has("b")).toBe(false);
    });
  });

  describe("size", () => {
    it("returns 0 for empty cache", async () => {
      expect(cache.size()).toBe(0);
    });

    it("returns correct count after additions", async () => {
      await cache.set("a", { svg: "<svg/>", generatedAt: "", reportId: "" });
      await cache.set("b", { svg: "<svg/>", generatedAt: "", reportId: "" });
      expect(cache.size()).toBe(2);
    });

    it("decrements on invalidate", async () => {
      await cache.set("a", { svg: "<svg/>", generatedAt: "", reportId: "" });
      await cache.set("b", { svg: "<svg/>", generatedAt: "", reportId: "" });
      await cache.invalidate("a");
      expect(cache.size()).toBe(1);
    });
  });
});
