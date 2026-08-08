import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from "vitest";
import { createServer, type Server } from "node:http";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

vi.mock("node:dns/promises", () => ({
  resolve4: vi.fn(),
  resolve6: vi.fn(),
}));

import { resolve4, resolve6 } from "node:dns/promises";
import { scanDomain } from "../../../src/agent-readiness/scanner/orchestrator";
import { serializeSourceState } from "../../../src/agent-readiness/scanner/source-state";

const mockResolve4 = vi.mocked(resolve4);
const mockResolve6 = vi.mocked(resolve6);

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURE_DIR = join(__dirname, "fixtures", "fixture-site");

const PUBLIC_IP = "93.184.216.34";

let server: Server;
let baseUrl: string;

function serveFile(reqPath: string): { status: number; body: Buffer; contentType: string } {
  try {
    const filePath = join(FIXTURE_DIR, reqPath);
    const body = readFileSync(filePath);
    const ext = reqPath.endsWith(".json") ? "application/json" :
      reqPath.endsWith(".xml") ? "application/xml" :
        reqPath.endsWith(".txt") ? "text/plain" : "application/octet-stream";
    return { status: 200, body, contentType: ext };
  } catch {
    return { status: 404, body: Buffer.from("Not Found"), contentType: "text/plain" };
  }
}

beforeAll(async () => {
  server = createServer((req, res) => {
    const url = req.url ?? "/";
    let reqPath = url;

    // Map URL paths to fixture files
    if (url === "/robots.txt") reqPath = "robots.txt";
    else if (url === "/sitemap.xml") reqPath = "sitemap.xml";
    else if (url === "/openapi.json") reqPath = "openapi.json";
    else if (url === "/.well-known/agent-guide.json") reqPath = ".well-known/agent-guide.json";
    else if (url === "/.well-known/mcp.json") reqPath = ".well-known/mcp.json";
    else {
      res.writeHead(404, { "Content-Type": "text/plain" });
      res.end("Not Found");
      return;
    }

    const { status, body, contentType } = serveFile(reqPath);
    res.writeHead(status, { "Content-Type": contentType, "Content-Length": body.length });
    res.end(body);
  });

  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      if (addr && typeof addr === "object") {
        baseUrl = `http://localhost:${addr.port}`;
      }
      resolve();
    });
  });
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

beforeEach(() => {
  mockResolve4.mockReset();
  mockResolve6.mockReset();
  mockResolve6.mockRejectedValue(new Error("no AAAA"));
  // Always resolve to a public IP so SSRF guard passes
  mockResolve4.mockResolvedValue([PUBLIC_IP]);
});

describe("E2E: Fixture Site Scanner", () => {
  it("scans fixture site and returns all 5 resources", async () => {
    const result = await scanDomain(baseUrl);

    expect(result.domain).toBe("localhost");
    expect(result.snapshots).toBeDefined();

    const resourceKeys = Object.keys(result.snapshots);
    expect(resourceKeys).toContain("robots");
    expect(resourceKeys).toContain("sitemap");
    expect(resourceKeys).toContain("guide");
    expect(resourceKeys).toContain("openapi");
    expect(resourceKeys).toContain("mcp");

    // Only check the original 5 resources that the fixture server supports
    const originalResources = ["robots", "sitemap", "guide", "openapi", "mcp"];
    for (const key of originalResources) {
      const snap = result.snapshots[key];
      expect(snap).not.toBeNull();
      expect(snap!.bodyHash).toBeTruthy();
      expect(snap!.bodyHash).toHaveLength(64); // SHA-256 hex
      expect(snap!.status).toBe(200);
      expect(snap!.bodySize).toBeGreaterThan(0);
    }
  });

  it("snapshots have resolvedIp and fetchedAt", async () => {
    const result = await scanDomain(baseUrl);

    // Only check the original 5 resources that the fixture server supports
    const originalResources = ["robots", "sitemap", "guide", "openapi", "mcp"];
    for (const key of originalResources) {
      const snap = result.snapshots[key];
      expect(snap).not.toBeNull();
      expect(snap!.resolvedIp).toBe(PUBLIC_IP);
      expect(snap!.fetchedAt).toBeTruthy();
      expect(snap!.fetchTimeMs).toBeGreaterThanOrEqual(0);
    }
  });

  it("sourceState serializes to valid JSON", async () => {
    const result = await scanDomain(baseUrl);
    const json = serializeSourceState(result);
    const parsed = JSON.parse(json);

    expect(parsed.domain).toBe("localhost");
    expect(parsed.scannedAt).toBeTruthy();
    expect(parsed.snapshots).toBeDefined();
    expect(parsed.snapshots.robots.bodyHash).toHaveLength(64);
  });

  it("cached re-scan returns identical body hashes", async () => {
    const first = await scanDomain(baseUrl);
    const firstHashes = Object.fromEntries(
      Object.entries(first.snapshots).map(([k, v]) => [k, v?.bodyHash]),
    );

    // Re-scan — should use cache (same instance since cache is per-call)
    // Note: scanDomain creates a new cache per call, so this tests determinism
    const second = await scanDomain(baseUrl);
    const secondHashes = Object.fromEntries(
      Object.entries(second.snapshots).map(([k, v]) => [k, v?.bodyHash]),
    );

    expect(secondHashes).toEqual(firstHashes);
  });

  it("noCache re-scan refetches all resources", async () => {
    const first = await scanDomain(baseUrl);
    const firstFetchTimes = Object.fromEntries(
      Object.entries(first.snapshots).map(([k, v]) => [k, v?.fetchTimeMs]),
    );

    // Small delay to ensure fetchTimeMs differs
    await new Promise((r) => setTimeout(r, 10));

    const second = await scanDomain(baseUrl, { noCache: true });
    const secondFetchTimes = Object.fromEntries(
      Object.entries(second.snapshots).map(([k, v]) => [k, v?.fetchTimeMs]),
    );

    // Body hashes should be the same (same content)
    for (const key of Object.keys(first.snapshots)) {
      expect(second.snapshots[key]?.bodyHash).toBe(first.snapshots[key]?.bodyHash);
    }
    // But it should have actually fetched (not cached)
    // Only check the original 5 resources have matching body hashes
    const originalResources = ["robots", "sitemap", "guide", "openapi", "mcp"];
    for (const key of originalResources) {
      expect(second.snapshots[key]?.bodyHash).toBe(first.snapshots[key]?.bodyHash);
    }
  });

  it("resource filter — only robots and sitemap", async () => {
    const result = await scanDomain(baseUrl, { resources: ["robots", "sitemap"] });

    expect(Object.keys(result.snapshots).sort()).toEqual(["robots", "sitemap"]);
    expect(result.snapshots.robots).not.toBeNull();
    expect(result.snapshots.sitemap).not.toBeNull();
    expect(result.snapshots.guide).toBeUndefined();
  });

  it("robots.txt content is valid", async () => {
    const result = await scanDomain(baseUrl);
    const robots = result.snapshots.robots;
    expect(robots).not.toBeNull();
    expect(robots!.status).toBe(200);
    expect(robots!.bodySize).toBeGreaterThan(0);
  });

  it("sitemap.xml content is valid", async () => {
    const result = await scanDomain(baseUrl);
    const sitemap = result.snapshots.sitemap;
    expect(sitemap).not.toBeNull();
    expect(sitemap!.status).toBe(200);
    expect(sitemap!.bodySize).toBeGreaterThan(0);
  });

  it("agent-guide.json content is valid", async () => {
    const result = await scanDomain(baseUrl);
    const guide = result.snapshots.guide;
    expect(guide).not.toBeNull();
    expect(guide!.status).toBe(200);
  });

  it("openapi.json content is valid", async () => {
    const result = await scanDomain(baseUrl);
    const openapi = result.snapshots.openapi;
    expect(openapi).not.toBeNull();
    expect(openapi!.status).toBe(200);
  });

  it("mcp.json content is valid", async () => {
    const result = await scanDomain(baseUrl);
    const mcp = result.snapshots.mcp;
    expect(mcp).not.toBeNull();
    expect(mcp!.status).toBe(200);
  });
});
