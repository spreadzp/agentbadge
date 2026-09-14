/**
 * SLICE-130-12: Plausible events lib unit tests.
 * Tests the real trackPlausibleEvent implementation.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { trackPlausibleEvent, isPlausibleEventsEnabled } from "../../src/server/lib/plausible-events";

describe("SLICE-130-12: plausible-events lib", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env = { ...originalEnv };
    delete process.env.PLAUSIBLE_ENABLED;
    delete process.env.PLAUSIBLE_DOMAIN;
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    vi.restoreAllMocks();
  });

  it("disabled → no fetch call", async () => {
    expect(isPlausibleEventsEnabled()).toBe(false);
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    await trackPlausibleEvent("test_event", { foo: "bar" });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("enabled → POST to plausible.io/api/event with correct body", async () => {
    process.env.PLAUSIBLE_ENABLED = "true";
    process.env.PLAUSIBLE_DOMAIN = "agentbadge.xyz";
    expect(isPlausibleEventsEnabled()).toBe(true);

    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("ok", { status: 200 }));
    await trackPlausibleEvent("scan_completed", { score: 85, grade: "A" }, "/scan");

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, opts] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://plausible.io/api/event");
    expect(opts.method).toBe("POST");
    const headers = opts.headers as Record<string, string>;
    expect(headers["Content-Type"]).toBe("application/json");
    expect(headers["User-Agent"]).toBeDefined();

    const body = JSON.parse(opts.body as string);
    expect(body.name).toBe("scan_completed");
    expect(body.domain).toBe("agentbadge.xyz");
    expect(body.url).toBe("https://agentbadge.xyz/scan");
    expect(body.props).toEqual({ score: 85, grade: "A" });
  });

  it("enabled but fetch fails → swallows error, no throw", async () => {
    process.env.PLAUSIBLE_ENABLED = "true";
    process.env.PLAUSIBLE_DOMAIN = "agentbadge.xyz";
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("network"));

    await trackPlausibleEvent("test", {});
    // If we get here without throwing, the test passes
    expect(true).toBe(true);
  });
});
