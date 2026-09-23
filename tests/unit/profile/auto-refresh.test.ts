import { describe, it, expect, beforeEach } from "vitest";
import { refreshProfileForDomain, storeAndRefresh } from "../../../src/server/profile/auto-refresh";
import { cacheScanData, clearScanCache } from "../../../src/server/profile/profile-store";
import { resetConfigCache } from "../../../src/config/env";
import { makeFixtureScanReport, makeFixtureAssertions } from "../profile/fixtures/scan-report-fixture";

/**
 * SLICE-101-9: Auto-refresh tests.
 */

describe("SLICE-101-9: refreshProfileForDomain", () => {
  beforeEach(() => {
    delete process.env.DATABASE_ENABLED;
    delete process.env.DATABASE_URL;
    resetConfigCache();
    clearScanCache();
  });

  it("returns success=false when no scan data exists", async () => {
    const result = await refreshProfileForDomain("never-scanned.example.com");
    expect(result.success).toBe(false);
    expect(result.error).toContain("No scan data");
  });

  it("returns success=true with profile when scan data exists", async () => {
    cacheScanData("api.example.com", {
      scanReport: makeFixtureScanReport(),
      assertions: makeFixtureAssertions(),
      reportId: "REFRESH-TEST",
    });

    const result = await refreshProfileForDomain("api.example.com");
    expect(result.success).toBe(true);
    expect(result.profile).toBeDefined();
    expect(result.profile!.profile_version).toBe("1.0.0");
    expect(result.profile!.service.domain).toBe("api.example.com");
  });

  it("normalizes domain before lookup", async () => {
    cacheScanData("api.example.com", {
      scanReport: makeFixtureScanReport(),
      assertions: makeFixtureAssertions(),
      reportId: "REFRESH-NORM",
    });

    const result = await refreshProfileForDomain("https://api.example.com/");
    expect(result.success).toBe(true);
  });
});

describe("SLICE-101-9: storeAndRefresh", () => {
  beforeEach(() => {
    delete process.env.DATABASE_ENABLED;
    delete process.env.DATABASE_URL;
    resetConfigCache();
    clearScanCache();
  });

  it("stores scan data and generates profile", async () => {
    const result = await storeAndRefresh("api.example.com", {
      scanReport: makeFixtureScanReport(),
      assertions: makeFixtureAssertions(),
      reportId: "STORE-TEST",
    });

    expect(result.success).toBe(true);
    expect(result.profile).toBeDefined();
    expect(result.profile!.service.domain).toBe("api.example.com");
  });

  it("handles errors gracefully", async () => {
    // Pass invalid data to trigger build error
    const result = await storeAndRefresh("test.example.com", {
      scanReport: null as never,
      assertions: [],
    });

    expect(result.success).toBe(false);
    expect(result.error).toBeDefined();
  });
});
