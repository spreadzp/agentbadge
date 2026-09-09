import { describe, it, expect, vi } from "vitest";

vi.mock("../../../src/config/env.js", () => ({
  getConfig: vi.fn(() => ({
    chainMode: "hedera",
    hederaNetwork: "testnet",
    ui: {
      currencySymbol: "ℏ",
      chainName: "Hedera Testnet",
      nftStandard: "HIP-412",
      consensus: "HCS",
      explorerTxUrl: "https://hashscan.io/testnet/transaction/",
      explorerAccountUrl: "https://hashscan.io/testnet/account/",
    },
  })),
  loadConfig: vi.fn(() => ({})),
  resetConfigCache: vi.fn(),
}));

import { Hono } from "hono";
import { hackathonRoutes } from "../../../src/server/routes/hackathon";

const app = new Hono();
app.route("/", hackathonRoutes);

async function getPage(): Promise<string> {
  const res = await app.request("/hackathon/keeperhub");
  expect(res.status).toBe(200);
  return await res.text();
}

describe("SLICE-126-14: KeeperHub demo form UI", () => {
  describe("Form structure", () => {
    it("contains form with id kh-demo-form", async () => {
      const body = await getPage();
      expect(body).toContain('id="kh-demo-form"');
    });

    it("has URL input with type=url and required", async () => {
      const body = await getPage();
      expect(body).toContain('id="kh-url"');
      expect(body).toContain('type="url"');
      expect(body).toContain('required');
    });

    it("has submit button with id kh-run", async () => {
      const body = await getPage();
      expect(body).toContain('id="kh-run"');
    });

    it("has confirm button with id kh-confirm (initially hidden)", async () => {
      const body = await getPage();
      expect(body).toContain('id="kh-confirm"');
      expect(body).toContain('hidden');
    });
  });

  describe("State blocks", () => {
    it("contains all state blocks initially hidden", async () => {
      const body = await getPage();
      expect(body).toContain('id="kh-status"');
      expect(body).toContain('id="kh-result"');
      expect(body).toContain('id="kh-executed"');
      expect(body).toContain('id="kh-error"');
    });
  });

  describe("Inline script", () => {
    it("contains fetch to /api/keeperhub/scan", async () => {
      const body = await getPage();
      expect(body).toContain('fetch("/api/keeperhub/scan"');
    });

    it("contains confirm: true literal", async () => {
      const body = await getPage();
      expect(body).toContain("confirm: true");
    });

    it("contains mode === executed branch", async () => {
      const body = await getPage();
      expect(body).toContain('mode === "executed"');
    });

    it("contains mode === failed branch", async () => {
      const body = await getPage();
      expect(body).toContain('mode === "failed"');
    });

    it("contains Basescan tx link construction with target _blank", async () => {
      const body = await getPage();
      expect(body).toContain('target="_blank"');
      expect(body).toContain("/tx/");
    });
  });

  describe("Premium teaser", () => {
    it("mentions /api/keeperhub/scan/premium", async () => {
      const body = await getPage();
      expect(body).toContain("/api/keeperhub/scan/premium");
    });
  });

  describe("Regression checks", () => {
    it("does NOT contain WebMCP script injection", async () => {
      const body = await getPage();
      expect(body).not.toContain("document.modelContext");
      expect(body).not.toContain("registerTool");
    });

    it("placeholder 'coming soon' list REMOVED", async () => {
      const body = await getPage();
      expect(body).not.toContain("Coming in this integration");
    });
  });
});
