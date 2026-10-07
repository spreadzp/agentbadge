/**
 * SLICE-178-5: ?src= attribution + CI drift-check + self-scan dogfood + no-402 contract.
 *
 * AC1: ?src=smithery → audit event "src:smithery"; unknown src → "src:other".
 * AC2: drift-check — generated snapshots to tmp-dir; tampered file detected.
 * AC3: self-scan — scanDomain + RuleEngine on local app → AB-006/014/015/016/017 VERIFIED.
 * AC4: no discovery endpoint requires payment/auth (never 401/402/403).
 * AC5: docs/AGENT-DISCOVERY.md exists, ≤80 lines.
 */

import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { createServer, type Server } from "node:http";
import {
  mkdtempSync,
  cpSync,
  writeFileSync,
  existsSync,
  readFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

vi.mock("node:dns/promises", () => ({
  resolve4: vi.fn(),
  resolve6: vi.fn(),
}));

import { resolve4, resolve6 } from "node:dns/promises";

const mockResolve4 = vi.mocked(resolve4);
const mockResolve6 = vi.mocked(resolve6);
// Self-scan needs loopback: allow private IPs + resolve to 127.0.0.1
// (fetchPinned connects to the pinned IP directly).
process.env.AGENTBADGE_ALLOW_PRIVATE_IPS = "1";
mockResolve4.mockResolvedValue(["127.0.0.1"] as never);
mockResolve6.mockResolvedValue([] as never);

import { makeTestApp } from "./helpers";
import { createDiscoveryRoutes } from "../../src/server/routes/discovery";
import { MANIFEST_REGISTRY } from "../../src/server/lib/agent-discovery";
import { auditStore } from "../../src/server/services/audit-store";
import {
  writeDiscoverySnapshots,
  snapshotDirDiff,
} from "../../src/server/lib/agent-discovery/snapshot";
import { scanDomain } from "../../src/agent-readiness/scanner/orchestrator";
import { RuleEngine } from "../../src/agent-readiness/rule-engine/rule-engine";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SERVER_ROOT = join(__dirname, "..", "..");

// ─── AC1: ?src= attribution ──────────────────────────────────────────

describe("SLICE-178-5: ?src= attribution", () => {
  const app = createDiscoveryRoutes();

  it("GET /llms.txt?src=smithery records audit event with src:smithery", async () => {
    await auditStore.clear();
    const res = await app.request("/llms.txt?src=smithery");
    expect(res.status).toBe(200);
    const events = await auditStore.list();
    const hit = events.find(
      (e) => e.source === "discovery-attribution" && e.executionId === "src:smithery",
    );
    expect(hit).toBeDefined();
    expect(hit!.siteUrl).toBe("/llms.txt");
  });

  it("GET /llms.txt?src=evil normalizes to src:other", async () => {
    await auditStore.clear();
    const res = await app.request("/llms.txt?src=evil");
    expect(res.status).toBe(200);
    const events = await auditStore.list();
    const hit = events.find(
      (e) => e.source === "discovery-attribution" && e.executionId === "src:other",
    );
    expect(hit).toBeDefined();
  });

  it("no src param → no attribution event", async () => {
    await auditStore.clear();
    const res = await app.request("/llms.txt");
    expect(res.status).toBe(200);
    const events = await auditStore.list();
    expect(events.filter((e) => e.source === "discovery-attribution")).toHaveLength(0);
  });
});

// ─── AC2: CI drift-check ─────────────────────────────────────────────

describe("SLICE-178-5: snapshot drift-check", () => {
  it("writes registry manifests to tmp-dir and detects no drift on clean copy", () => {
    const dir = mkdtempSync(join(tmpdir(), "disc-snap-"));
    // Synthetic manifest map standing in for generated output.
    const manifests = new Map(
      MANIFEST_REGISTRY.filter((e) => e.publicPath).map((e) => [
        e.path,
        {
          body: `# ${e.path}\n`,
          contentType: e.contentType,
          cacheMaxAge: e.cacheMaxAge,
          publicPath: e.publicPath,
          redirectTo: undefined as string | undefined,
        },
      ]),
    );
    const written = writeDiscoverySnapshots(manifests as never, dir);
    expect(written.length).toBeGreaterThan(0);
    const mirror = mkdtempSync(join(tmpdir(), "disc-snap-copy-"));
    cpSync(dir, mirror, { recursive: true });
    expect(snapshotDirDiff(dir, mirror)).toEqual([]);
  });

  it("tampered public file → snapshotDirDiff reports the path (CI gate)", () => {
    const dir = mkdtempSync(join(tmpdir(), "disc-snap-"));
    const manifests = new Map(
      MANIFEST_REGISTRY.filter((e) => e.publicPath).map((e) => [
        e.path,
        {
          body: `# ${e.path}\n`,
          contentType: e.contentType,
          cacheMaxAge: e.cacheMaxAge,
          publicPath: e.publicPath,
          redirectTo: undefined as string | undefined,
        },
      ]),
    );
    writeDiscoverySnapshots(manifests as never, dir);
    const mirror = mkdtempSync(join(tmpdir(), "disc-snap-copy-"));
    cpSync(dir, mirror, { recursive: true });
    const target = join(mirror, "llms.txt");
    expect(existsSync(target)).toBe(true);
    writeFileSync(target, "TAMPERED\n", "utf-8");
    const diff = snapshotDirDiff(dir, mirror);
    expect(diff).toContain("llms.txt");
  });
});

// ─── AC4: discovery endpoints are free / no-auth ─────────────────────

describe("SLICE-178-5: discovery endpoints free contract", () => {
  const app = makeTestApp();

  it("no registry path returns 401/402/403", async () => {
    const paths = MANIFEST_REGISTRY.map((e) => e.path);
    for (const path of paths) {
      const res = await app.request(path);
      expect(
        [401, 402, 403].includes(res.status),
        `${path} must never require auth/payment (got ${res.status})`,
      ).toBe(false);
      expect([200, 301, 404].includes(res.status)).toBe(true);
    }
  });
});

// ─── AC3: self-scan dogfood ──────────────────────────────────────────

describe("SLICE-178-5: self-scan dogfood (agentbadge-scan on local app)", () => {
  let server: Server;
  let baseUrl: string;

  beforeAll(async () => {
    const app = makeTestApp();
    server = createServer(async (req, res) => {
      const url = `http://127.0.0.1${req.url ?? "/"}`;
      const response = await app.fetch(new Request(url, { method: req.method }));
      const headers: Record<string, string> = {};
      response.headers.forEach((v, k) => {
        headers[k] = v;
      });
      res.writeHead(response.status, headers);
      res.end(Buffer.from(await response.arrayBuffer()));
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const port = (server.address() as { port: number }).port;
    baseUrl = `http://localhost:${port}`;
  });

  afterAll(() => {
    server?.close();
  });

  it("AB-006/014/015/016/017 all VERIFIED on local app", async () => {
    const state = await scanDomain(baseUrl, {
      noCache: true,
      resources: ["mcp", "llms", "html", "ai_txt", "content_negotiation"],
    });
    const { assertions } = RuleEngine.run(state);
    const targets = ["AB-006", "AB-014", "AB-015", "AB-016", "AB-017"];
    for (const id of targets) {
      const a = assertions.find((x) => x.rule_id === id);
      expect(a, `assertion ${id} missing`).toBeDefined();
      expect(
        a!.status,
        `${id} status ${a!.status} — expected VERIFIED`,
      ).toBe("VERIFIED");
    }
  }, 60_000);
});

// ─── AC5: docs/AGENT-DISCOVERY.md ────────────────────────────────────

describe("SLICE-178-5: docs", () => {
  it("docs/AGENT-DISCOVERY.md exists and is ≤80 lines", () => {
    const doc = join(SERVER_ROOT, "docs", "AGENT-DISCOVERY.md");
    expect(existsSync(doc)).toBe(true);
    const lines = readFileSync(doc, "utf-8").split("\n").length;
    expect(lines).toBeLessThanOrEqual(80);
  });
});
