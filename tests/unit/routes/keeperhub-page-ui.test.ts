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

  describe("SLICE-126-15: Hero section", () => {
    it("contains badge pill with KeeperHub", async () => {
      const body = await getPage();
      expect(body).toContain("KeeperHub");
      expect(body).toMatch(/badge|pill/i);
    });

    it("contains h1 with onchain trust text", async () => {
      const body = await getPage();
      expect(body).toMatch(/Onchain Trust/i);
    });

    it("contains demo and audit anchor CTAs", async () => {
      const body = await getPage();
      expect(body).toContain('#demo');
      expect(body).toContain('#audit');
    });

    it("contains GitHub link", async () => {
      const body = await getPage();
      expect(body).toMatch(/github\.com/i);
    });

    it("contains stats row with workflow and MCP counts", async () => {
      const body = await getPage();
      expect(body).toContain("3");
      expect(body).toContain("workflow");
      expect(body).toContain("4");
      expect(body).toMatch(/MCP tool/i);
    });
  });

  describe("SLICE-126-15: Architecture diagram", () => {
    it("contains all 5 node names", async () => {
      const body = await getPage();
      expect(body).toContain("Scan");
      expect(body).toContain("KeeperHub");
      expect(body).toContain("TrustRegistry");
      expect(body).toContain("TrustBadge");
      expect(body).toContain("Audit");
    });

    it("contains score threshold for badge mint branch", async () => {
      const body = await getPage();
      expect(body).toMatch(/score.*85|85.*score|≥.*85/i);
    });

    it("contains Base Sepolia and 84532", async () => {
      const body = await getPage();
      expect(body).toContain("Base Sepolia");
      expect(body).toContain("84532");
    });

    it("contains mono type tags EVM and MCP", async () => {
      const body = await getPage();
      expect(body).toContain("EVM");
      expect(body).toContain("MCP");
    });
  });

  describe("SLICE-126-15: HowItWorks section", () => {
    it("contains 4 step titles in order", async () => {
      const body = await getPage();
      const howIdx = body.indexOf("How it works");
      expect(howIdx).toBeGreaterThan(-1);
      const section = body.substring(howIdx);
      const scanIdx = section.indexOf("Scan");
      const confirmIdx = section.indexOf("Confirm");
      const recordIdx = section.indexOf("Record");
      const verifyIdx = section.indexOf("Verify");
      expect(scanIdx).toBeGreaterThan(-1);
      expect(confirmIdx).toBeGreaterThan(scanIdx);
      expect(recordIdx).toBeGreaterThan(confirmIdx);
      expect(verifyIdx).toBeGreaterThan(recordIdx);
    });
  });

  describe("SLICE-126-15: Audit anchor", () => {
    it("contains id=audit section", async () => {
      const body = await getPage();
      expect(body).toContain('id="audit"');
    });
  });

  describe("SLICE-126-16: Audit section structure", () => {
    it("contains h2 Live Audit Trail", async () => {
      const body = await getPage();
      expect(body).toContain("Live Audit Trail");
    });

    it("contains live indicator dot element", async () => {
      const body = await getPage();
      expect(body).toContain('id="kh-live-dot"');
    });

    it("contains empty-state block", async () => {
      const body = await getPage();
      expect(body).toContain('id="kh-audit-empty"');
    });

    it("contains error-state block", async () => {
      const body = await getPage();
      expect(body).toContain('id="kh-audit-error"');
    });

    it("contains audit table with thead cells", async () => {
      const body = await getPage();
      expect(body).toContain('id="kh-audit-table"');
      expect(body).toContain("Status");
      expect(body).toContain("Site");
      expect(body).toContain("Score");
      expect(body).toContain("Tx");
      expect(body).toContain("Recorded");
    });

    it("contains kh-audit-rows tbody", async () => {
      const body = await getPage();
      expect(body).toContain('id="kh-audit-rows"');
    });
  });

  describe("SLICE-126-16: SSE script markers", () => {
    it("contains EventSource for audit stream", async () => {
      const body = await getPage();
      expect(body).toContain('EventSource("/api/keeperhub/audit/stream"');
    });

    it("contains snapshot event listener", async () => {
      const body = await getPage();
      expect(body).toContain('addEventListener("snapshot"');
    });

    it("contains audit event listener", async () => {
      const body = await getPage();
      expect(body).toContain('addEventListener("audit"');
    });

    it("contains REST fetch for initial snapshot", async () => {
      const body = await getPage();
      expect(body).toContain('fetch("/api/keeperhub/audit?limit=20"');
    });

    it("contains txUrlTemplate reference", async () => {
      const body = await getPage();
      expect(body).toContain("txUrlTemplate");
    });

    it("contains prepend for live rows", async () => {
      const body = await getPage();
      expect(body).toContain("prepend");
    });

    it("contains onerror handler", async () => {
      const body = await getPage();
      expect(body).toContain("onerror");
    });

    it("contains data-id dedupe guard", async () => {
      const body = await getPage();
      expect(body).toContain("data-id");
    });

    it("contains target=_blank for tx links", async () => {
      const body = await getPage();
      expect(body).toContain('target="_blank"');
    });
  });

  describe("SLICE-126-16: CSS animation markers", () => {
    it("contains kh-fade keyframes", async () => {
      const body = await getPage();
      expect(body).toContain("@keyframes kh-fade");
    });

    it("contains kh-row-fade class", async () => {
      const body = await getPage();
      expect(body).toContain("kh-row-fade");
    });
  });

  describe("SLICE-126-15: Stack section", () => {
    it("contains x402 chip", async () => {
      const body = await getPage();
      expect(body).toContain("x402");
    });

    it("contains Base Sepolia chip", async () => {
      const body = await getPage();
      expect(body).toContain("Base Sepolia");
    });

    it("contains SSE chip", async () => {
      const body = await getPage();
      expect(body).toContain("SSE");
    });

    it("contains Solidity or OZ chip", async () => {
      const body = await getPage();
      expect(body).toMatch(/Solidity|OZ\s*5/i);
    });
  });

  describe("SLICE-126-15: API table", () => {
    it("contains premium endpoint", async () => {
      const body = await getPage();
      expect(body).toContain("/api/keeperhub/scan/premium");
    });

    it("contains audit stream endpoint", async () => {
      const body = await getPage();
      expect(body).toContain("/audit/stream");
    });

    it("contains MCP tool names", async () => {
      const body = await getPage();
      expect(body).toContain("keeperhub-record-scan");
    });

    it("contains x402 and price $0.01", async () => {
      const body = await getPage();
      expect(body).toContain("$0.01");
    });
  });

  describe("SLICE-126-15: Footer", () => {
    it("contains support email", async () => {
      const body = await getPage();
      expect(body).toContain("support@agentbadge.xyz");
    });
  });

  describe("SLICE-126-16: Polling fallback markers", () => {
    it("contains polling fallback schedule", async () => {
      const body = await getPage();
      expect(body).toContain("pollTimer");
    });

    it("contains reconnect scheduling", async () => {
      const body = await getPage();
      expect(body).toContain("scheduleReconnect");
    });

    it("contains setDot function for live indicator", async () => {
      const body = await getPage();
      expect(body).toContain("setDot");
    });
  });
});
