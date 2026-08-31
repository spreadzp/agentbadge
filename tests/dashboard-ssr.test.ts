import { describe, it, expect, beforeAll, vi } from "vitest";
import { Hono } from "hono";

// Mock getNftsForToken + getTopicMessages to avoid external API calls
vi.mock("@agentbadge/hedera-core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@agentbadge/hedera-core")>();
  return {
    ...actual,
    getNftsForToken: vi.fn().mockResolvedValue([
      {
        token_id: "0.0.999",
        serial_number: 3,
        account_id: "0.0.888",
        metadata: "",
        deleted: false,
        created_timestamp: "1704067200.000000000",
      },
      {
        token_id: "0.0.999",
        serial_number: 2,
        account_id: "0.0.887",
        metadata: "",
        deleted: false,
        created_timestamp: "1704067200.000000000",
      },
      {
        token_id: "0.0.999",
        serial_number: 1,
        account_id: "0.0.886",
        metadata: "",
        deleted: true,
        created_timestamp: "1704067200.000000000",
      },
    ]),
    getTopicMessages: vi.fn().mockResolvedValue([
      {
        message: JSON.stringify({ type: "passport_issued", did: "did:hcs:0.0.999:1", tier: "bronze" }),
        consensus_timestamp: "1704067200.000000000",
      },
      {
        message: JSON.stringify({ type: "tier_upgraded", did: "did:hcs:0.0.999:1", oldTier: "bronze", newTier: "silver" }),
        consensus_timestamp: "1704067201.000000000",
      },
    ]),
  };
});

// Set env vars needed by the route
process.env.PASSPORT_TOKEN_ID = "0.0.999";
process.env.AUDIT_TOPIC_ID = "0.0.555";

// Import after mock setup
const { uiRoutes } = await import("../src/server/routes/ui");
const { searchRoutes } = await import("../src/server/routes/search");
const { contactRoutes } = await import("../src/server/routes/contact");
const { agentGuideRoutes } = await import("../src/server/routes/agent-guide");
const { marketGuideRoutes } = await import("../src/server/routes/market-guide");
const { medicalGuideRoutes } = await import("../src/server/routes/medical-guide");
const { catalogRoutes } = await import("../src/server/routes/catalog");
const { wellKnownRoutes } = await import("../src/server/routes/well-known");
const { corsMiddleware } = await import("../src/server/middleware/cors");
const { rateLimitMiddleware } = await import("../src/server/middleware/rate-limit");
const { signatureVerificationMiddleware } = await import("../src/server/middleware/signature-verification");

import { marketUpsert, marketClear } from "@agentbadge/passport";
import type { CachedMarketTask } from "@agentbadge/hedera-core";
import { Dashboard, type DashboardSsrData } from "../src/views/dashboard";

function makeTestApp(): Hono {
  const app = new Hono();
  app.use(corsMiddleware());
  app.use((c, next) => signatureVerificationMiddleware(c as any, next));
  app.use(rateLimitMiddleware());
  app.route("/", catalogRoutes);
  app.route("/", wellKnownRoutes);
  app.route("/", uiRoutes);
  app.route("/", searchRoutes);
  app.route("/", contactRoutes);
  app.route("/", agentGuideRoutes);
  app.route("/", marketGuideRoutes);
  app.route("/", medicalGuideRoutes);
  return app;
}

// ─── Unit tests: Dashboard() view ───────────────────────────────────────────

describe("SLICE-18-6: Dashboard SSR unit tests", () => {
  describe("Dashboard() with SSR data", () => {
    it("renders stats numbers when data provided", () => {
      const html = Dashboard({
        stats: {
          totalIssued: 5,
          totalUpgrades: 2,
          activeCount: 4,
          revokedCount: 1,
          byTier: { bronze: 2, silver: 1, gold: 1, platinum: 0 },
        },
      }).toString();

      expect(html).toContain(">5<");
      expect(html).toContain(">4<");
      expect(html).toContain(">1<");
      expect(html).toContain(">2<");
    });

    it("renders feed cards when NFTs provided", () => {
      const html = Dashboard({
        feed: [
          {
            token_id: "0.0.999",
            serial_number: 1,
            account_id: "0.0.888",
            metadata: "",
            deleted: false,
            created_timestamp: "1704067200.000000000",
          },
        ],
      }).toString();

      expect(html).toContain("#1");
      expect(html).toContain("0.0.999");
    });

    it("renders audit events when provided", () => {
      const html = Dashboard({
        audit: [
          {
            type: "passport_issued",
            did: "did:hcs:0.0.999:1",
            tokenId: "0.0.999",
            serial: 1,
            timestamp: 1704067200,
            tier: "bronze",
            consensusTimestamp: "1704067200.000000000",
          },
        ],
      }).toString();

      expect(html).toContain("passport_issued");
      expect(html).toContain("did:hcs:0.0.999:1");
    });

    it("renders marketplace tasks when provided", () => {
      const html = Dashboard({
        tasks: [
          {
            taskId: "ssr-test-001",
            posterDid: "did:hcs:0.0.123:1",
            title: "SSR Test Task",
            description: "Test task for SSR",
            priceHbar: 10,
            capabilities: ["api_call"],
            status: "posted",
            txId: "0.0.1-123-456",
            consensusTimestamp: "2024-01-01T00:00:00.000Z",
            createdAt: 1704067200000,
          },
        ],
      }).toString();

      expect(html).toContain("SSR Test Task");
      expect(html).toContain("10");
    });

    it("preserves HTMX hx-get attributes on all sections", () => {
      const html = Dashboard().toString();

      expect(html).toContain('hx-get="/ui/stats"');
      expect(html).toContain('hx-get="/ui/feed"');
      expect(html).toContain('hx-get="/ui/audit"');
      expect(html).toContain('hx-get="/ui/a2a/inbox/fragment"');
      expect(html).toContain('hx-get="/ui/market/tasks"');
    });
  });

  describe("Dashboard() with empty/no data", () => {
    it("renders informative empty state for stats", () => {
      const html = Dashboard().toString();

      expect(html).toContain("0 passports minted");
      expect(html).toContain("Agent Guide");
    });

    it("renders informative empty state for feed", () => {
      const html = Dashboard().toString();

      expect(html).toContain("No passports issued yet");
    });

    it("renders informative empty state for audit", () => {
      const html = Dashboard().toString();

      expect(html).toContain("No audit events yet");
      expect(html).toContain("State changes");
    });

    it("renders informative A2A description block", () => {
      const html = Dashboard().toString();

      expect(html).toContain("Agent-to-Agent messaging inbox");
      expect(html).toContain("Hedera Consensus Service");
    });

    it("renders informative empty state for marketplace", () => {
      const html = Dashboard().toString();

      expect(html).toContain("No marketplace tasks available");
      expect(html).toContain("Market Guide");
    });

    it("never contains 'Loading' text", () => {
      const html = Dashboard().toString();

      expect(html).not.toContain("Loading");
      expect(html).not.toContain("loading");
    });
  });

  describe("Dashboard() first paint content volume", () => {
    it("contains >=300 chars of meaningful content outside head/nav/footer", () => {
      const fullHtml = Dashboard().toString();
      // Strip head, nav, footer — get body content only
      const bodyMatch = fullHtml.match(/<body[^>]*>([\s\S]*)<\/body>/);
      const body = bodyMatch ? bodyMatch[1] : fullHtml;
      // Strip script tags and their content
      const stripped = body.replace(/<script[\s\S]*?<\/script>/g, "").replace(/<style[\s\S]*?<\/style>/g, "");
      // Strip HTML tags to get text content
      const text = stripped.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();

      expect(text.length).toBeGreaterThanOrEqual(300);
    });
  });
});

// ─── Integration tests: GET / route ──────────────────────────────────────────

describe("SLICE-18-6: Dashboard SSR integration", () => {
  let app: Hono;

  beforeAll(() => {
    app = makeTestApp();
    marketClear();
  });

  it("GET / returns 200 and does not contain 'Loading'", async () => {
    const res = await app.request("/");
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).not.toContain("Loading");
    expect(html).not.toContain("loading");
  });

  it("GET / contains all 5 section markers", async () => {
    const res = await app.request("/");
    const html = await res.text();

    expect(html).toContain('id="stats"');
    expect(html).toContain('id="passport-feed"');
    expect(html).toContain('id="audit-stream"');
    expect(html).toContain('id="a2a-inbox"');
    expect(html).toContain('id="marketplace-tasks"');
  });

  it("GET / contains HTMX polling attributes", async () => {
    const res = await app.request("/");
    const html = await res.text();

    expect(html).toContain('hx-get="/ui/stats"');
    expect(html).toContain('hx-get="/ui/feed"');
    expect(html).toContain('hx-get="/ui/audit"');
    expect(html).toContain('hx-get="/ui/market/tasks"');
  });

  it("GET / contains SSR stats data (numbers from mock)", async () => {
    const res = await app.request("/");
    const html = await res.text();

    // Mock returns 3 NFTs: 2 active, 1 revoked
    expect(html).toContain(">3<"); // total issued
    expect(html).toContain(">2<"); // active
    expect(html).toContain(">1<"); // revoked
  });

  it("GET / contains SSR feed data (passport cards)", async () => {
    const res = await app.request("/");
    const html = await res.text();

    expect(html).toContain("#3"); // highest serial first
    expect(html).toContain("0.0.999");
  });

  it("GET / contains SSR audit data", async () => {
    const res = await app.request("/");
    const html = await res.text();

    expect(html).toContain("passport_issued");
    expect(html).toContain("tier_upgraded");
  });

  it("GET / contains informative A2A description", async () => {
    const res = await app.request("/");
    const html = await res.text();

    expect(html).toContain("Agent-to-Agent messaging");
    expect(html).toContain("Hedera Consensus Service");
  });

  it("GET / with empty market cache shows empty state, not 'Loading'", async () => {
    marketClear();
    const res = await app.request("/");
    const html = await res.text();

    expect(html).toContain("No marketplace tasks available");
    expect(html).not.toContain("Loading");
  });

  it("GET / with market tasks shows task data", async () => {
    const task: CachedMarketTask = {
      taskId: "ssr-integration-001",
      posterDid: "did:hcs:0.0.123:1",
      title: "Integration SSR Task",
      description: "Verify SSR rendering of tasks on dashboard",
      priceHbar: 15,
      capabilities: ["api_call"],
      status: "posted",
      txId: "0.0.1-123-456",
      consensusTimestamp: "2024-01-01T00:00:00.000Z",
      createdAt: 1704067200000,
    };
    marketUpsert(task);

    const res = await app.request("/");
    const html = await res.text();

    expect(html).toContain("Integration SSR Task");
    marketClear();
  });

  it("GET / has >=300 chars of meaningful body content", async () => {
    const res = await app.request("/");
    const fullHtml = await res.text();
    const bodyMatch = fullHtml.match(/<body[^>]*>([\s\S]*)<\/body>/);
    const body = bodyMatch ? bodyMatch[1] : fullHtml;
    const stripped = body.replace(/<script[\s\S]*?<\/script>/g, "").replace(/<style[\s\S]*?<\/style>/g, "");
    const text = stripped.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();

    expect(text.length).toBeGreaterThanOrEqual(300);
  });
});
