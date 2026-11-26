/**
 * MCP abuse-guard — tool-name extraction helpers (split out of
 * mcp-abuse-guard.ts for the 300-line file cap).
 *
 * Two surfaces carry the tool name: REST-style paths
 * (/mcp/<ns>/tools/<name>) and JSON-RPC bodies (tools/call params.name).
 */

import type { Context } from "hono";

const REST_TOOL_RE = /^\/mcp(?:\/[^/?]+)?\/tools\/([^/?]+)/;

export function toolNameFromPath(path: string): string | undefined {
  const m = REST_TOOL_RE.exec(path);
  try {
    return m ? decodeURIComponent(m[1]) : undefined;
  } catch {
    return undefined; // malformed %-encoding — treat as non-heavy
  }
}

/** Arc-audit H-4/M-6: normalise before the heavySet lookup — strip
 *  anything after a null byte (arc_send_raw_tx%00extra bypass) and
 *  lower-case (Arc_Send_Raw_Tx bypass). */
export function normalizeToolName(raw: string): string {
  const nul = raw.indexOf("\0");
  return (nul >= 0 ? raw.slice(0, nul) : raw).toLowerCase();
}

type RpcItem = { method?: string; params?: { name?: string } };

function nameFromRpcItem(item: RpcItem | undefined): string | undefined {
  return item?.method === "tools/call" ? item.params?.name : undefined;
}

/** Read JSON-RPC tools/call name via `c.req.json()` — Hono caches the
 *  parsed body on the request object, so this stays readable even when
 *  an earlier middleware already consumed the stream (arc-audit 233
 *  H-3: `raw.clone()` threw in that case and the heavy-op bucket was
 *  silently skipped — fail-open). Returns `false` when the body is
 *  unreadable/unparseable so the caller can charge the heavy bucket
 *  (fail-closed), `undefined` for "no tool name" (GET, non-call
 *  method), or the normalized tool name.
 *  Arc-audit H-3 (prev): JSON-RPC 2.0 allows batch arrays. A
 *  single-element batch wrapping a heavy op used to slip past
 *  detection entirely — arrays are scanned and the first HEAVY member
 *  name is returned so the bucket/gate applies. */
export async function toolNameFromBody(
  c: Context,
  heavySet: ReadonlySet<string>,
): Promise<string | false | undefined> {
  if (c.req.method !== "POST") return undefined;
  try {
    const body = (await c.req.json()) as RpcItem | RpcItem[];
    if (Array.isArray(body)) {
      const names = body.map((item) => nameFromRpcItem(item));
      const heavyName = names.find(
        (n): n is string =>
          typeof n === "string" && heavySet.has(normalizeToolName(n)),
      );
      return heavyName ?? names.find((n) => typeof n === "string");
    }
    const name = nameFromRpcItem(body);
    // M12 guard-adjacent: `params.name` may be non-string ("name":123)
    // — normalizeToolName would throw on .indexOf later.
    return typeof name === "string" ? name : undefined;
  } catch {
    /* body already consumed upstream or not JSON — nothing readable */
  }
  return false;
}
