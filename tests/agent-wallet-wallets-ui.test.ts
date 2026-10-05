// SLICE-176-10: /wallets owner console — render-level assertions.
// The page is a server-rendered string (hono/html) + inline JS, so the
// contract under test is textual: the JS must fetch the approvals API
// with wallet-sig, wire approve/reject + suspend/resume to the right
// endpoints, expose the new cap fields, and render the SUSPENDED badge.
import { describe, it, expect } from "vitest";
import { walletsPage } from "../src/views/wallets-page";

const page = () => walletsPage("0xa4b1", "arc-testnet");

describe("wallets page — pending approvals section", () => {
  it("fetches the approvals API with wallet-sig", () => {
    const html = page();
    expect(html).toContain('"/approvals"');
    expect(html).toContain("loadApprovals");
    // signed read — same venueSign convention as audit fetch
    expect(html).toContain('venueSign(addr, "GET", "/api/wallets/"');
  });

  it("renders approve/reject buttons wired to the decide endpoints", () => {
    const html = page();
    expect(html).toContain('"/approve"');
    expect(html).toContain('"/reject"');
    expect(html).toContain("decideApproval");
    // reject offers an optional reason
    expect(html).toContain("reason");
  });

  it("shows amount/kind/refId/expiresAt fields for each parked intent", () => {
    const html = page();
    for (const f of ["amountUsd", "kind", "refId", "expiresAt"]) {
      expect(html).toContain(f);
    }
  });

  it("auto-refreshes pending approvals on an interval", () => {
    expect(page()).toContain("setInterval");
  });
});

describe("wallets page — suspend/resume toggle", () => {
  it("renders SUSPENDED badge + toggle wired to killswitch endpoints", () => {
    const html = page();
    expect(html).toContain('"/suspend"');
    expect(html).toContain('"/resume"');
    expect(html).toContain("SUSPENDED");
    expect(html).toContain("toggleSuspend");
    expect(html).toContain("confirm(");
  });
});

describe("wallets page — owner caps form", () => {
  it("exposes the EPIC-176 cap fields as editable inputs", () => {
    const html = page();
    for (const k of ["approvalAboveUsd", "maxTxPerHour", "maxAmountPerHour"]) {
      expect(html).toContain(k);
    }
  });

  it("renders an allowedKinds checkbox for every SpendKind", () => {
    const html = page();
    expect(html).toContain("allowedKinds");
    for (const kind of ["venue-fee", "subscription", "eaas", "x402"]) {
      expect(html).toContain(`"${kind}"`);
    }
  });
});

describe("wallets page — deny history", () => {
  it("colours the EPIC-176 alert types in the audit feed", () => {
    const html = page();
    for (const t of [
      "spend.velocity_denied",
      "spend.kind_denied",
      "wallet.suspended_deny",
      "approval.requested",
      "approval.decided",
      "approval.consumed",
      "approval.expired",
    ]) {
      expect(html).toContain(t);
    }
  });
});
