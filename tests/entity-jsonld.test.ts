import { describe, it, expect, beforeAll, vi } from "vitest";
import { Hono } from "hono";

// Mock getNftsForToken to avoid Mirror Node API calls in tests
vi.mock("@agentbadge/hedera-core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@agentbadge/hedera-core")>();
  return {
    ...actual,
    getNftsForToken: vi.fn().mockResolvedValue([
      {
        token_id: "0.0.999",
        serial_number: 1,
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
    ]),
  };
});

// Set env var needed by the route
process.env.PASSPORT_TOKEN_ID = "0.0.999";

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

import { upsert as dirUpsert, clear as dirClear, marketUpsert, marketClear } from "@agentbadge/passport";
import type { DirectoryEntry } from "@agentbadge/passport";
import type { CachedMarketTask } from "@agentbadge/hedera-core";

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

describe("SLICE-18-5: Entity JSON-LD on routes", () => {
  let app: Hono;

  beforeAll(() => {
    app = makeTestApp();
    dirClear();
    marketClear();
  });

  describe("Agent profile page (/ui/agents/:tokenId/:serial)", () => {
    it("includes ProfilePage and DigitalDocument JSON-LD on full page", async () => {
      const entry: DirectoryEntry = {
        did: "did:hcs:0.0.999:1",
        tokenId: "0.0.999",
        serial: 1,
        accountId: "0.0.888",
        name: "TestAgent",
        capabilities: ["api_call"],
        endpoint: "https://test.example.com",
        tier: "gold",
        timestamp: 1704067200000,
      };
      dirUpsert(entry);

      const res = await app.request(`/ui/agents/${entry.tokenId}/${entry.serial}`);
      expect(res.status).toBe(200);
      const html = await res.text();
      expect(html).toContain("application/ld+json");
      expect(html).toContain("ProfilePage");
      expect(html).toContain("DigitalDocument");
      expect(html).toContain("did:hcs:0.0.999:1");
      // Core schemas coexist
      expect(html).toContain("SoftwareApplication");
      expect(html).toContain("WebSite");
    });

    it("includes passportLd with tier as keywords", async () => {
      const entry: DirectoryEntry = {
        did: "did:hcs:0.0.999:2",
        tokenId: "0.0.999",
        serial: 2,
        accountId: "0.0.887",
        name: "TierBot",
        capabilities: ["data_provide"],
        endpoint: "",
        tier: "platinum",
        timestamp: 1704067200000,
      };
      dirUpsert(entry);

      const res = await app.request(`/ui/agents/${entry.tokenId}/${entry.serial}`);
      expect(res.status).toBe(200);
      const html = await res.text();
      expect(html).toContain("platinum");
      expect(html).toContain("VerifiableCredential");
    });
  });

  describe("Task details page (/ui/market/tasks/:id)", () => {
    it("includes JobPosting JSON-LD on full page", async () => {
      const task: CachedMarketTask = {
        taskId: "jsonld-test-001",
        posterDid: "did:hcs:0.0.123:1",
        title: "JSON-LD Test Task",
        description: "Verify JobPosting schema on task page",
        priceHbar: 25,
        capabilities: ["data_analysis"],
        status: "posted",
        txId: "0.0.1-123-456",
        consensusTimestamp: "2024-01-01T00:00:00.000Z",
        createdAt: 1704067200000,
      };
      marketUpsert(task);

      const res = await app.request(`/ui/market/tasks/${task.taskId}`);
      expect(res.status).toBe(200);
      const html = await res.text();
      expect(html).toContain("application/ld+json");
      expect(html).toContain("JobPosting");
      expect(html).toContain("JSON-LD Test Task");
      expect(html).toContain("HBAR");
      // Core schemas coexist
      expect(html).toContain("SoftwareApplication");
      expect(html).toContain("WebSite");
    });

    it("includes hiringOrganization with poster DID", async () => {
      const task: CachedMarketTask = {
        taskId: "jsonld-test-002",
        posterDid: "did:hcs:0.0.555:1",
        title: "DID Test Task",
        description: "Test hiringOrganization",
        priceHbar: 10,
        capabilities: [],
        status: "posted",
        txId: "0.0.1-789-012",
        consensusTimestamp: "2024-01-01T00:00:00.000Z",
        createdAt: 1704067200000,
      };
      marketUpsert(task);

      const res = await app.request(`/ui/market/tasks/${task.taskId}`);
      expect(res.status).toBe(200);
      const html = await res.text();
      expect(html).toContain("did:hcs:0.0.555:1");
    });

    it("does not include JobPosting on HTMX fragment requests", async () => {
      const task: CachedMarketTask = {
        taskId: "jsonld-test-003",
        posterDid: "did:hcs:0.0.777:1",
        title: "HTMX Fragment Test",
        description: "Should not have JSON-LD in fragment",
        priceHbar: 5,
        capabilities: [],
        status: "posted",
        txId: "0.0.1-000-000",
        consensusTimestamp: "2024-01-01T00:00:00.000Z",
        createdAt: 1704067200000,
      };
      marketUpsert(task);

      const res = await app.request(`/ui/market/tasks/${task.taskId}`, {
        headers: { "HX-Request": "true" },
      });
      expect(res.status).toBe(200);
      const html = await res.text();
      // HTMX fragments should not include full page JSON-LD
      expect(html).not.toContain("application/ld+json");
    });
  });
});
