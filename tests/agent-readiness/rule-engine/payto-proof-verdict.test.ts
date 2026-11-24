// SLICE-258-24 arc-review C2: aggregate "verified" must not hide
// endpoints whose probes were skipped — cap at partial.
import { describe, expect, it } from "vitest";
import {
  coverageOf,
  mapEvaluationVerdict,
} from "../../../src/agent-readiness/rule-engine/semantic-checkers/payto-proof-verdict";
import type {
  AddressOutcome,
  EvaluationResult,
} from "@agentbadge/x402-payto-proof";

const ADDR = "0xaaaabbbbccccddddeeeeffff0000111122223333";

function verifiedRow(): AddressOutcome {
  return {
    key: "exact|https://api.example.com/pay|base|" + ADDR,
    payTo: ADDR,
    outcome: "verified",
    level: "dns",
    issued: "2026-11-20",
    signatureStatus: "none",
    anomalies: [],
    freshness: {
      observed_at: "2026-11-22T12:00:00Z",
      issued_age_days: 2,
      stale_issued: false,
      issued_in_future: false,
      issued_unparseable: false,
    },
  } as AddressOutcome;
}

function result(aggregate: EvaluationResult["aggregate"]): EvaluationResult {
  return {
    aggregate,
    perAddress: [verifiedRow()],
    conflicts: [],
    anomalies: [],
    freshness: "computed",
  } as EvaluationResult;
}

const labels = {
  subject: "Payout address",
  noPaymentsSummary: "Site does not advertise x402 payments",
};

describe("mapEvaluationVerdict — skip-cap (arc-review C2)", () => {
  it("verified + skipped probes → partial, never 'found'", () => {
    const cov = coverageOf([verifiedRow()], 2, 2, [], new Set(["no_accepts_in_402"]));
    const v = mapEvaluationVerdict(result("verified"), [verifiedRow()], cov, {
      anyProbe: true,
      observationsLen: 1,
    }, labels);
    expect(v.outcome).toBe("partial");
    expect(v.verdict).toBe("partial");
    expect(v.summary).toContain("no_accepts_in_402");
  });

  it("verified + zero skips → found/verified (clean case unchanged)", () => {
    const cov = coverageOf([verifiedRow()], 1, 1, [], new Set());
    const v = mapEvaluationVerdict(result("verified"), [verifiedRow()], cov, {
      anyProbe: true,
      observationsLen: 1,
    }, labels);
    expect(v.outcome).toBe("found");
    expect(v.verdict).toBe("verified");
  });

  it("skip_reasons surface in coverage JSON", () => {
    const cov = coverageOf([verifiedRow()], 3, 3, [], new Set(["second_probe_failed"]));
    expect(cov.skip_reasons).toEqual(["second_probe_failed"]);
  });
});
