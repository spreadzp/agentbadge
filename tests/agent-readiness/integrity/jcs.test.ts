import { describe, it, expect } from "vitest";
import { canonicalizeJson } from "../../../src/agent-readiness/integrity/jcs";

describe("SLICE-36-1: JCS Canonicalization (RFC 8785)", () => {
  it("key order independent: {b:1,a:2} === {a:2,b:1}", () => {
    expect(canonicalizeJson({ b: 1, a: 2 })).toBe(canonicalizeJson({ a: 2, b: 1 }));
  });

  it("produces sorted output: {b:1,a:2} === {\"a\":2,\"b\":1}", () => {
    expect(canonicalizeJson({ b: 1, a: 2 })).toBe('{"a":2,"b":1}');
  });

  it("array elements canonicalized, array order preserved", () => {
    expect(canonicalizeJson([{ z: 1 }, { a: 1 }])).toBe('[{"z":1},{"a":1}]');
  });

  it("Unicode strings preserved", () => {
    expect(canonicalizeJson("héllo")).toBe('"héllo"');
  });

  it("control chars escaped as \\uXXXX", () => {
    expect(canonicalizeJson("\u0000tab")).toBe('"\\u0000tab"');
  });

  it("minimal number: 3.0 → 3", () => {
    expect(canonicalizeJson(3.0)).toBe("3");
  });

  it("null → null", () => {
    expect(canonicalizeJson(null)).toBe("null");
  });

  it("true → true", () => {
    expect(canonicalizeJson(true)).toBe("true");
  });

  it("false → false", () => {
    expect(canonicalizeJson(false)).toBe("false");
  });

  it("nested objects canonicalized recursively", () => {
    const input = { outer: { d: 4, c: 3, b: 2, a: 1 } };
    expect(canonicalizeJson(input)).toBe('{"outer":{"a":1,"b":2,"c":3,"d":4}}');
  });

  it("nested arrays inside objects", () => {
    const input = { list: [3, 1, 2] };
    expect(canonicalizeJson(input)).toBe('{"list":[3,1,2]}');
  });

  it("empty object → {}", () => {
    expect(canonicalizeJson({})).toBe("{}");
  });

  it("empty array → []", () => {
    expect(canonicalizeJson([])).toBe("[]");
  });

  it("string with quotes escaped", () => {
    expect(canonicalizeJson('say "hi"')).toBe('"say \\"hi\\""');
  });

  it("string with backslash escaped", () => {
    expect(canonicalizeJson("back\\slash")).toBe('"back\\\\slash"');
  });

  it("string with newline escaped", () => {
    expect(canonicalizeJson("line1\nline2")).toBe('"line1\\nline2"');
  });

  it("float number preserved", () => {
    expect(canonicalizeJson(3.14)).toBe("3.14");
  });

  it("negative number", () => {
    expect(canonicalizeJson(-42)).toBe("-42");
  });

  it("zero", () => {
    expect(canonicalizeJson(0)).toBe("0");
  });

  it("round-trips through JSON.parse", () => {
    const input = { b: [{ z: 1, a: 2 }], a: "hello", c: null, d: true };
    const canonical = canonicalizeJson(input);
    const parsed = JSON.parse(canonical);
    expect(parsed).toEqual({ b: [{ z: 1, a: 2 }], a: "hello", c: null, d: true });
  });

  it("deeply nested structure", () => {
    const input = { c: { b: { a: [1, 2, { z: 0, y: 9 }] } } };
    expect(canonicalizeJson(input)).toBe('{"c":{"b":{"a":[1,2,{"y":9,"z":0}]}}}');
  });
});
