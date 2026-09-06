/**
 * SLICE-103-2: File-backed CorpusStore (JSONL append-only).
 *
 * Records are stored in `data/corpus/records/{YYYY-MM-DD}.jsonl`.
 * PII sweep runs on every append — this is the privacy enforcement point.
 */

import * as fs from "fs";
import * as path from "path";
import { sweepForPii } from "./pii-sweep";
import type { CorpusRecord } from "./corpus-record.schema";

export interface CorpusStore {
  append(record: CorpusRecord): Promise<CorpusAppendResult>;
  query(filters: CorpusQueryFilters): Promise<CorpusRecord[]>;
  getStats(): Promise<CorpusStats>;
}

export interface CorpusAppendResult {
  success: boolean;
  error?: string;
}

export interface CorpusQueryFilters {
  dateFrom?: string;
  dateTo?: string;
  vertical?: string;
  minScore?: number;
  maxScore?: number;
  rulesetVersion?: string;
  limit?: number;
}

export interface CorpusStats {
  total_records: number;
  date_range: { earliest: string; latest: string };
  ruleset_versions: string[];
  verticals: string[];
}

// ── File-backed implementation ───────────────────────────────

export class FileCorpusStore implements CorpusStore {
  private baseDir: string;

  constructor(baseDir?: string) {
    this.baseDir = baseDir ?? path.join(process.cwd(), "data", "corpus", "records");
  }

  async append(record: CorpusRecord): Promise<CorpusAppendResult> {
    // PII sweep — privacy enforcement point
    const sweep = sweepForPii(record);
    if (!sweep.clean) {
      console.warn(`[corpus] Record dropped (PII detected): ${sweep.findings.join("; ")}`);
      return { success: false, error: `PII detected: ${sweep.findings.join("; ")}` };
    }

    // Ensure directory exists
    fs.mkdirSync(this.baseDir, { recursive: true });

    // Determine file by date
    const date = record.timestamp.slice(0, 10);
    const filePath = path.join(this.baseDir, `${date}.jsonl`);

    // Append as JSONL
    const line = JSON.stringify(record) + "\n";
    fs.appendFileSync(filePath, line, "utf-8");

    return { success: true };
  }

  async query(filters: CorpusQueryFilters): Promise<CorpusRecord[]> {
    if (!fs.existsSync(this.baseDir)) return [];

    const files = fs.readdirSync(this.baseDir).filter((f) => f.endsWith(".jsonl")).sort();

    const records: CorpusRecord[] = [];
    for (const file of files) {
      const date = file.replace(".jsonl", "");

      // Date range filter
      if (filters.dateFrom && date < filters.dateFrom) continue;
      if (filters.dateTo && date > filters.dateTo) continue;

      const content = fs.readFileSync(path.join(this.baseDir, file), "utf-8");
      const lines = content.trim().split("\n");

      for (const line of lines) {
        if (!line) continue;
        try {
          const record: CorpusRecord = JSON.parse(line);

          // Apply filters
          if (filters.vertical && record.industry_vertical !== filters.vertical) continue;
          if (filters.minScore !== undefined && record.scan_summary.score < filters.minScore) continue;
          if (filters.maxScore !== undefined && record.scan_summary.score > filters.maxScore) continue;
          if (filters.rulesetVersion && record.ruleset_version !== filters.rulesetVersion) continue;

          records.push(record);
        } catch {
          // Skip malformed lines
        }
      }

      if (filters.limit && records.length >= filters.limit) {
        return records.slice(0, filters.limit);
      }
    }

    return records;
  }

  async getStats(): Promise<CorpusStats> {
    const all = await this.query({});
    if (all.length === 0) {
      return {
        total_records: 0,
        date_range: { earliest: "", latest: "" },
        ruleset_versions: [],
        verticals: [],
      };
    }

    const rulesetVersions = new Set<string>();
    const verticals = new Set<string>();
    let earliest = all[0].timestamp;
    let latest = all[0].timestamp;

    for (const r of all) {
      rulesetVersions.add(r.ruleset_version);
      if (r.industry_vertical) verticals.add(r.industry_vertical);
      if (r.timestamp < earliest) earliest = r.timestamp;
      if (r.timestamp > latest) latest = r.timestamp;
    }

    return {
      total_records: all.length,
      date_range: { earliest, latest },
      ruleset_versions: [...rulesetVersions],
      verticals: [...verticals],
    };
  }
}
