/**
 * SLICE-103-7: HTTP client for benchmark API endpoints.
 *
 * Used by CLI commands to fetch benchmarks, corpus stats, and reports.
 */

import type { OverallBenchmark, CategoryBenchmark, PillarBenchmark } from "../../corpus/benchmark.schema";
import type { CorpusStats } from "../../corpus/corpus-store";

export interface ReportArchiveEntry {
  id: string;
  title: string;
  date: string;
  format: string;
}

export class BenchmarkApiClient {
  constructor(private baseUrl: string) { }

  private async fetchJson<T>(path: string): Promise<T> {
    const url = `${this.baseUrl}${path}`;
    const res = await fetch(url);
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`API ${res.status}: ${body}`);
    }
    return res.json() as Promise<T>;
  }

  async getOverallBenchmark(): Promise<OverallBenchmark> {
    return this.fetchJson<OverallBenchmark>("/api/benchmarks");
  }

  async getCategoryBenchmark(category: string): Promise<CategoryBenchmark> {
    return this.fetchJson<CategoryBenchmark>(`/api/benchmarks/${encodeURIComponent(category)}`);
  }

  async getPillarBenchmark(pillar: string): Promise<PillarBenchmark> {
    return this.fetchJson<PillarBenchmark>(`/api/benchmarks/pillars/${encodeURIComponent(pillar)}`);
  }

  async getCorpusStats(): Promise<CorpusStats> {
    return this.fetchJson<CorpusStats>("/api/corpus/stats");
  }

  async getLatestReport(format: "json" | "markdown"): Promise<string> {
    const url = `${this.baseUrl}/api/reports/state-of-agent-readiness/latest?format=${format}`;
    const res = await fetch(url);
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`API ${res.status}: ${body}`);
    }
    return res.text();
  }

  async getReportArchive(): Promise<ReportArchiveEntry[]> {
    return this.fetchJson<ReportArchiveEntry[]>("/api/reports/state-of-agent-readiness");
  }

  async generateReport(): Promise<{ id: string; status: string }> {
    const url = `${this.baseUrl}/api/reports/state-of-agent-readiness/generate`;
    const res = await fetch(url, { method: "POST" });
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`API ${res.status}: ${body}`);
    }
    return res.json() as Promise<{ id: string; status: string }>;
  }

  async exportCorpus(from?: string, to?: string): Promise<string> {
    const params = new URLSearchParams();
    if (from) params.set("from", from);
    if (to) params.set("to", to);
    const qs = params.toString();
    const url = `${this.baseUrl}/api/corpus/export${qs ? `?${qs}` : ""}`;
    const res = await fetch(url);
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`API ${res.status}: ${body}`);
    }
    return res.text();
  }
}
