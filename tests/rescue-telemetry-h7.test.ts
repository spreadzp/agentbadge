/** H-7 telemetry hardening regression tests. */
import { describe, expect, it } from "vitest";
import { validateTelemetryPayload } from "../src/server/routes/rescue-telemetry.js";

const OK = {
  schema: "rescue-telemetry/1", route: "base→arc", asset: "USDC",
  amount: "5000000", status: "DONE",
};

describe("H-7 whitelist copy + caps", () => {
  it("drops unknown extra fields from persisted value", () => {
    const v = validateTelemetryPayload({ ...OK, evil: "x", inject: { a: 1 } });
    expect(v.ok).toBe(true);
    if (v.ok) {
      expect(v.value).not.toHaveProperty("evil");
      expect(v.value).not.toHaveProperty("inject");
      expect(v.value.schema).toBe("rescue-telemetry/1");
    }
  });
  it("caps cliVersion/timestamp lengths", () => {
    expect(validateTelemetryPayload({ ...OK, cliVersion: "x".repeat(41) }).ok).toBe(false);
    expect(validateTelemetryPayload({ ...OK, timestamp: "x".repeat(41) }).ok).toBe(false);
    expect(validateTelemetryPayload({ ...OK, cliVersion: "1.2.3" }).ok).toBe(true);
  });
  it("caps amount length", () => {
    expect(validateTelemetryPayload({ ...OK, amount: "1".repeat(31) }).ok).toBe(false);
  });
  it("caps txHashes entries at 12 and validates keys", () => {
    const many = Object.fromEntries(Array.from({ length: 13 }, (_, i) => [`k${i}`, "0x" + "ab".repeat(32)]));
    expect(validateTelemetryPayload({ ...OK, txHashes: many }).ok).toBe(false);
    expect(validateTelemetryPayload({ ...OK, txHashes: { "bad key!": "0x" + "ab".repeat(32) } }).ok).toBe(false);
    expect(validateTelemetryPayload({ ...OK, txHashes: { approve: "0x" + "ab".repeat(32) } }).ok).toBe(true);
  });
});
