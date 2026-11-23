/**
 * SLICE-103-5: Benchmark API — public endpoints for corpus benchmarks.
 *
 * GET /api/benchmarks           — overall benchmark (200 + empty collection if <50 records)
 * GET /api/benchmarks/:category — per-category benchmark
 * GET /api/benchmarks/pillars/:pillar — per-pillar benchmark
 * GET /api/corpus/stats         — corpus metadata
 *
 * All endpoints: public (no auth), Cache-Control: public, max-age=3600
 */

import { Hono } from "hono";
import { describeRoute } from "hono-openapi";
import { FileCorpusStore } from "../../../agent-readiness/corpus/corpus-store";
import { InMemoryBenchmarkCache } from "../../../agent-readiness/corpus/benchmark-cache";
import {
  computeOverallBenchmark,
  computeCategoryBenchmark,
  computePillarBenchmark,
} from "../../../agent-readiness/corpus/benchmark-engine";

export const benchmarkRoutes = new Hono();

const CACHE_TTL = 3600; // 1 hour
const NO_DATA_TTL = 60; // empty collection re-checks sooner — corpus may fill
const cache = new InMemoryBenchmarkCache();
const store = new FileCorpusStore();

// SLICE-259-21: empty corpus is a 200 empty collection, not a 503.
// 503 is reserved for genuine source failure (store throws).
const noData = (sampleCount: number) => ({
  sample_count: sampleCount,
  data: [] as unknown[],
  note: "no_data",
});

// GET /api/benchmarks — overall benchmark
benchmarkRoutes.get(
  "/api/benchmarks",
  describeRoute({
    tags: ["Benchmarks"],
    summary: "Get overall agent readiness benchmarks",
    description:
      "Returns cross-scan benchmark data: score histogram, category benchmarks, pillar benchmarks, top gaps. Public endpoint, cached 1 hour.",
    responses: {
      200: { description: "Overall benchmark data (empty collection with note:no_data when corpus has <50 records)" },
      503: { description: "Benchmark source unavailable" },
    },
  }),
  async (c) => {
    // Check cache
    const cached = cache.getOverall();
    if (cached) {
      c.header("Cache-Control", `public, max-age=${CACHE_TTL}`);
      return c.json(cached);
    }

    // Load records + stats
    let result;
    try {
      const records = await store.query({});
      const stats = await store.getStats();
      result = computeOverallBenchmark(records, stats);
    } catch {
      return c.json({ error: "source_unavailable", note: "benchmark source unavailable", retryable: true }, 503);
    }

    if ("insufficient_data" in result) {
      c.header("Cache-Control", `public, max-age=${NO_DATA_TTL}`);
      return c.json(noData(result.sample_count));
    }

    // Cache + return
    cache.setOverall(result, CACHE_TTL);
    c.header("Cache-Control", `public, max-age=${CACHE_TTL}`);
    return c.json(result);
  },
);

// GET /api/benchmarks/:category — per-category benchmark
benchmarkRoutes.get(
  "/api/benchmarks/:category",
  describeRoute({
    tags: ["Benchmarks"],
    summary: "Get per-category benchmark",
    description: "Returns benchmark data for a specific category: percentiles, mean, median, stddev, common gaps.",
    responses: {
      200: { description: "Category benchmark data (empty collection with note:no_data when insufficient samples)" },
      503: { description: "Benchmark source unavailable" },
    },
  }),
  async (c) => {
    const category = c.req.param("category");

    // Check cache
    const cached = cache.getCategory(category);
    if (cached) {
      c.header("Cache-Control", `public, max-age=${CACHE_TTL}`);
      return c.json(cached);
    }

    let result;
    try {
      const records = await store.query({});
      result = computeCategoryBenchmark(records, category);
    } catch {
      return c.json({ error: "source_unavailable", note: "benchmark source unavailable", retryable: true }, 503);
    }

    if ("insufficient_data" in result) {
      c.header("Cache-Control", `public, max-age=${NO_DATA_TTL}`);
      return c.json(noData(result.sample_count));
    }

    cache.setCategory(category, result, CACHE_TTL);
    c.header("Cache-Control", `public, max-age=${CACHE_TTL}`);
    return c.json(result);
  },
);

// GET /api/benchmarks/pillars/:pillar — per-pillar benchmark
benchmarkRoutes.get(
  "/api/benchmarks/pillars/:pillar",
  describeRoute({
    tags: ["Benchmarks"],
    summary: "Get per-pillar benchmark",
    description: "Returns benchmark data for a specific pillar: percentiles, mean, median.",
    responses: {
      200: { description: "Pillar benchmark data (empty collection with note:no_data when insufficient samples)" },
      503: { description: "Benchmark source unavailable" },
    },
  }),
  async (c) => {
    const pillar = c.req.param("pillar");
    let result;
    try {
      const records = await store.query({});
      result = computePillarBenchmark(records, pillar);
    } catch {
      return c.json({ error: "source_unavailable", note: "benchmark source unavailable", retryable: true }, 503);
    }

    if ("insufficient_data" in result) {
      c.header("Cache-Control", `public, max-age=${NO_DATA_TTL}`);
      return c.json(noData(result.sample_count));
    }

    c.header("Cache-Control", `public, max-age=${CACHE_TTL}`);
    return c.json(result);
  },
);

// GET /api/corpus/stats — corpus metadata
benchmarkRoutes.get(
  "/api/corpus/stats",
  describeRoute({
    tags: ["Benchmarks"],
    summary: "Get corpus statistics",
    description: "Returns corpus metadata: total records, date range, ruleset versions, verticals.",
    responses: {
      200: { description: "Corpus statistics" },
    },
  }),
  async (c) => {
    try {
      const stats = await store.getStats();
      c.header("Cache-Control", `public, max-age=${CACHE_TTL}`);
      return c.json(stats);
    } catch {
      return c.json({ error: "source_unavailable", note: "benchmark source unavailable", retryable: true }, 503);
    }
  },
);
