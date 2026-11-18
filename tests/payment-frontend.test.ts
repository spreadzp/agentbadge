/**
 * SLICE-67-7: Tests for frontend pay button integration on pricing page.
 */

import { describe, it, expect } from "vitest";
import { PricingPage } from "../src/views/pages/pricing-page";

describe("PricingPage — Stripe pay buttons", () => {
  it("renders a /checkout form for each tier", () => {
    const html = PricingPage().toString();

    // One unified checkout form per tier — method select (Card/USDC) +
    // network select + Checkout submit posting to /checkout.
    const forms = html.match(/data-checkout-form/g);
    expect(forms).toBeTruthy();
    expect(forms!.length).toBe(4);
    const submits = html.match(/>\s*Checkout\s*</g);
    expect(submits!.length).toBe(4);
  });

  it("mentions the Stripe card rail", () => {
    const html = PricingPage().toString();

    expect(html).toContain("Card via Stripe");
  });

  it("includes USD price alongside HBAR price", () => {
    const html = PricingPage().toString();

    // Should contain USD symbol
    expect(html).toContain("$");
    // Should still contain HBAR
    expect(html).toContain("HBAR");
  });

  it("includes product hidden inputs for checkout", () => {
    const html = PricingPage().toString();

    expect(html).toContain('name="product" value="passport-bronze"');
    expect(html).toContain('name="product" value="passport-silver"');
    expect(html).toContain('name="product" value="passport-gold"');
    expect(html).toContain('name="product" value="passport-platinum"');
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
