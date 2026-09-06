/**
 * SLICE-103-5: Benchmark API — public endpoints for corpus benchmarks.
 *
 * GET /api/benchmarks           — overall benchmark (503 if <50 records)
 * GET /api/benchmarks/:category — per-category benchmark
 * GET /api/benchmarks/pillars/:pillar — per-pillar benchmark
 * GET /api/corpus/stats         — corpus metadata
 *
 * All endpoints: public (no auth), Cache-Control: public, max-age=3600
 */

import { Hono } from "hono";
import { describeRoute } from "hono-openapi";
import { FileCorpusStore } from "../../agent-readiness/corpus/corpus-store";
import { InMemoryBenchmarkCache } from "../../agent-readiness/corpus/benchmark-cache";
import {
  computeOverallBenchmark,
  computeCategoryBenchmark,
  computePillarBenchmark,
} from "../../agent-readiness/corpus/benchmark-engine";

export const benchmarkRoutes = new Hono();

const CACHE_TTL = 3600; // 1 hour
const cache = new InMemoryBenchmarkCache();
const store = new FileCorpusStore();

// GET /api/benchmarks — overall benchmark
benchmarkRoutes.get(
  "/api/benchmarks",
  describeRoute({
    tags: ["Benchmarks"],
    summary: "Get overall agent readiness benchmarks",
    description:
      "Returns cross-scan benchmark data: score histogram, category benchmarks, pillar benchmarks, top gaps. Public endpoint, cached 1 hour.",
    responses: {
      200: { description: "Overall benchmark data" },
      503: { description: "Insufficient data (fewer than 50 scans in corpus)" },
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
    const records = await store.query({});
    const stats = await store.getStats();

    const result = computeOverallBenchmark(records, stats);

    if ("insufficient_data" in result) {
      return c.json({ error: "insufficient_data", sample_count: result.sample_count }, 503);
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
      200: { description: "Category benchmark data" },
      503: { description: "Insufficient data for this category" },
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

    const records = await store.query({});
    const result = computeCategoryBenchmark(records, category);

    if ("insufficient_data" in result) {
      return c.json({ error: "insufficient_data", sample_count: result.sample_count }, 503);
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
      200: { description: "Pillar benchmark data" },
      503: { description: "Insufficient data for this pillar" },
    },
  }),
  async (c) => {
    const pillar = c.req.param("pillar");
    const records = await store.query({});
    const result = computePillarBenchmark(records, pillar);

    if ("insufficient_data" in result) {
      return c.json({ error: "insufficient_data", sample_count: result.sample_count }, 503);
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
    const stats = await store.getStats();
    c.header("Cache-Control", `public, max-age=${CACHE_TTL}`);
    return c.json(stats);
  },
);
