import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";

interface ChainEntry {
  latestHash: string;
  latestReportId: string;
  timestamp: string;
}

interface ChainIndex {
  [scope: string]: ChainEntry;
}

export class HashChainManager {
  private index: ChainIndex = {};
  private indexFile: string;

  constructor(chainDir: string) {
    this.indexFile = join(chainDir, "chain-index.json");
  }

  async load(): Promise<void> {
    try {
      const content = await readFile(this.indexFile, "utf8");
      this.index = JSON.parse(content);
    } catch {
      this.index = {};
    }
  }

  getPreviousHash(scope: string): string | null {
    return this.index[scope]?.latestHash ?? null;
  }

  async updateChain(
    scope: string,
    reportId: string,
    contentHash: string,
    timestamp: string,
  ): Promise<void> {
    this.index[scope] = { latestHash: contentHash, latestReportId: reportId, timestamp };
    await mkdir(dirname(this.indexFile), { recursive: true });
    await writeFile(this.indexFile, JSON.stringify(this.index, null, 2), "utf8");
  }

  verifyChain(
    reports: Array<{
      scope: string;
      report_id: string;
      previous_hash: string | null;
      integrity: { content_hash: string };
    }>,
  ): { valid: boolean; brokenAt?: number; reason?: string } {
    for (let i = 1; i < reports.length; i++) {
      const prev = reports[i - 1];
      const curr = reports[i];
      if (curr.previous_hash !== prev.integrity.content_hash) {
        return {
          valid: false,
          brokenAt: i,
          reason: `previous_hash mismatch at report ${curr.report_id}: expected ${prev.integrity.content_hash}, got ${curr.previous_hash}`,
        };
      }
    }
    return { valid: true };
  }
}
