import { describe, expect, it } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  collectEndpoints, endpointsFromCode, endpointsFromOpenapi,
  endpointsFromRegistry, endpointsFromX402, matchEndpoint,
} from "../../scripts/probe-bot/src/inventory";

describe("openapi source", () => {
  it("извлекает path×method из paths", () => {
    const eps = endpointsFromOpenapi({
      paths: { "/a": { get: {}, post: {} }, "/b": { get: {} } },
    });
    expect(eps).toHaveLength(3);
    expect(eps).toContainEqual({ path: "/a", method: "GET", source: "openapi" });
    expect(eps).toContainEqual({ path: "/b", method: "GET", source: "openapi" });
  });
});

describe("x402 source", () => {
  it("находит платные пути в произвольной структуре", () => {
    const eps = endpointsFromX402({
      resources: [
        { path: "/api/v1/demo/scan-lite", price: "$0.001" },
        { url: "/api/v1/fx/delta/premium" },
      ],
      other: { nested: [{ endpoint: "/api/passport/request" }] },
    });
    const paths = eps.map(e => e.path);
    expect(paths).toContain("/api/v1/demo/scan-lite");
    expect(paths).toContain("/api/v1/fx/delta/premium");
    expect(paths).toContain("/api/passport/request");
    expect(eps.every(e => e.source === "x402")).toBe(true);
  });
});

describe("code source", () => {
  it("сканирует hono-вызовы и mount'ы", () => {
    const dir = mkdtempSync(join(tmpdir(), "routes-"));
    mkdirSync(join(dir, "sub"));
    writeFileSync(join(dir, "a.ts"), `app.get("/api/a", h); app.post("/api/b", h2);`);
    writeFileSync(join(dir, "sub", "b.ts"), `r.get("/events/:id", h);`);
    writeFileSync(join(dir, "index.ts"), `app.route("/api/ledger", ledger);`);
    const eps = endpointsFromCode(dir);
    const paths = eps.map(e => e.path);
    expect(paths).toContain("/api/a");
    expect(paths).toContain("/api/b");
    expect(paths).toContain("/events/:id");
    expect(paths).toContain("/api/ledger");
  });
});

describe("registry source", () => {
  it("читает manual-реестр", () => {
    const dir = mkdtempSync(join(tmpdir(), "reg-"));
    const f = join(dir, "registry.yaml");
    writeFileSync(f, "endpoints:\n  - {path: /metrics, method: GET}\n  - {path: /x}\n");
    const eps = endpointsFromRegistry(f);
    expect(eps).toContainEqual({ path: "/metrics", method: "GET", source: "manual" });
    expect(eps).toContainEqual({ path: "/x", method: "GET", source: "manual" });
  });
});

describe("collectEndpoints union + matchEndpoint", () => {
  it("объединяет источники без сети", async () => {
    const dir = mkdtempSync(join(tmpdir(), "inv-"));
    writeFileSync(join(dir, "r.ts"), `app.get("/code-only", h);`);
    const reg = join(dir, "reg.yaml");
    writeFileSync(reg, "endpoints:\n  - {path: /manual-one}\n");
    const eps = await collectEndpoints({
      codeDir: dir, registryPath: reg,
      openapiDoc: { paths: { "/oa": { get: {} } } },
      x402Doc: { resources: [{ path: "/paid" }] },
    });
    const paths = eps.map(e => e.path);
    for (const p of ["/oa", "/paid", "/code-only", "/manual-one"]) {
      expect(paths).toContain(p);
    }
  });

  it("matchEndpoint: глобы и префиксы", () => {
    expect(matchEndpoint("/api/x", [])).toBe(true);
    expect(matchEndpoint("/api/x", ["/api/*"])).toBe(true);
    expect(matchEndpoint("/api/x/y", ["/api/x"])).toBe(true);
    expect(matchEndpoint("/other", ["/api/*"])).toBe(false);
  });
});
