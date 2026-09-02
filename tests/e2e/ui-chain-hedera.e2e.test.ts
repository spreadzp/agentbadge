/**
 * E2E Test: UI renders correctly in Hedera chain mode.
 *
 * SLICE-90-24: Verifies that all UI pages render without errors,
 * display Hedera-appropriate content, and do NOT contain Base-specific strings.
 *
 * Run: bunx vitest run --run tests/e2e/ui-chain-hedera.e2e.test.ts
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import {
  setupHederaEnv,
  createUiTestApp,
  HEDERA_EXPECTED_STRINGS,
  BASE_ONLY_STRINGS,
} from "./ui-chain-helpers";

const E2E_TIMEOUT = 30000;

describe("SLICE-90-24: UI E2E — Hedera mode", () => {
  let fetchPage: (path: string) => Promise<{ status: number; text: string }>;

  beforeAll(() => {
    setupHederaEnv();
    const ctx = createUiTestApp();
    fetchPage = ctx.fetchPage;
  }, E2E_TIMEOUT);

  afterAll(() => {
    // Clean up env
    delete process.env.CHAIN_MODE;
  });

  // ── Dashboard ────────────────────────────────────────────────────────

  describe("Dashboard (/dashboard)", () => {
    it("renders without errors (200)", async () => {
      const { status } = await fetchPage("/dashboard");
      expect(status).toBe(200);
    }, E2E_TIMEOUT);

    it("contains Hedera chain display name", async () => {
      const { text } = await fetchPage("/dashboard");
      expect(text).toContain("Hedera Testnet");
    }, E2E_TIMEOUT);

    it("contains HBAR currency symbol", async () => {
      const { text } = await fetchPage("/dashboard");
      expect(text).toContain("HBAR");
    }, E2E_TIMEOUT);

    it("does not contain Base-specific strings", async () => {
      const { text } = await fetchPage("/dashboard");
      for (const s of BASE_ONLY_STRINGS) {
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

    it("contains 'Hedera Account ID' label", async () => {
      const { text } = await fetchPage("/ui/passport/request");
      expect(text).toContain("Hedera Account ID");
    }, E2E_TIMEOUT);

    it("contains '0.0.xxxx' placeholder", async () => {
      const { text } = await fetchPage("/ui/passport/request");
      expect(text).toContain("0.0.xxxx");
    }, E2E_TIMEOUT);

    it("does not contain 'Wallet Address' or '0x...' placeholder", async () => {
      const { text } = await fetchPage("/ui/passport/request");
      expect(text).not.toContain("Wallet Address");
      expect(text).not.toContain("0x...");
    }, E2E_TIMEOUT);
  });

  // ── FAQ page ─────────────────────────────────────────────────────────

  describe("FAQ page (/faq)", () => {
    it("renders without errors (200)", async () => {
      const { status } = await fetchPage("/faq");
      expect(status).toBe(200);
    }, E2E_TIMEOUT);

    it("contains Hedera-appropriate terms (HBAR or HashScan)", async () => {
      const { text } = await fetchPage("/faq");
      const hasHederaTerms = text.includes("HBAR") || text.includes("HashScan");
      expect(hasHederaTerms).toBe(true);
    }, E2E_TIMEOUT);

    it("does not contain Base-specific strings", async () => {
      const { text } = await fetchPage("/faq");
      for (const s of BASE_ONLY_STRINGS) {
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

    it("contains Hedera chain display name", async () => {
      const { text } = await fetchPage("/ui/help");
      expect(text).toContain("Hedera Testnet");
    }, E2E_TIMEOUT);

    it("does not contain Base-specific strings", async () => {
      const { text } = await fetchPage("/ui/help");
      for (const s of BASE_ONLY_STRINGS) {
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

    it("does not contain Base-specific strings", async () => {
      const { text } = await fetchPage("/use-cases");
      for (const s of BASE_ONLY_STRINGS) {
        expect(text).not.toContain(s);
      }
    }, E2E_TIMEOUT);
  });

  // ── Header chain badge ───────────────────────────────────────────────

  describe("Header chain badge", () => {
    it("dashboard contains chain-badge with 'Hedera Testnet'", async () => {
      const { text } = await fetchPage("/dashboard");
      expect(text).toContain("chain-badge");
      expect(text).toContain("Hedera Testnet");
    }, E2E_TIMEOUT);

    it("badge uses purple color for Hedera", async () => {
      const { text } = await fetchPage("/dashboard");
      expect(text).toContain("purple");
    }, E2E_TIMEOUT);

    it("badge does not contain 'Base Sepolia'", async () => {
      const { text } = await fetchPage("/dashboard");
      expect(text).not.toContain("Base Sepolia");
    }, E2E_TIMEOUT);
  });

  // ── Cross-page: all expected Hedera strings ──────────────────────────

  describe("All pages contain expected Hedera strings", () => {
    const pages = [
      { name: "Dashboard", path: "/dashboard" },
      { name: "Help", path: "/ui/help" },
    ];

    for (const page of pages) {
      it(`${page.name} contains all expected Hedera strings`, async () => {
        const { text } = await fetchPage(page.path);
        for (const s of HEDERA_EXPECTED_STRINGS) {
          expect(text).toContain(s);
        }
      }, E2E_TIMEOUT);
    }
  });
});
