/**
 * SLICE-152-7: collect-evidence.sh — seeded venue index → evidence.md
 * contains tx table, stats, explorer links, smoke section.
 */
import { describe, expect, it } from "vitest";
import { execSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const SCRIPT = "scripts/grants/collect-evidence.sh";
const CWD = process.cwd();

function writeFixture(dir: string): { venuePath: string; outPath: string } {
  const venuePath = join(dir, "venue.json");
  const outPath = join(dir, "evidence.md");
  const venue = {
    jobs: {
      j1: {
        jobId: "j1",
        status: "completed",
        budgetUsdc: 5,
        createdAt: "2026-10-01T00:00:00Z",
        client: "0xaaaa000000000000000000000000000000000001",
        provider: "0xbbbb000000000000000000000000000000000002",
        evaluator: "0xcccc000000000000000000000000000000000003",
        title: "t",
        description: "",
        chainTxs: {
          created: "0x1111aaaabbbb1111aaaabbbb",
          funded: "0x2222aaaabbbb2222aaaabbbb",
          submitted: "0x3333aaaabbbb3333aaaabbbb",
          completed: "0x4444aaaabbbb4444aaaabbbb",
        },
        feedback: { status: "sent", txHash: "0x5555aaaabbbb5555aaaabbbb" },
      },
      j2: {
        jobId: "j2",
        status: "open",
        budgetUsdc: 10,
        createdAt: "2026-10-01T01:00:00Z",
        client: "0xaaaa000000000000000000000000000000000001",
        evaluator: "0xcccc000000000000000000000000000000000003",
        title: "t2",
        description: "",
        chainTxs: {},
      },
    },
    offers: {
      o1: {
        id: "o1",
        providerAddress: "0xbbbb000000000000000000000000000000000002",
        name: "svc",
        description: "",
        claimable: true,
        active: true,
        categories: [],
        createdAt: "2026-10-01T00:00:00Z",
      },
    },
  };
  writeFileSync(venuePath, JSON.stringify(venue));
  return { venuePath, outPath };
}

describe("SLICE-152-7 collect-evidence", () => {
  it("writes evidence.md with tx table + stats + smoke section", () => {
    const dir = mkdtempSync(join(tmpdir(), "grant-evidence-"));
    const { venuePath, outPath } = writeFixture(dir);
    const smokeDir = join(dir, "smoke");
    mkdirSync(smokeDir, { recursive: true });
    writeFileSync(
      join(smokeDir, "smoke-report-arc-testnet-1.json"),
      JSON.stringify({
        network: "arc-testnet",
        ok: true,
        startedAt: "2026-10-01T00:00:00Z",
        phases: [
          { name: "job:create", ok: true },
          { name: "job:complete", ok: true },
        ],
      }),
    );

    execSync(`bash ${SCRIPT}`, {
      cwd: CWD,
      env: {
        ...process.env,
        VENUE_INDEX_JSON: venuePath,
        SMOKE_DIR: smokeDir,
        EVIDENCE_OUT: outPath,
        ARC_EXPLORER_URL: "https://explorer.arc.io",
        VENUE_PAGE: "https://agentbadge.xyz/market",
      },
    });

    const md = readFileSync(outPath, "utf8");
    expect(md).toContain("| job | status | budget |");
    expect(md).toContain("[j1](https://agentbadge.xyz/market/jobs/j1)");
    expect(md).toContain("https://explorer.arc.io/tx/0x1111aaaabbbb");
    expect(md).toContain("https://explorer.arc.io/tx/0x5555aaaabbbb");
    expect(md).toContain("jobsTotal: **2**");
    expect(md).toContain("jobsDone: **1**");
    expect(md).toContain("usdcVolume: **$15**");
    expect(md).toContain("feedbackSent: **1**");
    expect(md).toContain("providersActive: **1**");
    expect(md).toContain("**testnet**");
    expect(md).toContain("smoke-report-arc-testnet-1.json");
    expect(md).toContain("**mainnet** — no report found");
  });
});
