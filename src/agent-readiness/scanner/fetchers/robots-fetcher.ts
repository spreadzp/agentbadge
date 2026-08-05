import { safeFetch, type SafeFetchResult } from "../ssrf/safe-fetch";
import { createHash } from "node:crypto";

export interface RobotsFetchResult {
  url: string;
  status: number;
  body: string | null;
  bodyHash: string | null;
  resolvedIp: string | null;
  fetchTime: number;
}

export async function fetchRobotsTxt(baseUrl: string): Promise<RobotsFetchResult> {
  const url = `${baseUrl}/robots.txt`;
  try {
    const result = await safeFetch(url, {
      allowedContentTypes: ["text/plain"],
    });
    return {
      url,
      status: result.status,
      body: result.bodyText,
      bodyHash: sha256(result.body),
      resolvedIp: result.resolvedIp,
      fetchTime: result.fetchTime,
    };
  } catch (e) {
    return {
      url,
      status: 0,
      body: null,
      bodyHash: null,
      resolvedIp: null,
      fetchTime: 0,
    };
  }
}

export function sha256(data: ArrayBuffer | string): string {
  const buf = typeof data === "string" ? Buffer.from(data) : Buffer.from(data);
  return createHash("sha256").update(buf).digest("hex");
}
