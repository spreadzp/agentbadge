/**
 * E2E Test: UI renders correctly in Base chain mode.
 *
 * SLICE-90-24: Verifies that all UI pages render without errors,
 * display Base-appropriate content, and do NOT contain Hedera-specific strings.
 *
 * Run: bunx vitest run --run tests/e2e/ui-chain-base.e2e.test.ts
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import {
  setupBaseEnv,
  createUiTestApp,
  BASE_EXPECTED_STRINGS,
  HEDERA_ONLY_STRINGS,
} from "./ui-chain-helpers";

const E2E_TIMEOUT = 30000;

describe("SLICE-90-24: UI E2E — Base mode", () => {
  let fetchPage: (path: string) => Promise<{ status: number; text: string }>;

  beforeAll(() => {
    setupBaseEnv();
    const ctx = createUiTestApp();
    fetchPage = ctx.fetchPage;
  }, E2E_TIMEOUT);

  afterAll(() => {
    // Clean up env
    delete process.env.CHAIN_MODE;
    delete process.env.BASE_RPC_URL;
    delete process.env.BASE_OPERATOR_KEY;
    delete process.env.BASE_PASSPORT_NFT;
    delete process.env.BASE_TASK_ESCROW;
    delete process.env.BASE_USDC_ADDRESS;
  });

  // ── Dashboard ────────────────────────────────────────────────────────

  describe("Dashboard (/dashboard)", () => {
    it("renders without errors (200)", async () => {
      const { status } = await fetchPage("/dashboard");
      expect(status).toBe(200);
    }, E2E_TIMEOUT);

    it("contains Base Sepolia chain display name", async () => {
      const { text } = await fetchPage("/dashboard");
      expect(text).toContain("Base Sepolia");
    }, E2E_TIMEOUT);

    it("contains USDC currency symbol", async () => {
      const { text } = await fetchPage("/dashboard");
      expect(text).toContain("USDC");
    }, E2E_TIMEOUT);

    it("does not contain Hedera-specific strings", async () => {
      const { text } = await fetchPage("/dashboard");
      for (const s of HEDERA_ONLY_STRINGS) {
        expect(text).not.toContain(s);
      }
    }, E2E_TIMEOUT);
  });

  // ── Passport form ────────────────────────────────────────────────────

  describe("Passport form (/ui/passport/request)", () => {
    it("renders without errors (200)", async () => {
      const { status } = await fetchPage("/ui/passport/request");
      expect(status).toBe(200);
    }, E2E_TIMEOUT);

    it("contains 'Wallet Address' label", async () => {
      const { text } = await fetchPage("/ui/passport/request");
      expect(text).toContain("Wallet Address");
    }, E2E_TIMEOUT);

    it("contains '0x...' placeholder", async () => {
      const { text } = await fetchPage("/ui/passport/request");
      expect(text).toContain("0x...");
    }, E2E_TIMEOUT);

    it("does not contain 'Hedera Account ID' or '0.0.xxxx'", async () => {
      const { text } = await fetchPage("/ui/passport/request");
      expect(text).not.toContain("Hedera Account ID");
      expect(text).not.toContain("0.0.xxxx");
    }, E2E_TIMEOUT);
  });

  // ── FAQ page ─────────────────────────────────────────────────────────

  describe("FAQ page (/faq)", () => {
    it("renders without errors (200)", async () => {
      const { status } = await fetchPage("/faq");
      expect(status).toBe(200);
    }, E2E_TIMEOUT);

    it("contains Base-appropriate terms (USDC or Basescan)", async () => {
      const { text } = await fetchPage("/faq");
      const hasBaseTerms = text.includes("USDC") || text.includes("Basescan");
      expect(hasBaseTerms).toBe(true);
    }, E2E_TIMEOUT);

    it("does not contain Hedera-specific strings", async () => {
      const { text } = await fetchPage("/faq");
      for (const s of HEDERA_ONLY_STRINGS) {
        expect(text).not.toContain(s);
      }
    }, E2E_TIMEOUT);
  });

  // ── Help page ────────────────────────────────────────────────────────

  describe("Help page (/ui/help)", () => {
    it("renders without errors (200)", async () => {
      const { status } = await fetchPage("/ui/help");
      expect(status).toBe(200);
    }, E2E_TIMEOUT);

    it("contains Base Sepolia chain display name", async () => {
      const { text } = await fetchPage("/ui/help");
      expect(text).toContain("Base Sepolia");
    }, E2E_TIMEOUT);

    it("does not contain Hedera-specific strings", async () => {
      const { text } = await fetchPage("/ui/help");
      for (const s of HEDERA_ONLY_STRINGS) {
        expect(text).not.toContain(s);
      }
    }, E2E_TIMEOUT);
  });

  // ── Use-cases page ───────────────────────────────────────────────────

  describe("Use-cases page (/use-cases)", () => {
    it("renders without errors (200)", async () => {
      const { status } = await fetchPage("/use-cases");
      expect(status).toBe(200);
    }, E2E_TIMEOUT);

    it("does not contain Hedera-specific strings", async () => {
      const { text } = await fetchPage("/use-cases");
      for (const s of HEDERA_ONLY_STRINGS) {
        expect(text).not.toContain(s);
      }
    }, E2E_TIMEOUT);
  });

  // ── Header chain badge ───────────────────────────────────────────────

  describe("Header chain badge", () => {
    it("dashboard contains chain-badge with 'Base Sepolia'", async () => {
      const { text } = await fetchPage("/dashboard");
      expect(text).toContain("chain-badge");
      expect(text).toContain("Base Sepolia");
    }, E2E_TIMEOUT);

    it("badge uses blue color for Base", async () => {
      const { text } = await fetchPage("/dashboard");
      expect(text).toContain("blue");
    }, E2E_TIMEOUT);

    it("badge does not contain 'Hedera Testnet'", async () => {
      const { text } = await fetchPage("/dashboard");
      expect(text).not.toContain("Hedera Testnet");
    }, E2E_TIMEOUT);
  });

  // ── Cross-page: all expected Base strings ────────────────────────────

  describe("All pages contain expected Base strings", () => {
    const pages = [
      { name: "Dashboard", path: "/dashboard" },
      { name: "Help", path: "/ui/help" },
    ];

    for (const page of pages) {
      it(`${page.name} contains all expected Base strings`, async () => {
        const { text } = await fetchPage(page.path);
        for (const s of BASE_EXPECTED_STRINGS) {
          expect(text).toContain(s);
        }
      }, E2E_TIMEOUT);
    }
  });
});
