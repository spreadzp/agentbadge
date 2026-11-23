import { describe, it, expect } from "vitest";
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

// SLICE-259-26 (D-259-Q7): defensive name stubs must stay
// consistent — every reserved name has a generated package dir,
// a bin matching its name, and a redirect target pointing at a
// real scoped @agentbadge/* package.
const STUBS = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "..",
  "packages",
  "name-stubs",
);
const names = JSON.parse(
  readFileSync(join(STUBS, "names.json"), "utf-8"),
) as Record<string, { target: string; package: string }>;

const REAL_SCOPED = new Set([
  "@agentbadge/scanner",
  "@agentbadge/mcp",
  "@agentbadge/verify-verdict",
  "@agentbadge/circle-payments",
]);

describe("SLICE-259-26: defensive name stubs", () => {
  it("names.json covers the reserved family", () => {
    for (const n of [
      "agentbadge-scan",
      "agentbadge-scanner",
      "agentbadge-cli",
      "agentbadge-mcp",
      "agentbadge-verify",
    ]) {
      expect(names[n], `missing ${n}`).toBeTruthy();
    }
  });

  it("every target points at a real scoped package", () => {
    for (const [n, meta] of Object.entries(names)) {
      expect(REAL_SCOPED.has(meta.package), `${n} → ${meta.package}`).toBe(
        true,
      );
      expect(meta.target).toMatch(/^npx @agentbadge\//);
      expect(meta.target).toContain(meta.package);
    }
  });

  it("generated stubs exist and are consistent", () => {
    const dirs = readdirSync(join(STUBS, "dist"));
    expect(dirs.sort()).toEqual(Object.keys(names).sort());
    for (const name of dirs) {
      const dir = join(STUBS, "dist", name);
      for (const f of ["package.json", "stub.js", "README.md"]) {
        expect(existsSync(join(dir, f)), `${name}/${f}`).toBe(true);
      }
      const pkg = JSON.parse(
        readFileSync(join(dir, "package.json"), "utf-8"),
      );
      expect(pkg.name).toBe(name);
      expect(Object.keys(pkg.bin)).toEqual([name]);
      expect(pkg["x-agentbadge"].package).toBe(names[name].package);
      const readme = readFileSync(join(dir, "README.md"), "utf-8");
      expect(readme).toContain(names[name].target);
    }
  });

  it("stubs never impersonate the real tool", () => {
    const stub = readFileSync(
      join(STUBS, "dist", "agentbadge-scan", "stub.js"),
      "utf-8",
    );
    // print-and-exit-1: no silent npx-proxying, no install hooks
    expect(stub).toContain("process.exit(1)");
    const pkg = JSON.parse(
      readFileSync(
        join(STUBS, "dist", "agentbadge-scan", "package.json"),
        "utf-8",
      ),
    );
    expect(pkg.scripts ?? {}).not.toHaveProperty("postinstall");
    expect(pkg.scripts ?? {}).not.toHaveProperty("preinstall");
  });
});
