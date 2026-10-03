/**
 * SLICE-155-7: docs link-check — docs/AGENT-WALLET internal links
 * resolve, dogfood runbook exists and is executable.
 */
import { describe, it, expect } from "vitest";
import { existsSync, readFileSync, statSync } from "node:fs";
import { join, dirname, resolve } from "node:path";

const SERVER = resolve(__dirname, "..");
const DOCS = resolve(SERVER, "..", "..", "docs", "AGENT-WALLET");
const FILES = ["README.md", "SETUP.md", "LIMITS.md"];

describe("docs/AGENT-WALLET", () => {
  it("all three docs exist and are non-empty", () => {
    for (const f of FILES) {
      const p = join(DOCS, f);
      expect(existsSync(p), f).toBe(true);
      expect(readFileSync(p, "utf-8").length).toBeGreaterThan(500);
    }
  });

  it("internal relative links resolve", () => {
    const linkRe = /\]\((\.\/[^)\s]+)\)/g;
    for (const f of FILES) {
      const md = readFileSync(join(DOCS, f), "utf-8");
      for (const m of md.matchAll(linkRe)) {
        const target = resolve(dirname(join(DOCS, f)), m[1]);
        expect(existsSync(target), `${f} → ${m[1]}`).toBe(true);
      }
    }
  });

  it("dogfood runbook exists + executable + key steps present", () => {
    const sh = join(SERVER, "scripts", "agent-wallet-dogfood.sh");
    expect(existsSync(sh)).toBe(true);
    expect(statSync(sh).mode & 0o111).toBeGreaterThan(0);
    const s = readFileSync(sh, "utf-8");
    for (const step of [
      "POST /api/wallets",
      "/envelope",
      "spend_cap",
      "/audit",
    ]) {
      expect(s, step).toContain(step);
    }
  });
});
