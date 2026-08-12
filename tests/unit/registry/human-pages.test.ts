import { describe, it, expect } from "vitest";
import { makeTestApp, setupMockEnv } from "../../e2e/helpers";

setupMockEnv();
const app = makeTestApp();

describe("SLICE-56-3: Human Pages MVP", () => {
  describe("AC-3.1: /about (redirect target of /team) shows registry data", () => {
    it("/team redirects to /about with 301", async () => {
      const res = await app.request("/team", { redirect: "manual" });
      expect(res.status).toBe(301);
      expect(res.headers.get("location")).toBe("/about");
    });

    it("/about returns 200 HTML", async () => {
      const res = await app.request("/about");
      expect(res.status).toBe(200);
      const text = await res.text();
      expect(text).toContain("<!DOCTYPE html>");
    });

    it("/about shows team members (who)", async () => {
      const res = await app.request("/about");
      const text = await res.text();
      expect(text).toContain("Team");
    });

    it("/about shows capabilities from registry", async () => {
      const res = await app.request("/about");
      const text = await res.text();
      expect(text).toContain("Capabilities");
    });

    it("/about shows services from registry", async () => {
      const res = await app.request("/about");
      const text = await res.text();
      expect(text).toContain("Services");
    });

    it("/about shows availability from registry", async () => {
      const res = await app.request("/about");
      const text = await res.text();
      expect(text).toContain("Availability");
    });

    it("/about shows contact from registry", async () => {
      const res = await app.request("/about");
      const text = await res.text();
      expect(text).toContain("Contact");
    });
  });

  describe("AC-3.2: Footer and homepage blocks", () => {
    it("footer contains Engineering section", async () => {
      const res = await app.request("/about");
      const text = await res.text();
      expect(text).toContain("Engineering");
    });

    it("footer has link to /services", async () => {
      const res = await app.request("/about");
      const text = await res.text();
      expect(text).toMatch(/href="\/services"/);
    });

    it("footer has link to /work-with-us", async () => {
      const res = await app.request("/about");
      const text = await res.text();
      expect(text).toMatch(/href="\/work-with-us"/);
    });

    it("homepage has 'Need more than a score?' block", async () => {
      const res = await app.request("/");
      const text = await res.text();
      expect(text).toContain("Need more than a score?");
    });

    it("homepage block links to /work-with-us", async () => {
      const res = await app.request("/");
      const text = await res.text();
      expect(text).toContain("Need more than a score?");
      expect(text).toMatch(/href="\/work-with-us"/);
    });
  });

  describe("AC-3.2: /services and /work-with-us still work", () => {
    it("/services returns 200 with service names", async () => {
      const res = await app.request("/services");
      expect(res.status).toBe(200);
      const text = await res.text();
      expect(text).toContain("Services Catalog");
    });

    it("/work-with-us returns 200 with engagement info", async () => {
      const res = await app.request("/work-with-us");
      expect(res.status).toBe(200);
      const text = await res.text();
      expect(text).toContain("Work With");
      expect(text).toContain("Engagement");
    });
  });
});
