import { describe, it, expect } from "vitest";
import { Hono } from "hono";
import { getAcceptedFormat } from "../src/server/lib/content-negotiation";

describe("SLICE-17-5: Content Negotiation", () => {
  describe("getAcceptedFormat()", () => {
    function makeApp() {
      const app = new Hono();
      app.get("/test", (c) => {
        const fmt = getAcceptedFormat(c);
        return c.json({ format: fmt });
      });
      return app;
    }

    async function getFormat(accept?: string) {
      const app = makeApp();
      const headers: Record<string, string> = {};
      if (accept !== undefined) headers["Accept"] = accept;
      const res = await app.request("http://localhost/test", { headers });
      const body = await res.json();
      return body.format;
    }

    it("returns 'json' for Accept: application/json", async () => {
      expect(await getFormat("application/json")).toBe("json");
    });

    it("returns 'markdown' for Accept: text/markdown", async () => {
      expect(await getFormat("text/markdown")).toBe("markdown");
    });

    it("returns 'html' for missing Accept header", async () => {
      expect(await getFormat(undefined)).toBe("html");
    });

    it("returns 'html' for Accept: text/html", async () => {
      expect(await getFormat("text/html")).toBe("html");
    });

    it("returns 'html' for Accept: */*", async () => {
      expect(await getFormat("*/*")).toBe("html");
    });

    it("returns 'json' for Accept with multiple types including json", async () => {
      expect(await getFormat("text/html, application/json")).toBe("json");
    });
  });
});
