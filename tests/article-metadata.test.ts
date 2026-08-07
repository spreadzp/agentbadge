import { describe, it, expect } from "vitest";
import { parseFrontmatter } from "../src/server/lib/frontmatter";
import { RelevantEngineeringCapability } from "../src/components/RelevantEngineeringCapability";
import { getRegistry } from "../src/server/registry/loader";
import { makeTestApp, setupMockEnv } from "./e2e/helpers";
import type { RegistryIndex } from "../src/server/registry/types";

setupMockEnv();
const app = makeTestApp();

describe("SLICE-46-5: Article metadata + RelevantEngineeringCapability", () => {
  describe("parseFrontmatter", () => {
    it("parses frontmatter with related_capabilities list", () => {
      const content = `---
related_capabilities:
  - mcp-development
  - ai-agent-architecture
related_services:
  - mcp-server-development
---
# Article body`;
      const { frontmatter, body } = parseFrontmatter(content);
      expect(frontmatter.related_capabilities).toEqual([
        "mcp-development",
        "ai-agent-architecture",
      ]);
      expect(frontmatter.related_services).toEqual(["mcp-server-development"]);
      expect(body).toContain("# Article body");
    });

    it("returns empty frontmatter when no --- block", () => {
      const content = "# Just a title\n\nBody text";
      const { frontmatter, body } = parseFrontmatter(content);
      expect(frontmatter).toEqual({});
      expect(body).toBe(content);
    });

    it("handles article with no related_capabilities", () => {
      const content = `---
title: Some Article
---
# Body`;
      const { frontmatter } = parseFrontmatter(content);
      expect(frontmatter.related_capabilities).toBeUndefined();
    });
  });

  describe("RelevantEngineeringCapability component", () => {
    let registry: RegistryIndex;

    it("loads registry successfully", async () => {
      registry = await getRegistry();
      expect(registry.capabilities.length).toBeGreaterThan(0);
    });

    it("renders CTA when related_capabilities present", () => {
      const html = RelevantEngineeringCapability(
        {
          related_capabilities: ["mcp-development", "ai-agent-architecture"],
          related_services: ["mcp-server-development"],
        },
        registry,
      );
      expect(html).toContain("Relevant Engineering Capabilities");
      expect(html).toContain("MCP Server Development");
      expect(html).toContain("AI Agent Architecture");
      expect(html).toContain("Confidence:");
      expect(html).toContain("/agent-guide/team/capabilities");
    });

    it("renders nothing when no related_capabilities", () => {
      const html = RelevantEngineeringCapability({}, registry);
      expect(html).toBe("");
    });

    it("renders nothing when related_capabilities is empty", () => {
      const html = RelevantEngineeringCapability(
        { related_capabilities: [] },
        registry,
      );
      expect(html).toBe("");
    });

    it("renders nothing when capability IDs not found in registry", () => {
      const html = RelevantEngineeringCapability(
        { related_capabilities: ["nonexistent-cap"] },
        registry,
      );
      expect(html).toBe("");
    });

    it("displays capability confidence score", () => {
      const html = RelevantEngineeringCapability(
        { related_capabilities: ["mcp-development"] },
        registry,
      );
      const cap = registry.capabilities.find((c) => c.id === "mcp-development");
      expect(cap).toBeDefined();
      expect(html).toContain(`Confidence: ${cap!.confidence}`);
    });

    it("displays capability status", () => {
      const html = RelevantEngineeringCapability(
        { related_capabilities: ["mcp-development"] },
        registry,
      );
      const cap = registry.capabilities.find((c) => c.id === "mcp-development");
      expect(cap).toBeDefined();
      expect(html).toContain(`Status: ${cap!.status}`);
    });

    it("displays people associated with capability", () => {
      const html = RelevantEngineeringCapability(
        { related_capabilities: ["mcp-development"] },
        registry,
      );
      expect(html).toContain("People:");
      expect(html).toContain("Paul");
    });

    it("displays related services when present", () => {
      const html = RelevantEngineeringCapability(
        {
          related_capabilities: ["mcp-development"],
          related_services: ["mcp-server-development"],
        },
        registry,
      );
      expect(html).toContain("Related services:");
      expect(html).toContain("MCP Server Development");
    });

    it("omits services section when no related_services", () => {
      const html = RelevantEngineeringCapability(
        { related_capabilities: ["mcp-development"] },
        registry,
      );
      expect(html).not.toContain("Related services:");
    });

    it("includes link to capabilities page", () => {
      const html = RelevantEngineeringCapability(
        { related_capabilities: ["mcp-development"] },
        registry,
      );
      expect(html).toContain('href="/agent-guide/team/capabilities"');
    });
  });

  describe("GET /agent-guide/articles/:slug with frontmatter", () => {
    it("returns 200 for article with frontmatter", async () => {
      const res = await app.request("/agent-guide/articles/what-is-agent-readiness");
      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toContain("text/markdown");
    });

    it("strips frontmatter from body", async () => {
      const res = await app.request("/agent-guide/articles/what-is-agent-readiness");
      const text = await res.text();
      expect(text.startsWith("---")).toBe(false);
      expect(text).toContain("# What Is Agent Readiness?");
    });

    it("includes CTA section for article with related_capabilities", async () => {
      const res = await app.request("/agent-guide/articles/what-is-agent-readiness");
      const text = await res.text();
      expect(text).toContain("Relevant Engineering Capabilities");
      expect(text).toContain("AI Agent Architecture");
      expect(text).toContain("GEO Optimization");
    });

    it("includes link to /agent-guide/team/capabilities in CTA", async () => {
      const res = await app.request("/agent-guide/articles/what-is-agent-readiness");
      const text = await res.text();
      expect(text).toContain("/agent-guide/team/capabilities");
    });

    it("returns 404 for nonexistent article", async () => {
      const res = await app.request("/agent-guide/articles/nonexistent");
      expect(res.status).toBe(404);
    });
  });
});
