import { safeFetch } from "../ssrf/safe-fetch";
import { sha256 } from "./robots-fetcher";

export interface WebmcpRuntimeFetchResult {
  url: string;
  status: number;
  hasModelContext: boolean;
  hasRegisterTool: boolean;
  toolCount: number;
  bodyHash: string | null;
  resolvedIp: string | null;
  fetchTime: number;
}

export async function fetchWebmcpRuntime(
  baseUrl: string,
): Promise<WebmcpRuntimeFetchResult> {
  const url = `${baseUrl}/`;
  try {
    const result = await safeFetch(url, {
      allowedContentTypes: ["text/html", "application/xhtml+xml"],
    });
    const html = result.bodyText;
    const hasModelContext = html.includes("document.modelContext");
    const hasRegisterTool = html.includes("registerTool");
    const toolCount = countToolDefinitions(html);
    return {
      url,
      status: result.status,
      hasModelContext,
      hasRegisterTool,
      toolCount,
      bodyHash: sha256(result.body),
      resolvedIp: result.resolvedIp,
      fetchTime: result.fetchTime,
    };
  } catch {
    return {
      url,
      status: 0,
      hasModelContext: false,
      hasRegisterTool: false,
      toolCount: 0,
      bodyHash: null,
      resolvedIp: null,
      fetchTime: 0,
    };
  }
}

function countToolDefinitions(html: string): number {
  // Count occurrences of "inputSchema" which indicates a tool definition
  const matches = html.match(/inputSchema/g);
  return matches ? matches.length : 0;
}
