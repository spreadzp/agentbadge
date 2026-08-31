import { describe, it, expect, vi, beforeEach } from "vitest";
import { Hono } from "hono";
import type { Tier, Capability } from "@agentbadge/hedera-core";

vi.mock("@agentbadge/passport", async (importOriginal) => ({
  ...await importOriginal(),
  getPassportInfo: vi.fn(),
}));

import { verifyRoutes } from "../src/server/routes/verify";
import { didRoutes } from "../src/server/routes/did";
import { getPassportInfo } from "@agentbadge/passport";
import type { PassportInfo } from "@agentbadge/passport";

const mockPassportInfo = (overrides: Partial<PassportInfo> = {}): PassportInfo => ({
  active: true,
  tokenId: "0.0.123",
  serialNumber: 1,
  tier: "silver",
  capabilities: ["api_call"],
  did: "did:hcs:0.0.123:1",
  owner: "0.0.456",
  issuedAt: 1700000000,
  endpoint: "https://agent.example.com",
  ...overrides,
});

describe("DID resolution routes", () => {
  let app: Hono;

  beforeEach(() => {
    vi.resetAllMocks();
    vi.stubEnv("PASSPORT_TOKEN_ID", "0.0.123");
    app = new Hono();
    app.route("/", verifyRoutes);
    app.route("/", didRoutes);
  });

  describe("parseDid", () => {
    it("parses valid did:hcs:{tokenId}:{serial}", async () => {
      const { parseDid } = await import("../src/server/routes/did");
      expect(parseDid("did:hcs:0.0.123:1")).toEqual({
        tokenId: "0.0.123",
        serial: 1,
      });
    });

    it("parses valid did with large serial number", async () => {
      const { parseDid } = await import("../src/server/routes/did");
      expect(parseDid("did:hcs:0.0.999:42")).toEqual({
        tokenId: "0.0.999",
        serial: 42,
      });
    });

    it("returns null for malformed DID", async () => {
      const { parseDid } = await import("../src/server/routes/did");
      expect(parseDid("not-a-did")).toBeNull();
    });

    it("returns null for missing serial", async () => {
      const { parseDid } = await import("../src/server/routes/did");
      expect(parseDid("did:hcs:0.0.123")).toBeNull();
    });

    it("returns null for wrong method", async () => {
      const { parseDid } = await import("../src/server/routes/did");
      expect(parseDid("did:web:0.0.123:1")).toBeNull();
    });
  });

  describe("GET /did/:did", () => {
    it("returns 400 for malformed DID", async () => {
      const res = await app.request("/did/not-a-did");
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toBeDefined();
    });

    it("returns 404 for non-existent passport", async () => {
      vi.mocked(getPassportInfo).mockResolvedValueOnce(null);

      const res = await app.request("/did/did:hcs:0.0.123:999");
      expect(res.status).toBe(404);
    });

    it("returns 404 for revoked passport (active=false)", async () => {
      vi.mocked(getPassportInfo).mockResolvedValueOnce(
        mockPassportInfo({ active: false }),
      );

      const res = await app.request("/did/did:hcs:0.0.123:1");
      expect(res.status).toBe(404);
    });

    it("returns 200 with W3C DID document for active passport", async () => {
      vi.mocked(getPassportInfo).mockResolvedValueOnce(mockPassportInfo());

      const res = await app.request("/did/did:hcs:0.0.123:1");
      expect(res.status).toBe(200);
      const body = await res.json();

      expect(body["@context"]).toEqual(["https://www.w3.org/ns/did/v1"]);
      expect(body.id).toBe("did:hcs:0.0.123:1");
      expect(body.verificationMethod).toEqual([]);
      expect(body.service).toBeDefined();
      expect(body.service[0].id).toBe("did:hcs:0.0.123:1#mcp");
      expect(body.service[0].type).toBe("MCP");
      expect(body.service[0].serviceEndpoint).toBe("https://agent.example.com");
    });

    it("returns 200 with empty service when metadata has no endpoint", async () => {
      vi.mocked(getPassportInfo).mockResolvedValueOnce(
        mockPassportInfo({ endpoint: undefined }),
      );

      const res = await app.request("/did/did:hcs:0.0.123:1");
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.service).toEqual([]);
    });
  });
});
