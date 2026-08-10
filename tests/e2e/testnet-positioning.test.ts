import { describe, it, expect } from "vitest";

const BASE = "http://localhost:4021";

describe("Testnet positioning (SLICE-54-4)", () => {
  it("FAQ reframes testnet as advantage with Join testnet CTA", async () => {
    const res = await fetch(`${BASE}/faq`);
    const html = await res.text();
    expect(html).toMatch(/join testnet/i);
    expect(html).toMatch(/free|safe|early access|no cost|zero cost/i);
  });

  it("about page reframes testnet as advantage", async () => {
    const res = await fetch(`${BASE}/about`);
    const html = await res.text();
    expect(html).toMatch(/join testnet|try.*testnet|testnet.*free|testnet.*advantage/i);
  });
});
