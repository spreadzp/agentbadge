import type { ITaskVerifier, VerificationResult } from "./verifier.interface";
import type { CachedMarketTask } from "@agentgate-hedera/hedera-core";

/**
 * DataHub integration notes:
 *
 * This verifier calls DataHub GMS REST API endpoints (assertions + glossary).
 * These are the same endpoints that the official DataHub MCP Server
 * (mcp-server-datahub) wraps. We use direct HTTP instead of spawning the
 * MCP server subprocess to reduce latency and deployment complexity.
 *
 * Equivalent MCP tools:
 *   - get_dataset_assertions  →  fetchAssertions()
 *   - search (glossary terms) →  fetchGlossary()
 *   - get_lineage             →  (available via DataHub UI, not needed here)
 *
 * To use the official MCP Server instead, set DATAHUB_MCP_URL to the
 * mcp-server-datahub stdio-to-HTTP bridge endpoint.
 */

interface AssertionsResponse {
  passed: boolean;
  failures: string[];
}

interface GlossaryResponse {
  missingTerms: string[];
}

export class DataHubVerifier implements ITaskVerifier {
  readonly type = "datahub";
  private readonly datahubMcpUrl: string;
  private readonly timeoutMs: number;

  constructor() {
    this.datahubMcpUrl = process.env.DATAHUB_MCP_URL ?? "http://localhost:4031";
    this.timeoutMs = Number(process.env.DATAHUB_TIMEOUT_MS ?? 30_000);
  }

  async verify(
    task: CachedMarketTask,
    resultBody?: string,
    resultIpfs?: string,
  ): Promise<VerificationResult> {
    let content = resultBody ?? "";

    if (!content && resultIpfs) {
      try {
        const res = await fetch(resultIpfs, { signal: AbortSignal.timeout(this.timeoutMs) });
        if (res.ok) {
          content = await res.text();
        }
      } catch {
        // IPFS fetch failed — continue with empty content
      }
    }

    let assertions: AssertionsResponse;
    try {
      assertions = await this.fetchAssertions(task.taskId);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes("timeout")) {
        return { passed: false, report: "DataHub timeout" };
      }
      return { passed: false, report: "DataHub not reachable" };
    }

    let glossary: GlossaryResponse;
    try {
      glossary = await this.fetchGlossary(content);
    } catch {
      glossary = { missingTerms: [] };
    }

    const errors: string[] = [...assertions.failures, ...glossary.missingTerms];
    const passed = assertions.passed && glossary.missingTerms.length === 0;

    const report = passed
      ? "DataHub verification passed"
      : `DataHub verification failed: ${errors.length} issue(s)`;

    return { passed, report, errors: errors.length > 0 ? errors : undefined };
  }

  private async fetchAssertions(taskId: string): Promise<AssertionsResponse> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const res = await fetch(
        `${this.datahubMcpUrl}/assertions/run?task=${encodeURIComponent(taskId)}`,
        { signal: controller.signal },
      );
      if (!res.ok) {
        return { passed: false, failures: [`DataHub assertions HTTP ${res.status}`] };
      }
      const data = (await res.json()) as Partial<AssertionsResponse>;
      return {
        passed: Boolean(data.passed),
        failures: Array.isArray(data.failures) ? data.failures : [],
      };
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") {
        throw new Error("timeout");
      }
      throw err;
    } finally {
      clearTimeout(timer);
    }
  }

  private async fetchGlossary(content: string): Promise<GlossaryResponse> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const res = await fetch(
        `${this.datahubMcpUrl}/glossary/check?content=${encodeURIComponent(content)}`,
        { signal: controller.signal },
      );
      if (!res.ok) {
        return { missingTerms: [] };
      }
      const data = (await res.json()) as Partial<GlossaryResponse>;
      return {
        missingTerms: Array.isArray(data.missingTerms) ? data.missingTerms : [],
      };
    } catch {
      return { missingTerms: [] };
    } finally {
      clearTimeout(timer);
    }
  }
}
