import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { Hono } from "hono";
import { attestcoinRoutes, setAttestcoinRouteConfig, setWorkerStatus } from "../../src/server/routes/attestcoin";

function makeApp() {
  const app = new Hono();
  app.route("/", attestcoinRoutes);
  return app;
}

describe("Attestcoin routes", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    setAttestcoinRouteConfig({
      enabled: false,
      creditcoinRpcUrl: "http://localhost:8546",
      taskStateAddr: "0x" + "3".repeat(40),
    });
    setWorkerStatus("workerA", false);
    setWorkerStatus("workerB", false);
    setWorkerStatus("aiAgent", false);
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    setAttestcoinRouteConfig({
      enabled: false,
      creditcoinRpcUrl: "http://localhost:8546",
      taskStateAddr: "0x" + "3".repeat(40),
    });
  });

  describe("when ATTESTCOIN_ENABLED=false", () => {
    it("GET /api/attestcoin/tasks returns 503", async () => {
      const app = makeApp();
      const res = await app.request("/api/attestcoin/tasks");
      expect(res.status).toBe(503);
      const body = await res.json();
      expect(body.error).toBe("Attestcoin not enabled");
    });

    it("GET /api/attestcoin/tasks/:taskId returns 503", async () => {
      const app = makeApp();
      const res = await app.request("/api/attestcoin/tasks/1");
      expect(res.status).toBe(503);
    });

    it("POST /api/attestcoin/verify returns 503", async () => {
      const app = makeApp();
      const res = await app.request("/api/attestcoin/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ txHash: "0x" + "a".repeat(64) }),
      });
      expect(res.status).toBe(503);
    });

    it("GET /api/attestcoin/status returns 200 with enabled=false", async () => {
      const app = makeApp();
      const res = await app.request("/api/attestcoin/status");
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.attestcoinEnabled).toBe(false);
      expect(body.workerA).toBe(false);
      expect(body.workerB).toBe(false);
      expect(body.aiAgent).toBe(false);
    });
  });

  describe("when ATTESTCOIN_ENABLED=true", () => {
    beforeEach(() => {
      setAttestcoinRouteConfig({
        enabled: true,
        creditcoinRpcUrl: "http://localhost:8546",
        taskStateAddr: "0x" + "3".repeat(40),
      });
      setWorkerStatus("workerA", true);
      setWorkerStatus("workerB", true);
      setWorkerStatus("aiAgent", true);
    });

    it("GET /api/attestcoin/status returns 200 with worker status", async () => {
      const app = makeApp();
      const res = await app.request("/api/attestcoin/status");
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.attestcoinEnabled).toBe(true);
      expect(body.workerA).toBe(true);
      expect(body.workerB).toBe(true);
      expect(body.aiAgent).toBe(true);
    });

    it("POST /api/attestcoin/verify with valid txHash returns 200", async () => {
      const app = makeApp();
      const res = await app.request("/api/attestcoin/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ txHash: "0x" + "a".repeat(64) }),
      });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.txHash).toBe("0x" + "a".repeat(64));
      expect(body.verified).toBe(false);
      expect(body.taskId).toBe("0");
    });

    it("POST /api/attestcoin/verify with invalid txHash returns 400", async () => {
      const app = makeApp();
      const res = await app.request("/api/attestcoin/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ txHash: "0xinvalid" }),
      });
      expect(res.status).toBe(400);
    });

    it("POST /api/attestcoin/verify with missing body returns 400", async () => {
      const app = makeApp();
      const res = await app.request("/api/attestcoin/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "not json",
      });
      expect(res.status).toBe(400);
    });
  });
});
