import { describe, it, expect, beforeEach } from "vitest";
import { Hono } from "hono";
import { serveStatic } from "@hono/node-server/serve-static";

describe("SLICE-18-2: Static assets", () => {
  let app: Hono;

  beforeEach(() => {
    app = new Hono();
    app.use("/icons/*", serveStatic({ root: "./public" }));
  });

  describe("GET /icons/og-image.png", () => {
    it("returns 200 with image/png content type", async () => {
      const res = await app.request("/icons/og-image.png");
      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toContain("image/png");
    });

    it("returns non-empty body (content-length > 0)", async () => {
      const res = await app.request("/icons/og-image.png");
      const buf = await res.arrayBuffer();
      expect(buf.byteLength).toBeGreaterThan(0);
    });

    it("starts with PNG magic bytes (\\x89PNG)", async () => {
      const res = await app.request("/icons/og-image.png");
      const buf = new Uint8Array(await res.arrayBuffer());
      expect(buf[0]).toBe(0x89);
      expect(buf[1]).toBe(0x50); // P
      expect(buf[2]).toBe(0x4e); // N
      expect(buf[3]).toBe(0x47); // G
    });

    it("is smaller than 300KB", async () => {
      const res = await app.request("/icons/og-image.png");
      const buf = await res.arrayBuffer();
      expect(buf.byteLength).toBeLessThan(300 * 1024);
    });

    it("has correct dimensions (1200×630) in IHDR chunk", async () => {
      const res = await app.request("/icons/og-image.png");
      const buf = new Uint8Array(await res.arrayBuffer());
      // PNG IHDR: width at bytes 16-19, height at bytes 20-23 (big-endian)
      const view = new DataView(buf.buffer);
      const width = view.getUint32(16);
      const height = view.getUint32(20);
      expect(width).toBe(1200);
      expect(height).toBe(630);
    });
  });
});
