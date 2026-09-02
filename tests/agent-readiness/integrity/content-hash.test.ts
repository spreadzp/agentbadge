import { describe, it, expect } from "vitest";
import { computeContentHash } from "../../../src/agent-readiness/integrity/content-hash";

describe("SLICE-36-2: Content Hash — SHA-256", () => {
  it("returns a 64-character lowercase hex string", () => {
    const hash = computeContentHash({ a: 1 });
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("same body → same hash (deterministic)", () => {
    const body = { a: 1, b: "hello", c: [1, 2, 3] };
    expect(computeContentHash(body)).toBe(computeContentHash(body));
  });

  it("reordered keys → same hash (JCS canonicalization)", () => {
    const body1 = { b: "hello", a: 1, c: [1, 2, 3] };
    const body2 = { a: 1, b: "hello", c: [1, 2, 3] };
    expect(computeContentHash(body1)).toBe(computeContentHash(body2));
  });

  it("changed assertion → different hash", () => {
    const body1 = { a: 1, status: "VERIFIED" };
    const body2 = { a: 1, status: "GAP" };
    expect(computeContentHash(body1)).not.toBe(computeContentHash(body2));
  });

  it("any field change → different hash", () => {
    const body1 = { a: 1, b: 2 };
    const body2 = { a: 1, b: 3 };
    expect(computeContentHash(body1)).not.toBe(computeContentHash(body2));
  });

  it("is a pure function — no side effects", () => {
    const body = { a: 1, b: { c: 2 } };
    const h1 = computeContentHash(body);
    const h2 = computeContentHash(body);
    expect(h1).toBe(h2);
  });

  it("empty object produces valid hash", () => {
    const hash = computeContentHash({});
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("nested objects canonicalized before hashing", () => {
    const body1 = { outer: { z: 1, a: 2 } };
    const body2 = { outer: { a: 2, z: 1 } };
    expect(computeContentHash(body1)).toBe(computeContentHash(body2));
  });
});
