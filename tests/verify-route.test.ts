import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@agentbadge/passport", async (importOriginal) => ({
  ...await importOriginal(),
  getPassportInfo: vi.fn(),
  listPassportsByAddress: vi.fn(),
  listAllPassports: vi.fn(),
}));

import { Hono } from "hono";
import { verifyRoutes } from "../src/server/routes/verify";
import {
  getPassportInfo,
  listPassportsByAddress,
  listAllPassports,
} from "@agentbadge/passport";
import type { PassportInfo } from "@agentbadge/passport";

const mockPassportInfo = (overrides: Partial<PassportInfo> = {}): PassportInfo => ({
  active: true,
  tokenId: "0.0.123",
  serialNumber: 1,
  tier: "bronze",
  capabilities: ["api_call", "payment"],
  did: "did:hcs:0.0.123:1",
  owner: "0.0.456",
  issuedAt: 1700000000,
  endpoint: "https://agent.example.com",
  ...overrides,
});

describe("verify routes", () => {
  let app: Hono;

  beforeEach(() => {
    vi.resetAllMocks();
    vi.stubEnv("PASSPORT_TOKEN_ID", "0.0.123");
    app = new Hono();
    app.route("/", verifyRoutes);
  });

  describe("GET /passport/:tokenId/:serial", () => {
    it("returns 200 with passport info for active NFT", async () => {
      vi.mocked(getPassportInfo).mockResolvedValueOnce(mockPassportInfo());

      const res = await app.request("/passport/0.0.123/1");

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.active).toBe(true);
      expect(body.tokenId).toBe("0.0.123");
      expect(body.serialNumber).toBe(1);
      expect(body.tier).toBe("bronze");
      expect(body.capabilities).toEqual(["api_call", "payment"]);
      expect(body.did).toBe("did:hcs:0.0.123:1");
      expect(body.owner).toBe("0.0.456");
      expect(body.issuedAt).toBe(1700000000);
    });

    it("returns 200 with active=false for deleted (revoked) NFT", async () => {
      vi.mocked(getPassportInfo).mockResolvedValueOnce(
        mockPassportInfo({ active: false }),
      );

      const res = await app.request("/passport/0.0.123/1");

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.active).toBe(false);
      expect(body.tier).toBe("bronze");
    });

    it("returns 404 for non-existent NFT", async () => {
      vi.mocked(getPassportInfo).mockResolvedValueOnce(null);

      const res = await app.request("/passport/0.0.999/999");

      expect(res.status).toBe(404);
    });

    it("returns 200 with passport info even if IPFS metadata fetch fails", async () => {
      vi.mocked(getPassportInfo).mockResolvedValueOnce(
        mockPassportInfo({ tier: null, capabilities: [] }),
      );

      const res = await app.request("/passport/0.0.123/1");

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.active).toBe(true);
      expect(body.tier).toBeNull();
      expect(body.capabilities).toEqual([]);
    });
  });

  describe("GET /passport/address/:address", () => {
    it("returns 200 with passports for an address", async () => {
      vi.mocked(listPassportsByAddress).mockResolvedValueOnce([
        mockPassportInfo({ serialNumber: 1 }),
        mockPassportInfo({ serialNumber: 2, tier: "silver", capabilities: ["orchestration"] }),
      ]);

      const res = await app.request("/passport/address/0.0.456");

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.passports).toHaveLength(2);
      expect(body.passports[0].serialNumber).toBe(1);
      expect(body.passports[1].serialNumber).toBe(2);
      expect(body.passports[1].tier).toBe("silver");
    });

    it("returns 200 with empty array for address with no passports", async () => {
      vi.mocked(listPassportsByAddress).mockResolvedValueOnce([]);

      const res = await app.request("/passport/address/0.0.789");

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.passports).toEqual([]);
    });
  });

  describe("GET /passports", () => {
    it("returns 200 with all passports (paginated)", async () => {
      vi.mocked(listAllPassports).mockResolvedValueOnce([
        mockPassportInfo({ serialNumber: 1 }),
        mockPassportInfo({ serialNumber: 2, tier: "gold" }),
        mockPassportInfo({ serialNumber: 3, active: false, tier: "silver" }),
      ]);

      const res = await app.request("/passports");

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.passports).toHaveLength(3);
      expect(body.passports[0].active).toBe(true);
      expect(body.passports[1].tier).toBe("gold");
      expect(body.passports[2].active).toBe(false);
    });

    it("returns 200 with empty array when no passports exist", async () => {
      vi.mocked(listAllPassports).mockResolvedValueOnce([]);

      const res = await app.request("/passports");

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.passports).toEqual([]);
    });

    it("passes tokenId query param to mirror service", async () => {
      vi.mocked(listAllPassports).mockResolvedValueOnce([]);

      await app.request("/passports?tokenId=0.0.999");

      expect(listAllPassports).toHaveBeenCalledWith("0.0.999");
    });

    it("uses PASSPORT_TOKEN_ID env when no tokenId query param", async () => {
      vi.stubEnv("PASSPORT_TOKEN_ID", "0.0.555");
      vi.mocked(listAllPassports).mockResolvedValueOnce([]);

      await app.request("/passports");

      expect(listAllPassports).toHaveBeenCalledWith("0.0.555");
    });
  });
});
