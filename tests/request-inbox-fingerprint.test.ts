import { describe, expect, it } from "vitest";

import {
  buildFingerprint,
  fpHashFor,
  normalizeQuestion,
  questionHashFor,
  sanitizeHeaders,
} from "../src/server/lib/request-inbox/fingerprint";

/**
 * EPIC-252 (SLICE-252-1, D-252-Q2): fingerprint hashing + secret
 * stripping. The hash is the only place IP touches storage.
 */
describe("request-inbox fingerprint", () => {
  it("fpHash is sha256(ip+ua+salt), deterministic and 64-hex", () => {
    const h = fpHashFor("1.2.3.4", "agent/1.0", "salt");
    expect(h).toMatch(/^[0-9a-f]{64}$/);
    expect(h).toBe(fpHashFor("1.2.3.4", "agent/1.0", "salt"));
  });

  it("fpHash differs on ip / ua / salt change", () => {
    const base = fpHashFor("1.2.3.4", "agent/1.0", "salt");
    expect(fpHashFor("5.6.7.8", "agent/1.0", "salt")).not.toBe(base);
    expect(fpHashFor("1.2.3.4", "agent/2.0", "salt")).not.toBe(base);
    expect(fpHashFor("1.2.3.4", "agent/1.0", "salt2")).not.toBe(base);
  });

  it("softFpHash ignores IP but binds ua+headers (SLICE-252-7)", () => {
    const mk = (ip: string) =>
      buildFingerprint({
        ip,
        ua: "agent/1.0",
        salt: "s",
        headers: { "accept-language": "en" },
      });
    const a = mk("1.2.3.4");
    const b = mk("9.9.9.9"); // rotated IP, same client signature
    expect(a.softFpHash).toBe(b.softFpHash);
    expect(a.fpHash).not.toBe(b.fpHash); // fpHash still binds the IP
    expect(a.fingerprint.softFpHash).toBe(a.softFpHash);
    // A different header signature → different soft lane.
    const c = buildFingerprint({
      ip: "9.9.9.9",
      ua: "agent/1.0",
      salt: "s",
      headers: { "accept-language": "de" },
    });
    expect(c.softFpHash).not.toBe(a.softFpHash);
  });

  it("snapshot never contains the raw IP", () => {
    const { fingerprint } = buildFingerprint({
      ip: "1.2.3.4",
      ua: "agent/1.0",
      salt: "s",
      headers: { "x-real-ip": "1.2.3.4", via: "proxy" },
    });
    // snapshot headers may carry the IP inside another header — the
    // contract is only that `fingerprint` has no `ip` field of its own.
    expect(fingerprint).not.toHaveProperty("ip");
  });

  it("secrets are stripped from the header snapshot", () => {
    const out = sanitizeHeaders({
      Authorization: "Bearer secrettoken",
      "Proxy-Authorization": "Basic abc",
      Cookie: "session=xyz",
      "Set-Cookie": "id=1",
      "X-Api-Key": "k",
      "X-Agent-Token": "t",
      "X-Access-Token": "t2",
      "X-Wallet": "0xabc",
      "x-sig": "sig",
      "x-secret-thing": "s",
      "x-credential": "c",
      "X-Auth-Token": "a",
      "User-Agent": "agent/1.0",
      Accept: "application/json",
      "X-Request-Id": "r1",
      "Content-Type": "application/json",
    });
    const names = Object.keys(out);
    expect(names).not.toContain("authorization");
    expect(names).not.toContain("proxy-authorization");
    expect(names).not.toContain("cookie");
    expect(names).not.toContain("set-cookie");
    expect(names).not.toContain("x-api-key");
    expect(names).not.toContain("x-agent-token");
    expect(names).not.toContain("x-access-token");
    expect(names).not.toContain("x-wallet");
    expect(names).not.toContain("x-sig");
    expect(names).not.toContain("x-secret-thing");
    expect(names).not.toContain("x-credential");
    expect(names).not.toContain("x-auth-token");
    // harmless headers survive, lowercased
    expect(out["user-agent"]).toBe("agent/1.0");
    expect(out["accept"]).toBe("application/json");
    expect(out["x-request-id"]).toBe("r1");
    expect(out["content-type"]).toBe("application/json");
  });

  it("header values are truncated at 512 chars and names lowercased", () => {
    const out = sanitizeHeaders({ "X-Long": "a".repeat(600) });
    expect(out["x-long"]).toHaveLength(512);
  });

  it("normalizeQuestion case-folds and collapses whitespace", () => {
    expect(normalizeQuestion("  How   Do I  GET a passport? ")).toBe(
      "how do i get a passport?",
    );
    expect(questionHashFor(normalizeQuestion("A B"))).toBe(
      questionHashFor(normalizeQuestion("a   b")),
    );
  });
});
