/**
 * SLICE-181-1 tests — refusal contract: matrix, error-catalog codes,
 * /api/meta/refusal-contract manifest, refuse() helper.
 *
 * Contract: "отказ ≠ charged" — policy_refusal(409), insufficient_subject(422),
 * execution_failed(502) all carry charge:"never"; manifest is zod-self-validating.
 */

import { describe, expect, it } from "vitest";
import { Hono } from "hono";
import { metaRoutes } from "../src/server/routes/meta";
import { ERROR_CATALOG } from "../src/server/lib/error-catalog";
import {
  REFUSAL_MATRIX,
  getRefusalContract,
  refusalContractSchema,
} from "../src/server/lib/refusal-contract";
import { refuse } from "../src/server/lib/error-response";

const app = new Hono();
app.route("/", metaRoutes);

describe("SLICE-181-1: refusal contract manifest", () => {
  it("GET /api/meta/refusal-contract → 200 with policy no-charge-on-refusal", async () => {
    const res = await app.request("/api/meta/refusal-contract");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.policy).toBe("no-charge-on-refusal");
    expect(body.version).toBe("1.0");
  });

  it("manifest lists the three refusal codes", async () => {
    const res = await app.request("/api/meta/refusal-contract");
    const body = await res.json();
    const codes = body.refusals.map((r: { code: string }) => r.code);
    expect(codes).toEqual(
      expect.arrayContaining([
        "policy_refusal",
        "insufficient_subject",
        "execution_failed",
      ]),
    );
    for (const r of body.refusals) {
      expect(r.charge).toBe("never");
    }
  });

  it("manifest self-validates against refusalContractSchema", () => {
    const parsed = refusalContractSchema.safeParse(getRefusalContract());
    expect(parsed.success).toBe(true);
  });
});

describe("SLICE-181-1: error catalog refusal codes (single source)", () => {
  it("/api/meta/errors contains refusal codes with charge:never", async () => {
    const res = await app.request("/api/meta/errors");
    expect(res.status).toBe(200);
    const body = await res.json();
    for (const code of ["policy_refusal", "insufficient_subject", "execution_failed"]) {
      const entry = body.errors.find((e: { code: string }) => e.code === code);
      expect(entry, `missing catalog entry for ${code}`).toBeDefined();
      expect(entry.charge).toBe("never");
    }
  });

  it("catalog refusal entries are derived from REFUSAL_MATRIX (no dual source)", () => {
    for (const m of REFUSAL_MATRIX) {
      const entry = ERROR_CATALOG.find((e) => e.code === m.code);
      expect(entry, `catalog entry for ${m.code} not found`).toBeDefined();
      expect(entry!.http_status).toBe(m.http);
      expect(entry!.charge).toBe(m.charge);
    }
  });

  it("charge:never refusal entries use non-payment recovery actions", () => {
    // "wait_and_retry" is the payment-flavored action (passport_payment_required);
    // a refusal must never suggest paying/retrying payment as recovery.
    for (const m of REFUSAL_MATRIX) {
      const entry = ERROR_CATALOG.find((e) => e.code === m.code)!;
      expect(entry.recovery_action).not.toBe("wait_and_retry");
    }
  });
});

describe("SLICE-181-1: refuse() helper", () => {
  function refuseApp(
    code: string,
    refund?: { status: "pending" | "sent" | "failed"; tx?: string },
  ) {
    const a = new Hono();
    a.get("/x", (c) =>
      refuse(c, code as never, "test refusal", refund ? { refund } : undefined),
    );
    return a;
  }

  it("refuse() returns matrix http status + charged:false", async () => {
    const res = await refuseApp("policy_refusal").request("/x");
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.code).toBe("policy_refusal");
    expect(body.charged).toBe(false);
    expect(body.error).toBe("test refusal");
  });

  it("refuse() carries optional refund block", async () => {
    const res = await refuseApp("execution_failed", {
      status: "pending",
      tx: "0xabc",
    }).request("/x");
    expect(res.status).toBe(502);
    const body = await res.json();
    expect(body.refund).toEqual({ status: "pending", tx: "0xabc" });
  });
});
