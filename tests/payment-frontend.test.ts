/**
 * SLICE-67-7: Tests for frontend pay button integration on pricing page.
 */

import { describe, it, expect } from "vitest";
import { PricingPage } from "../src/views/pricing-page";

describe("PricingPage — Stripe pay buttons", () => {
  it("renders 'Pay with Card' button for each tier", () => {
    const html = PricingPage().toString();

    // Should have 4 "Pay with Card" buttons (one per tier)
    const matches = html.match(/Pay with Card/g);
    expect(matches).toBeTruthy();
    expect(matches!.length).toBe(4);
  });

  it("includes 'Powered by Stripe' text", () => {
    const html = PricingPage().toString();

    expect(html).toContain("Powered by Stripe");
  });

  it("includes USD price alongside HBAR price", () => {
    const html = PricingPage().toString();

    // Should contain USD symbol
    expect(html).toContain("$");
    // Should still contain HBAR
    expect(html).toContain("HBAR");
  });

  it("includes data-product-id attributes for Stripe checkout", () => {
    const html = PricingPage().toString();

    expect(html).toContain("data-product-id=\"passport-bronze\"");
    expect(html).toContain("data-product-id=\"passport-silver\"");
    expect(html).toContain("data-product-id=\"passport-gold\"");
    expect(html).toContain("data-product-id=\"passport-platinum\"");
  });

  it("loads the payment.js script", () => {
    const html = PricingPage().toString();

    expect(html).toContain("/js/payment.js");
  });

  it("retains existing HBAR mint links", () => {
    const html = PricingPage().toString();

    // Existing HBAR mint links should still be present
    expect(html).toContain("/ui/passport/request?tier=bronze");
    expect(html).toContain("/ui/passport/request?tier=silver");
    expect(html).toContain("/ui/passport/request?tier=gold");
    expect(html).toContain("/ui/passport/request?tier=platinum");
  });
});
