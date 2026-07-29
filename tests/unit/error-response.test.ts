import { describe, it, expect } from "vitest";
import { Hono } from "hono";
import { errorResponse } from "../../src/server/lib/error-response";
import { ErrorCodes } from "../../src/server/lib/error-codes";

describe("errorResponse", () => {
  it("returns correct body shape with error and code", async () => {
    const app = new Hono();
    app.get("/test", (c) => errorResponse(c, 400, ErrorCodes.INVALID_JSON, "Invalid JSON body"));
    const res = await app.request("http://localhost/test");
    const body = await res.json();
    expect(body.error).toBe("Invalid JSON body");
    expect(body.code).toBe("INVALID_JSON");
    expect(body.retryable).toBeUndefined();
    expect(body.hint).toBeUndefined();
    expect(res.status).toBe(400);
  });

  it("includes retryable when provided", async () => {
    const app = new Hono();
    app.get("/test", (c) =>
      errorResponse(c, 429, ErrorCodes.RATE_LIMITED, "Too Many Requests", { retryable: true }),
    );
    const res = await app.request("http://localhost/test");
    const body = await res.json();
    expect(body.retryable).toBe(true);
    expect(body.hint).toBeUndefined();
  });

  it("includes hint when provided", async () => {
    const app = new Hono();
    app.get("/test", (c) =>
      errorResponse(c, 404, ErrorCodes.PASSPORT_NOT_FOUND, "Passport not found", {
        hint: "Check tokenId/serial on HashScan",
      }),
    );
    const res = await app.request("http://localhost/test");
    const body = await res.json();
    expect(body.hint).toBe("Check tokenId/serial on HashScan");
    expect(body.retryable).toBeUndefined();
  });

  it("includes both retryable and hint when provided", async () => {
    const app = new Hono();
    app.get("/test", (c) =>
      errorResponse(c, 500, ErrorCodes.HCS_SUBMISSION_FAILED, "HCS failed", {
        retryable: true,
        hint: "Retry with backoff after 5s",
      }),
    );
    const res = await app.request("http://localhost/test");
    const body = await res.json();
    expect(body.retryable).toBe(true);
    expect(body.hint).toBe("Retry with backoff after 5s");
  });

  it("omits optional fields when not provided", async () => {
    const app = new Hono();
    app.get("/test", (c) =>
      errorResponse(c, 403, ErrorCodes.PASSPORT_REVOKED, "Passport revoked"),
    );
    const res = await app.request("http://localhost/test");
    const body = await res.json();
    expect(body).toEqual({ error: "Passport revoked", code: "PASSPORT_REVOKED" });
  });
});
