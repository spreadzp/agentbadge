import { describe, it, expect, beforeEach } from "vitest";
import { BadgeCache, type CacheEntry } from "../../../src/agent-readiness/badge/badge-cache";

describe("SLICE-38-5: Badge Cache", () => {
  let cache: BadgeCache;

  beforeEach(() => {
    cache = new BadgeCache();
  });

  describe("set + get", () => {
    it("stores and retrieves an entry by scope", () => {
      const entry: CacheEntry = {
        svg: "<svg>test</svg>",
        generatedAt: "2025-01-15T10:00:00.000Z",
        reportId: "01HTEST",
      };
      cache.set("my-api", entry);
      const result = cache.get("my-api");
      expect(result).toEqual(entry);
    });

    it("returns undefined for missing scope", () => {
      expect(cache.get("unknown")).toBeUndefined();
    });

    it("overwrites existing entry on re-set", () => {
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
      cache.set("my-api", entry1);
      cache.set("my-api", entry2);
      expect(cache.get("my-api")?.svg).toBe("<svg>v2</svg>");
    });
  });

  describe("has", () => {
    it("returns true for existing scope", () => {
      cache.set("my-api", {
        svg: "<svg></svg>",
        generatedAt: "2025-01-15T10:00:00.000Z",
        reportId: "01HTEST",
      });
      expect(cache.has("my-api")).toBe(true);
    });

    it("returns false for missing scope", () => {
      expect(cache.has("unknown")).toBe(false);
    });
  });

  describe("invalidate", () => {
    it("removes entry and returns true", () => {
      cache.set("my-api", {
        svg: "<svg></svg>",
        generatedAt: "2025-01-15T10:00:00.000Z",
        reportId: "01HTEST",
      });
      expect(cache.invalidate("my-api")).toBe(true);
      expect(cache.has("my-api")).toBe(false);
    });

    it("returns false for missing scope", () => {
      expect(cache.invalidate("unknown")).toBe(false);
    });
  });

  describe("clear", () => {
    it("removes all entries", () => {
      cache.set("a", { svg: "<svg/>", generatedAt: "", reportId: "" });
      cache.set("b", { svg: "<svg/>", generatedAt: "", reportId: "" });
      cache.clear();
      expect(cache.size()).toBe(0);
      expect(cache.has("a")).toBe(false);
      expect(cache.has("b")).toBe(false);
    });
  });

  describe("size", () => {
    it("returns 0 for empty cache", () => {
      expect(cache.size()).toBe(0);
    });

    it("returns correct count after additions", () => {
      cache.set("a", { svg: "<svg/>", generatedAt: "", reportId: "" });
      cache.set("b", { svg: "<svg/>", generatedAt: "", reportId: "" });
      expect(cache.size()).toBe(2);
    });

    it("decrements on invalidate", () => {
      cache.set("a", { svg: "<svg/>", generatedAt: "", reportId: "" });
      cache.set("b", { svg: "<svg/>", generatedAt: "", reportId: "" });
      cache.invalidate("a");
      expect(cache.size()).toBe(1);
    });
  });
});
