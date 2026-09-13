import { describe, it, expect } from "vitest";
import { canonicalize } from "../../../src/agent-readiness/trust/canonical-json";

/**
 * SLICE-102-1: Canonical JSON serializer tests.
 */

describe("SLICE-102-1: canonicalize()", () => {
  it("produces sorted keys for object", () => {
    const result = canonicalize({ b: 1, a: 2 });
    expect(result).toBe('{"a":2,"b":1}');
  });

  it("produces same output regardless of key insertion order", () => {
    const obj1 = { z: 1, a: 2, m: 3 };
    const obj2 = { a: 2, m: 3, z: 1 };
    expect(canonicalize(obj1)).toBe(canonicalize(obj2));
  });

  it("handles nested objects with sorted keys", () => {
    const result = canonicalize({ outer: { d: 4, a: 1 } });
    expect(result).toBe('{"outer":{"a":1,"d":4}}');
  });

  it("handles arrays preserving order", () => {
    const result = canonicalize([3, 1, 2]);
    expect(result).toBe("[3,1,2]");
  });

  it("handles strings with special characters", () => {
    const result = canonicalize("hello \"world\"");
    expect(result).toBe('"hello \\"world\\""');
  });

  it("handles null", () => {
    expect(canonicalize(null)).toBe("null");
  });

  it("handles booleans", () => {
    expect(canonicalize(true)).toBe("true");
    expect(canonicalize(false)).toBe("false");
  });

  it("handles integers without decimal point", () => {
    expect(canonicalize(42)).toBe("42");
  });

  it("handles floats", () => {
    expect(canonicalize(3.14)).toBe("3.14");
  });

  it("omits undefined values from objects", () => {
    const result = canonicalize({ a: 1, b: undefined, c: 2 });
    expect(result).toBe('{"a":1,"c":2}');
  });

  it("handles empty object and array", () => {
    expect(canonicalize({})).toBe("{}");
    expect(canonicalize([])).toBe("[]");
  });

  it("produces deterministic output for complex nested structure", () => {
    const obj = {
      c: [3, 1, 2],
      a: { z: "test", x: 123 },
      b: "hello",
    };
    const result1 = canonicalize(obj);
    const result2 = canonicalize(JSON.parse(JSON.stringify(obj)));
    expect(result1).toBe(result2);
  });
});
