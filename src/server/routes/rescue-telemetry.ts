/**
 * POST /api/rescue/telemetry — rescue CLI run telemetry (208-1c, D-208-39).
 *
 * No auth (public ingest), rate-limited per IP, strict schema validation.
 * Payload: {schema:"rescue-telemetry/1", route, asset, amount, status, txHashes,
 * cliVersion, ref?, timestamp}. Private-key-looking fields are REJECTED.
 *
 * Persistence: @agentbadge/database RescueTelemetryEvent when DATABASE_ENABLED,
 * else append-only .data/rescue/telemetry.jsonl.
 */
import { Hono } from "hono";
import { appendFile, mkdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import { dirname, resolve } from "node:path";

export const rescueTelemetryRoutes = new Hono();

const FALLBACK_PATH = process.env.RESCUE_TELEMETRY_FILE ?? resolve(process.cwd(), ".data/rescue/telemetry.jsonl");

// ─── rate limit: 20 req / 5 min / IP (in-memory; cache store when available) ──
const BUCKET_MS = 5 * 60_000;
const MAX_PER_BUCKET = 20;
const MAX_BUCKETS = 10_000;
const buckets = new Map<string, { count: number; resetAt: number }>();

/**
 * Audit H-7: X-Forwarded-For / CF-Connecting-IP are attacker-controlled unless
 * the deployment is behind a trusted proxy. RESCUE_TELEMETRY_TRUST_PROXY=1
 * opts into honoring them; otherwise every caller shares the "unknown" bucket
 * (fail closed — stricter, not looser).
 */
function clientIp(c: { req: { header: (n: string) => string | undefined } }): string {
  if (process.env.RESCUE_TELEMETRY_TRUST_PROXY !== "1") return "unknown";
  return c.req.header("x-forwarded-for")?.split(",")[0]?.trim()
    ?? c.req.header("cf-connecting-ip")
    ?? "unknown";
}

/** Sweep expired buckets; if still over cap, evict oldest-reset entries. */
function evictBuckets(now: number): void {
  for (const [k, b] of buckets) if (now > b.resetAt) buckets.delete(k);
  if (buckets.size <= MAX_BUCKETS) return;
  const oldest = [...buckets.entries()].sort((a, b) => a[1].resetAt - b[1].resetAt);
  for (const [k] of oldest.slice(0, buckets.size - MAX_BUCKETS)) buckets.delete(k);
}

function rateLimited(ip: string): boolean {
  const now = Date.now();
  const b = buckets.get(ip);
  if (!b || now > b.resetAt) {
    evictBuckets(now);
    buckets.set(ip, { count: 1, resetAt: now + BUCKET_MS });
    return false;
  }
  b.count++;
  return b.count > MAX_PER_BUCKET;
}

// ─── schema validation ───────────────────────────────────────────────────────

const STATUSES = new Set([
  "PLANNED", "APPROVING", "REFUELING", "BURNING", "ATTESTATION_PENDING",
  "ATTESTED", "MINTING", "DONE", "FAILED", "MANUAL_REVIEW", "PENDING",
  "BLOCKED_LIQUIDITY", "BLOCKED_APPROVAL", "CANCELLED",
]);
const TX_RE = /^0x[0-9a-fA-F]{64}$/;
const FORBIDDEN = /key|secret|private|seed|mnemonic|password/i;

export function validateTelemetryPayload(body: unknown): { ok: true; value: Record<string, unknown> } | { ok: false; error: string } {
  if (typeof body !== "object" || body === null) return { ok: false, error: "not an object" };
  const b = body as Record<string, unknown>;
  // schema gate — reject anything else claiming a different schema
  if (b.schema !== "rescue-telemetry/1") return { ok: false, error: "schema must be rescue-telemetry/1" };
  // forbidden fields (private key guard, D-208-39)
  for (const k of Object.keys(b)) if (FORBIDDEN.test(k)) return { ok: false, error: `forbidden field: ${k}` };
  if (typeof b.route !== "string" || b.route.length === 0 || b.route.length > 100) return { ok: false, error: "route" };
  if (typeof b.asset !== "string" || b.asset.length === 0 || b.asset.length > 16) return { ok: false, error: "asset" };
  if (typeof b.amount !== "string" || !/^\d+$/.test(b.amount)) return { ok: false, error: "amount must be digit string" };
  if (typeof b.status !== "string" || !STATUSES.has(b.status)) return { ok: false, error: `status must be one of ${[...STATUSES].join(",")}` };
  if (b.executionId !== undefined && (typeof b.executionId !== "string" || b.executionId.length > 80)) return { ok: false, error: "executionId" };
  if (b.cliVersion !== undefined && (typeof b.cliVersion !== "string" || b.cliVersion.length > 40)) return { ok: false, error: "cliVersion" };
  if (b.ref !== undefined && (typeof b.ref !== "string" || b.ref.length > 120)) return { ok: false, error: "ref" };
  if (b.timestamp !== undefined && (typeof b.timestamp !== "string" || b.timestamp.length > 40)) return { ok: false, error: "timestamp" };
  if (typeof (b.amount as string) === "string" && (b.amount as string).length > 30) return { ok: false, error: "amount too long" };
  if (b.txHashes !== undefined) {
    if (typeof b.txHashes !== "object" || b.txHashes === null) return { ok: false, error: "txHashes" };
    const entries = Object.entries(b.txHashes as Record<string, unknown>);
    if (entries.length > 12) return { ok: false, error: "txHashes: too many entries (max 12)" };
    for (const [k, v] of entries) {
      if (!/^[a-zA-Z0-9_.-]{1,40}$/.test(k)) return { ok: false, error: `txHashes key '${k}' invalid` };
      if (typeof v !== "string" || !TX_RE.test(v)) return { ok: false, error: `txHashes.${k} must be 0x+64hex` };
    }
  }
  // Audit H-7: whitelist-copy — persist ONLY known fields, never raw body.
  const clean: Record<string, unknown> = { schema: "rescue-telemetry/1" };
  for (const k of ["route", "asset", "amount", "status", "executionId", "cliVersion", "ref", "timestamp", "txHashes"]) {
    if (b[k] !== undefined) clean[k] = b[k];
  }
  return { ok: true, value: clean };
}

async function persist(row: Record<string, unknown>, uaHash: string): Promise<"db" | "jsonl"> {
  try {
    if (process.env.DATABASE_ENABLED === "1" || process.env.DATABASE_ENABLED === "true") {
      const { getDatabase } = await import("../lib/database.js");
      const db = getDatabase().db;
      if (db) {
        const route = String(row.route ?? "");
        const [routeFrom, routeTo] = route.split("→").map((x) => x ?? "");
        await (db as unknown as { rescueTelemetryEvent: { create: (a: { data: unknown }) => Promise<unknown> } }).rescueTelemetryEvent.create({
          data: {
            executionId: (row.executionId as string) ?? null,
            routeFrom: routeFrom || "?",
            routeTo: routeTo || "?",
            asset: String(row.asset ?? "?"),
            amountUsdc: String(row.amount ?? "0"),
            status: String(row.status ?? "?"),
            txHashes: (row.txHashes as object) ?? {},
            cliVersion: String(row.cliVersion ?? "0"),
            ref: (row.ref as string) ?? null,
            uaHash,
          },
        });
        return "db";
      }
    }
  } catch {
    /* fall through to JSONL — telemetry must never 500 on persistence */
  }
  await mkdir(dirname(FALLBACK_PATH), { recursive: true });
  await appendFile(FALLBACK_PATH, JSON.stringify({ ...row, uaHash, ingestedAt: new Date().toISOString() }) + "\n", "utf8");
  return "jsonl";
}

rescueTelemetryRoutes.post("/api/rescue/telemetry", async (c) => {
  const ip = clientIp(c);
  if (rateLimited(ip)) return c.json({ ok: false, error: "rate limited" }, 429);

  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ ok: false, error: "invalid JSON" }, 400);
  }
  const v = validateTelemetryPayload(body);
  if (!v.ok) return c.json({ ok: false, error: v.error }, 400);

  const ua = c.req.header("user-agent") ?? "";
  const uaHash = ua ? createHash("sha256").update(ua).digest("hex").slice(0, 16) : "";
  const backend = await persist(v.value, uaHash);
  return c.json({ ok: true, stored: backend }, 202);
});
