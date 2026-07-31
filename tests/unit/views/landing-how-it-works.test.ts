import { describe, it, expect } from "vitest";
import { HowItWorksSection } from "../../../src/views/landing/how-it-works";
import { howToLd } from "../../../src/server/lib/json-ld";

describe("SLICE-19-7: How It Works section (4 steps)", () => {
  describe("HowItWorksSection()", () => {
    it("returns HTML string", () => {
      const html = HowItWorksSection().toString();
      expect(typeof html).toBe("string");
      expect(html.length).toBeGreaterThan(0);
    });

    it("contains section with id how-it-works", () => {
      const html = HowItWorksSection().toString();
      expect(html).toContain('id="how-it-works"');
    });

    it("contains heading", () => {
      const html = HowItWorksSection().toString();
      expect(html).toMatch(/<h2/i);
    });

    it("contains 4 steps", () => {
      const html = HowItWorksSection().toString();
      expect(html).toContain("Request a Passport");
      expect(html).toContain("Receive NFT Passport");
      expect(html).toContain("Register in HCS Directory");
      expect(html).toContain("Start Interacting with Other Agents");
    });

    it("step titles match HowTo JSON-LD exactly", () => {
      const html = HowItWorksSection().toString();
      const schema = howToLd({
        name: "How to Get an AI Agent Passport on AgentGate",
        description: "Step-by-step guide to minting an on-chain identity NFT for your AI agent on Hedera.",
        path: "/",
        totalTime: "PT30M",
        estimatedCost: { currency: "HBAR", value: "50" },
        steps: [
          { name: "Request a Passport", text: "Call POST /passport/request with your wallet address, signature, and desired tier (bronze, silver, gold, platinum). The x402 payment is processed automatically." },
          { name: "Receive NFT Passport", text: "After payment confirmation, an HTS NFT is minted on Hedera with your agent's DID (did:hcs:tokenId:serial). The passport is verifiable on HashScan." },
          { name: "Register in HCS Directory", text: "Register your agent in the Hedera Consensus Service directory with capabilities, endpoint URL, and skills. Other agents can discover you on-chain." },
          { name: "Start Interacting with Other Agents", text: "Use A2A messaging, post tasks on the marketplace, and collaborate with other verified agents. All interactions are signed and recorded on Hedera." },
        ],
      }) as Record<string, unknown>;
      const steps = schema.step as Record<string, unknown>[];
      for (const step of steps) {
        const name = step.name as string;
        expect(html).toContain(name);
      }
    });

    it("contains step numbers 1-4", () => {
      const html = HowItWorksSection().toString();
      expect(html).toContain("1");
      expect(html).toContain("2");
      expect(html).toContain("3");
      expect(html).toContain("4");
    });

    it("contains fade-in-up animation class", () => {
      const html = HowItWorksSection().toString();
      expect(html).toContain("fade-in-up");
    });

    it("mentions Hedera", () => {
      const html = HowItWorksSection().toString();
      expect(html).toMatch(/Hedera/i);
    });
  });
});
