import { describe, expect, it } from "vitest";

import {
  buildLlmsTxt,
  type DiscoverySources,
} from "../src/server/lib/agent-discovery";
import { buildAgentCard } from "../src/server/lib/agent-discovery/agent-card";
import { generateAgentGuide } from "../src/server/lib/agent-guide/generator";
import { discoveryRoutes } from "../src/server/routes/well-known/discovery";

/**
 * EPIC-252 (SLICE-252-5): discovery surfaces must advertise the
 * request inbox + surveys to machine clients on first visit —
 * llms.txt, agent-card.json, aauth.json scope_descriptions, and the
 * agent-guide walkthrough. Presence-only assertions; the endpoints
 * themselves are covered by request-inbox-api tests.
 */

const mkSources = (): DiscoverySources => ({
  baseUrl: "https://agentbadge.xyz",
  authSection: "## DID Signature Authentication\n\n...\n",
  articles: [],
  faqEntries: [],
  tiers: [],
  appRoutes: [],
  skus: [],
});

describe("llms.txt advertises inbox + surveys (SLICE-252-5)", () => {
  it("Agent Request Inbox section with endpoints + limits", () => {
    const txt = buildLlmsTxt(mkSources());
    expect(txt).toContain("## Agent Request Inbox & Surveys");
    for (const s of [
      "POST /api/requests",
      "GET /api/requests/:id",
      "GET /api/requests/qa?q=",
      "GET /api/surveys/open",
      "POST /api/surveys/:id/answer",
      "Idempotency-Key",
      "410 expired",
    ]) {
      expect(txt).toContain(s);
    }
  });
});

describe("agent-card.json advertises inbox + surveys", () => {
  it("skills + capabilities entries present", () => {
    const card = buildAgentCard(mkSources());
    expect(card).toContain('"request-inbox"');
    expect(card).toContain('"agent-surveys"');
    expect(card).toContain('"request_inbox"');
    expect(card).toContain('"agent_surveys"');
    expect(card).toContain("POST /api/requests");
  });
});

describe("aauth.json scope_descriptions (SLICE-252-5)", () => {
  it("requests:write + surveys:answer scopes; AB-135/137 fields intact", async () => {
    const res = await discoveryRoutes.request("/.well-known/aauth.json");
    expect(res.status).toBe(200);
    const body = await res.json();
    const scopes = body.scope_descriptions.map(
      (s: { scope: string }) => s.scope,
    );
    expect(scopes).toContain("requests:write");
    expect(scopes).toContain("surveys:answer");
    // AB-135/137 anchors still verified — existing scopes + metadata stay
    for (const s of ["trust:read", "scan:lite", "passport:issue", "badge:verify"]) {
      expect(scopes).toContain(s);
    }
    expect(body.aauth_resource_metadata).toContain("aauth-resource.json");
    // Landmine: no agent_authorization URN promised (AB-136 stays honest GAP)
    expect(JSON.stringify(body)).not.toContain("agent_authorization");
  });
});

describe("agent-guide walkthrough (SLICE-252-5)", () => {
  it("request inbox + surveys sections with curl examples", () => {
    const md = generateAgentGuide();
    expect(md).toContain("## Agent Request Inbox & Surveys");
    expect(md).toMatch(/curl -s -X POST \S+\/api\/requests/);
    expect(md).toContain("/api/requests/rq_<id>");
    expect(md).toContain("/api/requests/qa?q=");
    expect(md).toContain("/api/surveys/open");
    expect(md).toContain("/api/surveys/sv_<id>/answer");
    expect(md).toContain("410");
    expect(md).toContain("Idempotency-Key");
  });
});
