import { describe, it, expect } from "vitest";
import { wellKnownRoutes } from "../../../src/server/routes/well-known";

const app = wellKnownRoutes;

describe("SLICE-124-2: /verification.md", () => {
  it("serves /verification.md as markdown", async () => {
    const res = await app.request("/verification.md", {
      headers: { Accept: "text/markdown, text/plain, */*" },
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toContain("text/markdown");
  });

  it("contains passport verification section", async () => {
    const res = await app.request("/verification.md");
    const text = await res.text();
    expect(text).toContain("Passport Verification");
    expect(text).toContain("NFT");
  });

  it("contains DID authentication section", async () => {
    const res = await app.request("/verification.md");
    const text = await res.text();
    expect(text).toContain("DID Authentication");
    expect(text).toContain("challenge");
  });

  it("contains marketplace escrow section", async () => {
    const res = await app.request("/verification.md");
    const text = await res.text();
    expect(text).toContain("Marketplace Escrow");
    expect(text).toContain("frozen");
  });

  it("contains audit trail section", async () => {
    const res = await app.request("/verification.md");
    const text = await res.text();
    expect(text).toContain("Audit Trail");
    expect(text).toContain("HCS");
  });

  it("contains dispute resolution policy", async () => {
    const res = await app.request("/verification.md");
    const text = await res.text();
    expect(text).toContain("Dispute Resolution");
    expect(text).toContain("14 days");
  });

  it("contains task class availability table", async () => {
    const res = await app.request("/verification.md");
    const text = await res.text();
    expect(text).toContain("Task Class Availability");
    expect(text).toContain("Bronze");
    expect(text).toContain("Platinum");
  });

  it("references reputation.md", async () => {
    const res = await app.request("/verification.md");
    const text = await res.text();
    expect(text).toContain("reputation.md");
  });
});

describe("SLICE-124-3: /reputation.md", () => {
  it("serves /reputation.md as markdown", async () => {
    const res = await app.request("/reputation.md", {
      headers: { Accept: "text/markdown, text/plain, */*" },
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toContain("text/markdown");
  });

  it("contains signal sources section", async () => {
    const res = await app.request("/reputation.md");
    const text = await res.text();
    expect(text).toContain("Signal Sources");
    expect(text).toContain("audit trail");
  });

  it("contains on-chain audit trail section", async () => {
    const res = await app.request("/reputation.md");
    const text = await res.text();
    expect(text).toContain("On-Chain Audit Trail");
    expect(text).toContain("HCS");
  });

  it("contains marketplace history section", async () => {
    const res = await app.request("/reputation.md");
    const text = await res.text();
    expect(text).toContain("Marketplace History");
    expect(text).toContain("completion");
  });

  it("contains passport tiers → trust levels mapping", async () => {
    const res = await app.request("/reputation.md");
    const text = await res.text();
    expect(text).toContain("Passport Tiers");
    expect(text).toContain("Bronze");
    expect(text).toContain("Platinum");
  });

  it("contains Sybil resistance section", async () => {
    const res = await app.request("/reputation.md");
    const text = await res.text();
    expect(text).toContain("Sybil Resistance");
  });

  it("contains anti-farming measures", async () => {
    const res = await app.request("/reputation.md");
    const text = await res.text();
    expect(text).toContain("Anti-Farming");
    expect(text).toContain("14-day");
  });

  it("references verification.md", async () => {
    const res = await app.request("/reputation.md");
    const text = await res.text();
    expect(text).toContain("verification.md");
  });
});
