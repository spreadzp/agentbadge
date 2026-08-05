import { describe, it, expect } from "vitest";
import { createSnapshot } from "../src/agent-readiness/scanner/snapshot";
import { assembleSourceState, serializeSourceState } from "../src/agent-readiness/scanner/source-state";

describe("createSnapshot", () => {
  it("creates snapshot with SHA-256 hash", () => {
    const snap = createSnapshot({
      url: "https://example.com/robots.txt",
      status: 200,
      body: "User-agent: *",
    });
    expect(snap.bodyHash).toHaveLength(64);
    expect(snap.bodySize).toBe(13);
    expect(snap.status).toBe(200);
    expect(snap.fetchedAt).toBeTruthy();
  });

  it("handles null body", () => {
    const snap = createSnapshot({
      url: "https://example.com/missing",
      status: 404,
      body: null,
    });
    expect(snap.bodyHash).toBe("");
    expect(snap.bodySize).toBe(0);
  });
});

describe("assembleSourceState", () => {
  it("assembles domain + snapshots into SourceState", () => {
    const snap = createSnapshot({
      url: "https://example.com/robots.txt",
      status: 200,
      body: "test",
    });
    const state = assembleSourceState("example.com", { robots: snap, sitemap: null });
    expect(state.domain).toBe("example.com");
    expect(state.scannedAt).toBeTruthy();
    expect(state.snapshots.robots).toBe(snap);
    expect(state.snapshots.sitemap).toBeNull();
  });
});

describe("serializeSourceState", () => {
  it("produces valid JSON", () => {
    const state = assembleSourceState("example.com", {});
    const json = serializeSourceState(state);
    const parsed = JSON.parse(json);
    expect(parsed.domain).toBe("example.com");
  });
});
