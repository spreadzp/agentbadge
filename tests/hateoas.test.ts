import { describe, it, expect } from "vitest";
import { passportLinks, agentLinks, taskLinks } from "../src/server/lib/hateoas";

describe("HATEOAS link builders", () => {
  describe("passportLinks", () => {
    it("returns self, did_document, audit, upgrade links", () => {
      const links = passportLinks("0.0.123", 1);
      expect(links.self).toEqual({ href: "/passport/0.0.123/1" });
      expect(links.did_document).toEqual({ href: "/did/did:hcs:0.0.123:1" });
      expect(links.audit).toEqual({ href: "/audit/0.0.123/1" });
      expect(links.upgrade).toEqual({ href: "/passport/0.0.123/1/upgrade", method: "POST" });
    });

    it("all hrefs start with /", () => {
      const links = passportLinks("0.0.456", 2);
      for (const key of Object.keys(links)) {
        expect(links[key].href.startsWith("/")).toBe(true);
      }
    });
  });

  describe("agentLinks", () => {
    it("returns self, did_document, a2a_send links", () => {
      const did = "did:hcs:0.0.123:1";
      const links = agentLinks(did);
      expect(links.self).toEqual({ href: `/agents/${encodeURIComponent(did)}` });
      expect(links.did_document).toEqual({ href: `/did/${encodeURIComponent(did)}` });
      expect(links.a2a_send).toEqual({ href: "/a2a/send", method: "POST" });
    });

    it("encodes DID with colons", () => {
      const did = "did:hcs:0.0.123:1";
      const links = agentLinks(did);
      expect(links.self.href).toContain(encodeURIComponent(":"));
    });
  });

  describe("taskLinks", () => {
    it("includes claim link for posted tasks", () => {
      const links = taskLinks("task-1", "did:hcs:0.0.123:1", "posted");
      expect(links.self).toEqual({ href: "/market/tasks/task-1" });
      expect(links.poster).toEqual({ href: `/agents/${encodeURIComponent("did:hcs:0.0.123:1")}` });
      expect(links.claim).toEqual({ href: "/market/tasks/task-1/claim", method: "POST" });
      expect(links.deliver).toBeUndefined();
      expect(links.complete).toBeUndefined();
    });

    it("includes deliver link for claimed tasks", () => {
      const links = taskLinks("task-2", "did:hcs:0.0.456:2", "claimed");
      expect(links.deliver).toEqual({ href: "/market/tasks/task-2/deliver", method: "POST" });
      expect(links.claim).toBeUndefined();
      expect(links.complete).toBeUndefined();
    });

    it("includes complete link for delivered tasks", () => {
      const links = taskLinks("task-3", "did:hcs:0.0.789:3", "delivered");
      expect(links.complete).toEqual({ href: "/market/tasks/task-3/complete", method: "POST" });
      expect(links.claim).toBeUndefined();
      expect(links.deliver).toBeUndefined();
    });

    it("always includes self and poster regardless of status", () => {
      const links = taskLinks("task-4", "did:hcs:0.0.999:9", "completed");
      expect(links.self).toBeDefined();
      expect(links.poster).toBeDefined();
      expect(links.claim).toBeUndefined();
      expect(links.deliver).toBeUndefined();
      expect(links.complete).toBeUndefined();
    });
  });
});
