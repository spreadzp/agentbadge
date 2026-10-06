/**
 * SLICE-178-3 (MYPROJ-2515): agent-evaluation.json + owner-questions.json —
 * trust manifests served from the manifest registry.
 *
 * AC1: every ladder ref is an absolute URL or executable command.
 * AC4: no claim without evidence — every capability has non-empty evidence+verify.
 */
import { describe, it, expect } from "vitest";
import { Hono } from "hono";
import {
  buildAgentEvaluation,
  buildOwnerQuestions,
  buildLlmsTxt,
} from "../../src/server/lib/agent-discovery";
import { createDiscoveryRoutes } from "../../src/server/routes/discovery";
import type { DiscoverySources } from "../../src/server/lib/agent-discovery";

const BASE = "https://agentbadge.xyz";

function mkSources(over: Partial<DiscoverySources> = {}): DiscoverySources {
  return {
    baseUrl: BASE,
    authSection: "",
    llmsCore: "# AgentBadge\n\n> stub",
    articles: [],
    faqEntries: [],
    tiers: [],
    appRoutes: [],
    ...over,
  } as DiscoverySources;
}

interface LadderCheck {
  claim: string;
  action: string;
  ref: string;
}

interface EvaluationDoc {
  version: string;
  subject: string;
  ladder: Array<{ depth: string; checks: LadderCheck[] }>;
  capabilities: Array<{ name: string; evidence: string; verify: string }>;
  selfEvaluation: string[];
  sources: string[];
}

interface OwnerQuestionsDoc {
  version: string;
  questions: Array<{ id: string; text: string; why: string }>;
  fleetSizeHints: { solo: string[]; team: string[]; venue: string[] };
}

const isUrl = (s: string) => /^https?:\/\//.test(s);
const isCommand = (s: string) => /^(npx|bunx|curl|node|npm)\s/.test(s);

const evaluation = () =>
  JSON.parse(buildAgentEvaluation(mkSources())) as EvaluationDoc;

const ownerQuestions = () =>
  JSON.parse(buildOwnerQuestions(mkSources())) as OwnerQuestionsDoc;

describe("buildAgentEvaluation — verification ladder", () => {
  it("has version + subject derived from baseUrl host", () => {
    const doc = evaluation();
    expect(doc.version).toBe("1.0");
    expect(doc.subject).toBe("agentbadge.xyz");
  });

  it("ladder covers all four depths", () => {
    const depths = evaluation().ladder.map((l) => l.depth);
    expect(depths).toEqual(["5s", "60s", "5min", "full"]);
  });

  it("AC1: every ladder ref is an absolute URL or executable command", () => {
    for (const level of evaluation().ladder) {
      for (const check of level.checks) {
        expect(check.claim.length).toBeGreaterThan(0);
        expect(check.action.length).toBeGreaterThan(0);
        expect(
          isUrl(check.ref) || isCommand(check.ref),
          `ref "${check.ref}" must be URL or command`,
        ).toBe(true);
      }
    }
  });

  it("AC4: every capability has non-empty evidence and verify", () => {
    const caps = evaluation().capabilities;
    expect(caps.length).toBeGreaterThan(0);
    for (const cap of caps) {
      expect(cap.name.length).toBeGreaterThan(0);
      expect(cap.evidence.length).toBeGreaterThan(0);
      expect(cap.verify.length).toBeGreaterThan(0);
      expect(
        isUrl(cap.verify) || isCommand(cap.verify),
        `verify "${cap.verify}" must be URL or command`,
      ).toBe(true);
    }
  });

  it("includes selfEvaluation + sources sections", () => {
    const doc = evaluation();
    expect(doc.selfEvaluation.length).toBeGreaterThan(0);
    expect(doc.sources.length).toBeGreaterThan(0);
    for (const s of doc.sources) {
      expect(isUrl(s)).toBe(true);
    }
  });

  it("ladder refs are rooted at baseUrl or public explorers", () => {
    const first = evaluation().ladder[0].checks[0];
    expect(first.ref).toContain("arc.io");
  });
});

describe("buildOwnerQuestions — fleet FAQ", () => {
  it("has questions with id/text/why", () => {
    const doc = ownerQuestions();
    expect(doc.questions.length).toBeGreaterThanOrEqual(5);
    for (const q of doc.questions) {
      expect(q.id).toMatch(/^[a-z0-9-]+$/);
      expect(q.text.length).toBeGreaterThan(0);
      expect(q.why.length).toBeGreaterThan(0);
    }
  });

  it("fleetSizeHints covers solo/team/venue", () => {
    const hints = ownerQuestions().fleetSizeHints;
    expect(hints.solo.length).toBeGreaterThan(0);
    expect(hints.team.length).toBeGreaterThan(0);
    expect(hints.venue.length).toBeGreaterThan(0);
  });
});

describe("manifest routes — evaluation + owner-questions", () => {
  const app = new Hono();
  app.route("/", createDiscoveryRoutes(() => mkSources()));

  it("GET /.well-known/agent-evaluation.json returns 200 JSON", async () => {
    const res = await app.request("/.well-known/agent-evaluation.json");
    expect(res.status).toBe(200);
    const body = (await res.json()) as EvaluationDoc;
    expect(body.version).toBe("1.0");
    expect(body.ladder.length).toBe(4);
  });

  it("GET /.well-known/owner-questions.json returns 200 JSON", async () => {
    const res = await app.request("/.well-known/owner-questions.json");
    expect(res.status).toBe(200);
    const body = (await res.json()) as OwnerQuestionsDoc;
    expect(body.questions.length).toBeGreaterThanOrEqual(5);
  });
});

describe("llms.txt references both trust manifests", () => {
  it("mentions agent-evaluation.json + owner-questions.json", () => {
    const txt = buildLlmsTxt(mkSources());
    expect(txt).toContain("/.well-known/agent-evaluation.json");
    expect(txt).toContain("/.well-known/owner-questions.json");
  });
});
