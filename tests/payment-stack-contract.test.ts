import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

/**
 * SLICE-157-5: payment-stack contract test.
 *
 * Invariant: exactly ONE facilitator boundary — the circle-payments runtime
 * (`lib/circle-payments.ts`) and intentional leftovers (Hedera gate in
 * `wiring/payments.ts` per D1-157; `middleware/x402-base.ts` pending the
 * 157-4 retire/delegate decision). Any new legacy x402 stack wiring
 * (HTTPFacilitatorClient / x402ResourceServer / paymentMiddleware / the
 * @x402/hono adapter) outside the allowlist is a regression — this test fails.
 */

const SRC = join(__dirname, "..", "src");

const FORBIDDEN: { name: string; re: RegExp }[] = [
  { name: "HTTPFacilitatorClient", re: /\bHTTPFacilitatorClient\b/ },
  { name: "ExactEvmScheme", re: /\bExactEvmScheme\b/ },
  { name: "x402ResourceServer", re: /\bx402ResourceServer\b/ },
  {
    name: "paymentMiddlewareFromHTTPServer",
    re: /\bpaymentMiddlewareFromHTTPServer\b/,
  },
  { name: "paymentMiddleware(", re: /\bpaymentMiddleware\s*\(/ },
  { name: "@x402/hono import", re: /from\s+["']@x402\/hono["']/ },
  { name: "X402FacilitatorClient", re: /\bX402FacilitatorClient\b/ },
  { name: "HTTPFacilitator", re: /\bHTTPFacilitator\b/ },
];

/** Files where legacy facilitator symbols are still intentional:
 *  - lib/circle-payments.ts: the runtime itself (the single boundary).
 *  - wiring/payments.ts: Hedera gate stays (D1-157) + x402-base call site (157-4 pending).
 *  - middleware/x402-base.ts: pending retire/delegate decision (157-4). */
const ALLOWLIST = new Set([
  "src/server/lib/circle-payments.ts",
  "src/server/wiring/payments.ts",
  "src/server/middleware/x402-base.ts",
]);

interface Violation {
  file: string;
  symbol: string;
  line: number;
}

export function sweep(
  entries: { path: string; content: string }[],
): Violation[] {
  const violations: Violation[] = [];
  for (const { path, content } of entries) {
    if (ALLOWLIST.has(path)) continue;
    const lines = content.split("\n");
    for (const { name, re } of FORBIDDEN) {
      lines.forEach((line, i) => {
        if (re.test(line)) violations.push({ file: path, symbol: name, line: i + 1 });
      });
    }
  }
  return violations;
}

function collectSrc(dir: string, prefix = ""): { path: string; content: string }[] {
  const out: { path: string; content: string }[] = [];
  for (const entry of readdirSync(dir)) {
    const abs = join(dir, entry);
    const rel = prefix ? `${prefix}/${entry}` : `src/${entry}`;
    if (statSync(abs).isDirectory()) {
      if (entry === "node_modules" || entry.startsWith(".")) continue;
      out.push(...collectSrc(abs, rel));
    } else if (entry.endsWith(".ts")) {
      out.push({ path: rel, content: readFileSync(abs, "utf-8") });
    }
  }
  return out;
}

describe("SLICE-157-5: single facilitator boundary (payment-stack contract)", () => {
  it("no forbidden legacy x402 symbols outside the allowlist", () => {
    const violations = sweep(collectSrc(SRC));
    expect(
      violations.map((v) => `${v.file}:${v.line} ${v.symbol}`),
    ).toEqual([]);
  });

  it("self-check: sweep flags a violating file", () => {
    const violations = sweep([
      {
        path: "src/server/routes/evil.ts",
        content:
          'import { paymentMiddleware } from "@x402/hono";\nconst mw = paymentMiddleware({});\n',
      },
    ]);
    const symbols = violations.map((v) => v.symbol);
    expect(symbols).toContain("paymentMiddleware(");
    expect(symbols).toContain("@x402/hono import");
  });

  it("self-check: allowlisted files are skipped", () => {
    const violations = sweep([
      {
        path: "src/server/wiring/payments.ts",
        content: 'import { HTTPFacilitatorClient } from "@x402/core/server";',
      },
    ]);
    expect(violations).toEqual([]);
  });
});
