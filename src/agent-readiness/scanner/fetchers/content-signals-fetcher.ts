import { safeFetch } from "../ssrf/safe-fetch";
import { sha256 } from "./robots-fetcher";

export interface ContentSignalsFetchResult {
  url: string;
  status: number;
  body: string | null;
  contentSignals: { ai_train: string | null; search: string | null; ai_input: string | null };
  bodyHash: string | null;
  resolvedIp: string | null;
  fetchTime: number;
}

export async function fetchContentSignals(
  baseUrl: string,
): Promise<ContentSignalsFetchResult> {
  const url = `${baseUrl}/robots.txt`;
  try {
    const result = await safeFetch(url, {
      allowedContentTypes: ["text/plain"],
    });
    const body = result.bodyText;
    const signals = parseContentSignals(body);
    return {
      url,
      status: result.status,
      body,
      contentSignals: signals,
      bodyHash: sha256(result.body),
      resolvedIp: result.resolvedIp,
      fetchTime: result.fetchTime,
    };
  } catch (e) {
    return {
      url,
      status: 0,
      body: null,
      contentSignals: { ai_train: null, search: null, ai_input: null },
      bodyHash: null,
      resolvedIp: null,
      fetchTime: 0,
    };
  }
}

function parseContentSignals(body: string): {
  ai_train: string | null;
  search: string | null;
  ai_input: string | null;
} {
  const result = { ai_train: null as string | null, search: null as string | null, ai_input: null as string | null };
  const lines = body.split("\n");
  for (const line of lines) {
    const match = line.match(/^Content-Signal:\s*(.+)$/i);
    if (match) {
      const value = match[1].trim();
      for (const part of value.split(",")) {
        const [key, val] = part.trim().split("=");
        if (key && val) {
          const k = key.trim().toLowerCase();
          const v = val.trim();
          if (k === "ai-train" || k === "ai_train") result.ai_train = v;
          if (k === "search") result.search = v;
          if (k === "ai-input" || k === "ai_input") result.ai_input = v;
        }
      }
    }
  }
  return result;
}
