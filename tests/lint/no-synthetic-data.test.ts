/**
 * SLICE-181-3 (MYPROJ-2526): honest-zero lint — D-181-5.
 *
 * Scans every HTTP route module for synthetic-data beacons in served
 * payloads: lorem text, example.com URLs, all-zero addresses,
 * placeholder/TODO strings inside response literals.
 *
 * Comments are stripped before scanning (TODOs in comments are normal
 * dev traffic; they are only dishonest when they reach a response body).
 *
 * Exceptions live in ALLOWLIST — each entry is file-scoped, cites a
 * reason, and MUST still match the file (a stale exception is a test
 * failure, so the list cannot quietly rot).
 */

import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const ROUTES_DIR = join(__dirname, "../../src/server/routes");

const ZERO_ADDR = /0x0{20,}/;

interface Beacon {
  name: string;
  re: RegExp;
}

const BEACONS: Beacon[] = [
  { name: "lorem", re: /lorem/i },
  { name: "example.com", re: /example\.com/i },
  { name: "zero-address", re: ZERO_ADDR },
  // `placeholder=` (HTML input attr) and `placeholder-*` (Tailwind class)
  // are presentation, not data — only key/value uses are beacons.
  { name: "placeholder", re: /\bplaceholder(?![\s=-])/i },
  { name: "todo", re: /TODO/ },
];

/** file → beacon patterns that are legitimate in it. */
const ALLOWLIST: Record<string, Beacon[]> = {
  // Schema example URL in describeRoute docs — not served data.
  "agent-knowledge.ts": [{ name: "example.com", re: /your-api\.example\.com/ }],
  // Real on-chain zero address used as a genuine "unset" sentinel.
  "attestcoin.ts": [{ name: "zero-address", re: ZERO_ADDR }],
  "trust.ts": [{ name: "zero-address", re: ZERO_ADDR }],
  "venue-api-helpers.ts": [{ name: "zero-address", re: ZERO_ADDR }],
  "venue-job-create.ts": [{ name: "zero-address", re: ZERO_ADDR }],
};

function* walk(dir: string): Generator<string> {
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) yield* walk(p);
    else if (entry.endsWith(".ts")) yield p;
  }
}

function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:"'`])\/\/[^\n]*/g, "$1");
}

describe("no-synthetic-data lint", () => {
  const files = [...walk(ROUTES_DIR)];
  const stripped = new Map<string, string>(
    files.map((f) => [relative(ROUTES_DIR, f), stripComments(readFileSync(f, "utf8"))]),
  );

  it("route responses contain no synthetic beacons outside the allowlist", () => {
    const violations: string[] = [];
    for (const [file, src] of stripped) {
      for (const beacon of BEACONS) {
        const allowed = (ALLOWLIST[file] ?? []).some((a) => a.name === beacon.name);
        if (!allowed) {
          const lines = src.split("\n");
          lines.forEach((line, i) => {
            if (beacon.re.test(line)) {
              violations.push(`${file}:${i + 1} ${beacon.name}`);
            }
          });
        }
      }
    }
    expect(violations).toEqual([]);
  });

  it("every allowlist exception still matches (no stale exceptions)", () => {
    for (const [file, allowed] of Object.entries(ALLOWLIST)) {
      const src = stripped.get(file);
      expect(src, `allowlisted file ${file} missing`).toBeDefined();
      for (const a of allowed) {
        expect(
          a.re.test(src!),
          `${file}: allowlisted ${a.name} pattern no longer present`,
        ).toBe(true);
      }
    }
  });
});
