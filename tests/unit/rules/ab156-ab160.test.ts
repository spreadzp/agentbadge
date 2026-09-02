import { describe, it, expect } from "vitest";
import { SEMANTIC_CHECKERS } from "../../../src/agent-readiness/rule-engine/semantic-checkers";
import { AB156 } from "../../../src/agent-readiness/rules/AB156";
import { AB157 } from "../../../src/agent-readiness/rules/AB157";
import { AB158 } from "../../../src/agent-readiness/rules/AB158";
import { AB159 } from "../../../src/agent-readiness/rules/AB159";
import { AB160 } from "../../../src/agent-readiness/rules/AB160";
import type { ResponseSnapshot } from "../../../src/agent-readiness/scanner/snapshot";

// ─── Helpers ───────────────────────────────────────────────────────────────

const mockSnap = (url: string, body?: string | null, status = 200): ResponseSnapshot => ({
  url,
  status,
  bodyHash: "abc123",
  bodySize: body?.length ?? 0,
  contentType: body ? "application/json" : "text/plain",
  resolvedIp: "93.184.216.34",
  fetchedAt: "2025-01-01T00:00:00Z",
  fetchTimeMs: 100,
  redirectChain: [],
  body,
  headers: {},
});

// ─── Fixtures ──────────────────────────────────────────────────────────────

// Rich guide with sandbox, policy, capabilities, constraints, support
const guideRich = mockSnap(
  "https://example.com/.well-known/agent-guide.json",
  JSON.stringify({
    name: "Example API",
    sandbox: { url: "https://sandbox.example.com", description: "Test environment" },
    policy: { allowed: true, restrictions: "No bulk scraping" },
    capabilities: [
      { name: "Create charge", description: "Creates a new charge for a customer" },
      { name: "List charges", description: "Lists all charges with optional filters" },
    ],
    support: { email: "support@example.com", url: "https://example.com/support" },
  }),
);

const guideBare = mockSnap(
  "https://example.com/guide",
  "A simple API for developers.",
);

const guideSandboxMentionOnly = mockSnap(
  "https://example.com/guide",
  "We have a sandbox environment for testing.",
);

const guideTosOnly = mockSnap(
  "https://example.com/guide",
  "See our terms of service at /tos for usage rules.",
);

const guideCapListNoDesc = mockSnap(
  "https://example.com/guide",
  JSON.stringify({
    capabilities: ["/charges", "/refunds", "/customers"],
  }),
);

const guideGlobalConstraints = mockSnap(
  "https://example.com/guide",
  "Refunds are allowed within 30 days. Cancellation window is 24 hours.",
);

const guideContactPageOnly = mockSnap(
  "https://example.com/guide",
  "Contact us at /contact for any questions.",
);

const openapiWithSandbox = mockSnap(
  "https://example.com/openapi.json",
  JSON.stringify({
    openapi: "3.1.0",
    info: { title: "Example API", version: "1.0.0" },
    servers: [
      { url: "https://api.example.com", description: "Production" },
      { url: "https://sandbox.example.com", description: "Sandbox test environment" },
    ],
    paths: {},
  }),
);

const llmsWithPolicy = mockSnap(
  "https://example.com/llms.txt",
  "## Agent Policy\n\nAutomated agents are allowed. Rate limit: 100 req/min.\n## Support\n\nEmail: support@example.com",
);

const llmsWithConstraints = mockSnap(
  "https://example.com/llms.txt",
  "## Constraints\n\nRefunds: 30-day window per charge\nCancellation: 24-hour window per subscription",
);

const aiTxtWithPolicy = mockSnap(
  "https://example.com/ai.txt",
  "User-agent: *\nAllow: /api/\nDisallow: /admin/\n# AI agents permitted with rate limits",
);

const securityTxt = mockSnap(
  "https://example.com/.well-known/security.txt",
  "Contact: mailto:security@example.com\nExpires: 2025-12-31T00:00:00Z",
);

// ─── Tests ─────────────────────────────────────────────────────────────────

describe("SLICE-95-7: Environment, Policy & Support Rules (AB-156..AB-160)", () => {

  // ─── AB-156: Sandbox environment declared ─────────────────────────────────
  describe("AB-156: Sandbox environment declared (sandbox_declared)", () => {
    it("rule definition is correct", () => {
      expect(AB156.rule_id).toBe("AB-156");
      expect(AB156.check.type).toBe("semantic_validation");
      expect(AB156.check.semantic).toBe("sandbox_declared");
      expect(AB156.category).toBe("sandbox");
      expect(AB156.severity).toBe("medium");
      expect(AB156.counted_in_score).toBe(true);
    });

    it("guide with sandbox URL → found", () => {
      const result = SEMANTIC_CHECKERS["sandbox_declared"]({
        guide: guideRich,
        openapi: null,
        llms: null,
      });
      expect(result.outcome).toBe("found");
      expect(result.detail).toContain("base URL");
    });

    it("openapi servers with sandbox URL → found", () => {
      const result = SEMANTIC_CHECKERS["sandbox_declared"]({
        guide: guideBare,
        openapi: openapiWithSandbox,
        llms: null,
      });
      expect(result.outcome).toBe("found");
    });

    it("sandbox mentioned but no URL → partial", () => {
      const result = SEMANTIC_CHECKERS["sandbox_declared"]({
        guide: guideSandboxMentionOnly,
        openapi: null,
        llms: null,
      });
      expect(result.outcome).toBe("partial");
    });

    it("no sandbox mentioned → absent", () => {
      const result = SEMANTIC_CHECKERS["sandbox_declared"]({
        guide: guideBare,
        openapi: null,
        llms: null,
      });
      expect(result.outcome).toBe("absent");
    });

    it("no sources → no_source", () => {
      const result = SEMANTIC_CHECKERS["sandbox_declared"]({
        guide: null,
        openapi: null,
        llms: null,
      });
      expect(result.outcome).toBe("no_source");
    });
  });

  // ─── AB-157: Agent policy machine-readable ────────────────────────────────
  describe("AB-157: Agent policy machine-readable (agent_policy_machine_readable)", () => {
    it("rule definition is correct", () => {
      expect(AB157.rule_id).toBe("AB-157");
      expect(AB157.check.type).toBe("semantic_validation");
      expect(AB157.check.semantic).toBe("agent_policy_machine_readable");
      expect(AB157.category).toBe("agent_policy");
      expect(AB157.severity).toBe("medium");
    });

    it("guide with explicit policy → found", () => {
      const result = SEMANTIC_CHECKERS["agent_policy_machine_readable"]({
        guide: guideRich,
        llms: null,
        ai_txt: null,
      });
      expect(result.outcome).toBe("found");
    });

    it("ai.txt with agent permissions → found", () => {
      const result = SEMANTIC_CHECKERS["agent_policy_machine_readable"]({
        guide: guideBare,
        llms: null,
        ai_txt: aiTxtWithPolicy,
      });
      expect(result.outcome).toBe("found");
    });

    it("llms.txt with policy section → found", () => {
      const result = SEMANTIC_CHECKERS["agent_policy_machine_readable"]({
        guide: guideBare,
        llms: llmsWithPolicy,
        ai_txt: null,
      });
      expect(result.outcome).toBe("found");
    });

    it("generic ToS link only → partial", () => {
      const result = SEMANTIC_CHECKERS["agent_policy_machine_readable"]({
        guide: guideTosOnly,
        llms: null,
        ai_txt: null,
      });
      expect(result.outcome).toBe("partial");
    });

    it("no policy → absent", () => {
      const result = SEMANTIC_CHECKERS["agent_policy_machine_readable"]({
        guide: guideBare,
        llms: null,
        ai_txt: null,
      });
      expect(result.outcome).toBe("absent");
    });

    it("no sources → no_source", () => {
      const result = SEMANTIC_CHECKERS["agent_policy_machine_readable"]({
        guide: null,
        llms: null,
        ai_txt: null,
      });
      expect(result.outcome).toBe("no_source");
    });
  });

  // ─── AB-158: Capability list declared ─────────────────────────────────────
  describe("AB-158: Capability list declared (capability_list_declared)", () => {
    it("rule definition is correct", () => {
      expect(AB158.rule_id).toBe("AB-158");
      expect(AB158.check.type).toBe("semantic_validation");
      expect(AB158.check.semantic).toBe("capability_list_declared");
      expect(AB158.category).toBe("discovery");
      expect(AB158.severity).toBe("medium");
    });

    it("guide with capabilities array + descriptions → found", () => {
      const result = SEMANTIC_CHECKERS["capability_list_declared"]({
        guide: guideRich,
      });
      expect(result.outcome).toBe("found");
      expect(result.detail).toContain("descriptions");
    });

    it("guide with bare capability list (no descriptions) → partial", () => {
      const result = SEMANTIC_CHECKERS["capability_list_declared"]({
        guide: guideCapListNoDesc,
      });
      expect(result.outcome).toBe("partial");
    });

    it("guide with no capabilities → absent", () => {
      const result = SEMANTIC_CHECKERS["capability_list_declared"]({
        guide: guideBare,
      });
      expect(result.outcome).toBe("absent");
    });

    it("no guide → no_source", () => {
      const result = SEMANTIC_CHECKERS["capability_list_declared"]({
        guide: null,
      });
      expect(result.outcome).toBe("no_source");
    });
  });

  // ─── AB-159: Business constraints documented ──────────────────────────────
  describe("AB-159: Business constraints documented (business_constraints_documented)", () => {
    it("rule definition is correct", () => {
      expect(AB159.rule_id).toBe("AB-159");
      expect(AB159.check.type).toBe("semantic_validation");
      expect(AB159.check.semantic).toBe("business_constraints_documented");
      expect(AB159.category).toBe("actionability");
      expect(AB159.severity).toBe("medium");
    });

    it("guide with per-capability constraints → found", () => {
      const guideWithPerCap = mockSnap(
        "https://example.com/guide",
        JSON.stringify({
          capabilities: [
            { name: "Create charge", description: "Creates a charge", constraints: ["Refund within 30 days"] },
            { name: "Subscribe", description: "Creates a subscription", limits: { maxPerMonth: 100 } },
          ],
        }),
      );
      const result = SEMANTIC_CHECKERS["business_constraints_documented"]({
        guide: guideWithPerCap,
        llms: null,
      });
      expect(result.outcome).toBe("found");
    });

    it("llms.txt with per-capability constraints → found", () => {
      const result = SEMANTIC_CHECKERS["business_constraints_documented"]({
        guide: guideBare,
        llms: llmsWithConstraints,
      });
      expect(result.outcome).toBe("found");
    });

    it("global constraints only (no per-capability tie) → partial", () => {
      const result = SEMANTIC_CHECKERS["business_constraints_documented"]({
        guide: guideGlobalConstraints,
        llms: null,
      });
      expect(result.outcome).toBe("partial");
    });

    it("no constraints → absent", () => {
      const result = SEMANTIC_CHECKERS["business_constraints_documented"]({
        guide: guideBare,
        llms: null,
      });
      expect(result.outcome).toBe("absent");
    });

    it("no sources → no_source", () => {
      const result = SEMANTIC_CHECKERS["business_constraints_documented"]({
        guide: null,
        llms: null,
      });
      expect(result.outcome).toBe("no_source");
    });
  });

  // ─── AB-160: Support path declared ────────────────────────────────────────
  describe("AB-160: Support path declared (support_path_declared)", () => {
    it("rule definition is correct", () => {
      expect(AB160.rule_id).toBe("AB-160");
      expect(AB160.check.type).toBe("semantic_validation");
      expect(AB160.check.semantic).toBe("support_path_declared");
      expect(AB160.category).toBe("documentation");
      expect(AB160.severity).toBe("low");
    });

    it("guide with support email → found", () => {
      const result = SEMANTIC_CHECKERS["support_path_declared"]({
        guide: guideRich,
        llms: null,
        security_txt: null,
      });
      expect(result.outcome).toBe("found");
    });

    it("security.txt with Contact (RFC 9116) → found", () => {
      const result = SEMANTIC_CHECKERS["support_path_declared"]({
        guide: guideBare,
        llms: null,
        security_txt: securityTxt,
      });
      expect(result.outcome).toBe("found");
    });

    it("llms.txt with support section → found", () => {
      const result = SEMANTIC_CHECKERS["support_path_declared"]({
        guide: guideBare,
        llms: llmsWithPolicy,
        security_txt: null,
      });
      expect(result.outcome).toBe("found");
    });

    it("generic contact page only → partial", () => {
      const result = SEMANTIC_CHECKERS["support_path_declared"]({
        guide: guideContactPageOnly,
        llms: null,
        security_txt: null,
      });
      expect(result.outcome).toBe("partial");
    });

    it("no support → absent", () => {
      const result = SEMANTIC_CHECKERS["support_path_declared"]({
        guide: guideBare,
        llms: null,
        security_txt: null,
      });
      expect(result.outcome).toBe("absent");
    });

    it("no sources → no_source", () => {
      const result = SEMANTIC_CHECKERS["support_path_declared"]({
        guide: null,
        llms: null,
        security_txt: null,
      });
      expect(result.outcome).toBe("no_source");
    });
  });

  // ─── Claims are semantic ──────────────────────────────────────────────────
  describe("Claims are semantic (not rule names)", () => {
    it("AB-156 name is a semantic claim", () => {
      expect(AB156.name).not.toBe("AB-156");
      expect(AB156.name.length).toBeGreaterThan(3);
    });
    it("AB-157 name is a semantic claim", () => {
      expect(AB157.name).not.toBe("AB-157");
      expect(AB157.name.length).toBeGreaterThan(3);
    });
    it("AB-158 name is a semantic claim", () => {
      expect(AB158.name).not.toBe("AB-158");
      expect(AB158.name.length).toBeGreaterThan(3);
    });
    it("AB-159 name is a semantic claim", () => {
      expect(AB159.name).not.toBe("AB-159");
      expect(AB159.name.length).toBeGreaterThan(3);
    });
    it("AB-160 name is a semantic claim", () => {
      expect(AB160.name).not.toBe("AB-160");
      expect(AB160.name.length).toBeGreaterThan(3);
    });
  });

  // ─── Determinism ──────────────────────────────────────────────────────────
  describe("Pure checkers: deterministic", () => {
    it("sandbox_declared is deterministic", () => {
      const sources = { guide: guideRich, openapi: openapiWithSandbox, llms: null };
      const r1 = SEMANTIC_CHECKERS["sandbox_declared"](sources);
      const r2 = SEMANTIC_CHECKERS["sandbox_declared"](sources);
      expect(r1).toEqual(r2);
    });
    it("agent_policy_machine_readable is deterministic", () => {
      const sources = { guide: guideRich, llms: llmsWithPolicy, ai_txt: aiTxtWithPolicy };
      const r1 = SEMANTIC_CHECKERS["agent_policy_machine_readable"](sources);
      const r2 = SEMANTIC_CHECKERS["agent_policy_machine_readable"](sources);
      expect(r1).toEqual(r2);
    });
    it("capability_list_declared is deterministic", () => {
      const sources = { guide: guideRich };
      const r1 = SEMANTIC_CHECKERS["capability_list_declared"](sources);
      const r2 = SEMANTIC_CHECKERS["capability_list_declared"](sources);
      expect(r1).toEqual(r2);
    });
    it("business_constraints_documented is deterministic", () => {
      const sources = { guide: guideRich, llms: llmsWithConstraints };
      const r1 = SEMANTIC_CHECKERS["business_constraints_documented"](sources);
      const r2 = SEMANTIC_CHECKERS["business_constraints_documented"](sources);
      expect(r1).toEqual(r2);
    });
    it("support_path_declared is deterministic", () => {
      const sources = { guide: guideRich, llms: null, security_txt: securityTxt };
      const r1 = SEMANTIC_CHECKERS["support_path_declared"](sources);
      const r2 = SEMANTIC_CHECKERS["support_path_declared"](sources);
      expect(r1).toEqual(r2);
    });
  });

  // ─── Dedupe boundary: agents-txt file presence vs policy content ──────────
  describe("Dedupe boundary: AB-157 checks POLICY CONTENT not file presence", () => {
    it("ai.txt with crawler-only rules (no agent policy) → absent", () => {
      const crawlerOnly = mockSnap(
        "https://example.com/ai.txt",
        "User-agent: GoogleBot\nDisallow: /admin/",
      );
      const result = SEMANTIC_CHECKERS["agent_policy_machine_readable"]({
        guide: guideBare,
        llms: null,
        ai_txt: crawlerOnly,
      });
      // Crawler-only rules without agent-specific permissions should not count as agent policy
      expect(result.outcome).toBe("absent");
    });
  });
});
