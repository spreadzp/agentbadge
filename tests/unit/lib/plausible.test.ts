import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { getPlausibleScript } from "../../../src/server/lib/plausible";

describe("plausible", () => {
  beforeEach(() => {
    delete process.env.PLAUSIBLE_ENABLED;
    delete process.env.PLAUSIBLE_DOMAIN;
  });

  afterEach(() => {
    delete process.env.PLAUSIBLE_ENABLED;
    delete process.env.PLAUSIBLE_DOMAIN;
  });

  it("returns empty string when PLAUSIBLE_ENABLED is not set", () => {
    const script = getPlausibleScript();
    expect(script).toBe("");
  });

  it("returns empty string when PLAUSIBLE_ENABLED is false", () => {
    process.env.PLAUSIBLE_ENABLED = "false";
    const script = getPlausibleScript();
    expect(script).toBe("");
  });

  it("returns script tag when PLAUSIBLE_ENABLED is true", () => {
    process.env.PLAUSIBLE_ENABLED = "true";
    process.env.PLAUSIBLE_DOMAIN = "agentbadge.xyz";
    const script = getPlausibleScript();
    expect(script).toContain("<script");
    expect(script).toContain("plausible.io");
    expect(script).toContain('data-domain="agentbadge.xyz"');
  });

  it("returns empty string when enabled but no domain set", () => {
    process.env.PLAUSIBLE_ENABLED = "true";
    const script = getPlausibleScript();
    expect(script).toBe("");
  });

  it("includes defer attribute", () => {
    process.env.PLAUSIBLE_ENABLED = "true";
    process.env.PLAUSIBLE_DOMAIN = "agentbadge.xyz";
    const script = getPlausibleScript();
    expect(script).toContain("defer");
  });
});
