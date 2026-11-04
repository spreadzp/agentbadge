/**
 * SLICE-206-12 (EPIC-206): ?src= attribution sweep + conversion metric.
 *
 * Contracts:
 * - ?src=<whitelisted> recorded on every bot entry point (well-known,
 *   skill.md, agent-guide, pricing, discovery manifests already covered
 *   by routes/discovery.ts + markdown mirrors).
 * - Unknown values normalize to "other"; no ?src → no record.
 * - srcAttributionStats aggregates hits + register (2xx) conversions.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { makeTestApp, setupMockEnv } from "./helpers";
import {
  srcCounts,
  normalizeSrc,
} from "../../src/server/middleware/src-attribution";
import {
  srcAttributionStats,
  srcAttributionSection,
  type TrafficRow,
} from "../../src/server/lib/report/traffic-format";

describe("?src sweep on agent-readable entry points", () => {
  beforeEach(() => {
    setupMockEnv();
    srcCounts.clear();
  });
  afterEach(() => vi.unstubAllEnvs());

  for (const path of [
    "/skill.md",
    "/agent-guide/context",
    "/agent-guide/getting-started",
    "/pricing.json",
    "/pricing.md",
    "/llms.txt",
    "/.well-known/agent-card.json",
  ]) {
    it(`records ?src=smithery on ${path}`, async () => {
      const app = makeTestApp();
      const res = await app.request(`${path}?src=smithery`);
      expect(res.status).toBe(200);
      expect(srcCounts.get("smithery")).toBeGreaterThanOrEqual(1);
    });
  }

  it("normalizes unknown ?src to 'other'", async () => {
    const app = makeTestApp();
    const res = await app.request("/pricing.json?src=freeregistry99");
    expect(res.status).toBe(200);
    expect(normalizeSrc("freeregistry99")).toBe("other");
    expect(srcCounts.get("other")).toBeGreaterThanOrEqual(1);
    expect(srcCounts.get("freeregistry99")).toBeUndefined();
  });

  it("no ?src → no record", async () => {
    const app = makeTestApp();
    const res = await app.request("/skill.md");
    expect(res.status).toBe(200);
    expect(srcCounts.size).toBe(0);
  });
});

describe("srcAttributionStats — hits + register conversions", () => {
  const row = (
    path: string,
    src: string | null,
    status = 200,
  ): TrafficRow => ({
    payload: { method: "GET", path, status, src },
    createdAt: new Date().toISOString(),
  });

  it("counts hits per src and 2xx register conversions", () => {
    const stats = srcAttributionStats([
      row("/llms.txt", "smithery"),
      row("/skill.md", "smithery"),
      row("/api/v1/agents/register", "smithery", 201),
      row("/api/v1/agents/register", "smithery", 400),
      row("/pricing.json", "glama"),
      row("/skill.md", null),
    ]);
    const sm = stats.find((s) => s.src === "smithery")!;
    expect(sm.hits).toBe(4);
    expect(sm.conversions).toBe(1); // only the 201 counts
    const gl = stats.find((s) => s.src === "glama")!;
    expect(gl.hits).toBe(1);
    expect(gl.conversions).toBe(0);
    expect(stats.find((s) => s.src === null)).toBeUndefined();
  });

  it("renders src → conversion line", () => {
    const body = srcAttributionSection([
      row("/llms.txt", "smithery"),
      row("/api/v1/agents/register", "smithery", 201),
    ]);
    expect(body).toContain("smithery");
    expect(body).toContain("registration");
    expect(srcAttributionSection([])).toContain("no ?src-attributed");
  });
});
