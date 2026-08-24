import { describe, it, expect } from "vitest";
import { makeTestApp, setupMockEnv } from "./e2e/helpers";
import { GuideLayout } from "../src/views/guide-layout";

setupMockEnv();
const app = makeTestApp();

describe("SLICE-73-3: <dl> definition lists in guide pages", () => {
  describe("GuideLayout renders <dl> when definitions provided", () => {
    it("renders <dl> element with aria-label='Key Terms'", () => {
      const html = GuideLayout(
        "Test Guide",
        "# Test",
        [],
        "/test-guide",
        "2026-01-01",
        [
          { term: "Agent", definition: "An autonomous software entity" },
          { term: "MCP", definition: "Model Context Protocol" },
          { term: "Passport", definition: "On-chain identity NFT" },
        ],
      ).toString();
      expect(html).toContain("<dl");
      expect(html).toContain('aria-label="Key Terms"');
    });

    it("renders <dt> and <dd> pairs for each definition", () => {
      const html = GuideLayout(
        "Test Guide",
        "# Test",
        [],
        "/test-guide",
        "2026-01-01",
        [
          { term: "Agent", definition: "An autonomous software entity" },
          { term: "MCP", definition: "Model Context Protocol" },
          { term: "Passport", definition: "On-chain identity NFT" },
        ],
      ).toString();
      expect(html).toContain(">Agent</dt>");
      expect(html).toContain(">An autonomous software entity</dd>");
      expect(html).toContain(">MCP</dt>");
      expect(html).toContain(">Model Context Protocol</dd>");
      expect(html).toContain(">Passport</dt>");
      expect(html).toContain(">On-chain identity NFT</dd>");
    });

    it("renders at least 5 <dt>/<dd> pairs when 5 definitions provided", () => {
      const defs = [
        { term: "A", definition: "Def A" },
        { term: "B", definition: "Def B" },
        { term: "C", definition: "Def C" },
        { term: "D", definition: "Def D" },
        { term: "E", definition: "Def E" },
      ];
      const html = GuideLayout("Test", "# Test", [], "/test", "2026-01-01", defs).toString();
      const dtCount = (html.match(/<dt[\s>]/g) || []).length;
      const ddCount = (html.match(/<dd[\s>]/g) || []).length;
      expect(dtCount).toBeGreaterThanOrEqual(5);
      expect(ddCount).toBeGreaterThanOrEqual(5);
    });

    it("does not render <dl> when no definitions provided", () => {
      const html = GuideLayout("Test", "# Test", [], "/test", "2026-01-01").toString();
      expect(html).not.toContain("<dl");
    });

    it("includes DefinedTerm JSON-LD schema alongside <dl>", () => {
      const html = GuideLayout(
        "Test Guide",
        "# Test",
        [],
        "/test-guide",
        "2026-01-01",
        [{ term: "Agent", definition: "An autonomous software entity" }],
      ).toString();
      expect(html).toContain("DefinedTerm");
    });

    it("<dl> is visually styled (slate background)", () => {
      const html = GuideLayout(
        "Test",
        "# Test",
        [],
        "/test",
        "2026-01-01",
        [{ term: "X", definition: "Y" }],
      ).toString();
      expect(html).toContain("slate");
    });

    it("<pre> content still renders correctly (no regression)", () => {
      const html = GuideLayout(
        "Test",
        "# Hello World",
        [],
        "/test",
        "2026-01-01",
        [{ term: "X", definition: "Y" }],
      ).toString();
      expect(html).toContain("<pre");
      expect(html).toContain("Hello World");
    });
  });

  describe("Guide pages serve <dl> in HTML", () => {
    it("/agent-guide returns <dl> with at least 5 <dt>/<dd> pairs", async () => {
      const res = await app.request("/agent-guide", { headers: { Accept: "text/html" } });
      const html = await res.text();
      expect(html).toContain("<dl");
      expect(html).toContain('aria-label="Key Terms"');
      const dtCount = (html.match(/<dt[\s>]/g) || []).length;
      expect(dtCount).toBeGreaterThanOrEqual(5);
    });

    it("/market-guide returns <dl> with at least 3 <dt>/<dd> pairs", async () => {
      const res = await app.request("/market-guide", { headers: { Accept: "text/html" } });
      const html = await res.text();
      expect(html).toContain("<dl");
      const dtCount = (html.match(/<dt[\s>]/g) || []).length;
      expect(dtCount).toBeGreaterThanOrEqual(3);
    });

    it("/medical-guide returns <dl> with at least 3 <dt>/<dd> pairs", async () => {
      const res = await app.request("/medical-guide", { headers: { Accept: "text/html" } });
      const html = await res.text();
      expect(html).toContain("<dl");
      const dtCount = (html.match(/<dt[\s>]/g) || []).length;
      expect(dtCount).toBeGreaterThanOrEqual(3);
    });
  });
});
