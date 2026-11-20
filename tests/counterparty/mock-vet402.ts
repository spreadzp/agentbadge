/**
 * SLICE-257-7: hermetic vet402 mock — real HTTP server over loopback
 * so the REAL Vet402Client (fetch, timeouts, cache, singleflight,
 * limiter) is exercised end-to-end. No test touches vet402.com.
 */
import {
  createServer,
  type Server,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import type { AddressInfo } from "node:net";

export interface MockReply {
  status?: number;
  body?: unknown;
  /** Delay before answering — exercises client-side timeouts. */
  delayMs?: number;
}

export interface MockVet402 {
  url: string;
  resolveHits: number;
  decisionHits: number;
  totalHits: number;
  /** Called for GET /api/v1/resolve?q=<url>. Default: resolveOk. */
  onResolve: (q: string) => MockReply;
  /** Called for GET /api/v1/resources/<id>/decision?... Default: decisionBody. */
  onDecision: (resourceId: string) => MockReply;
  close(): Promise<void>;
}

export const RESOURCE_ID = "e2e".padEnd(64, "0"); // /^[0-9a-f]{64}$/ — vet402 resource ids are deterministic hex

export const resolveOk = (q: string): MockReply => ({
  status: 200,
  body: {
    query: { kind: "url", value: q },
    resource: {
      resource_id: RESOURCE_ID,
      endpoint_id: "c".repeat(64),
      canonical_url: q,
      method: "GET",
    },
    endpoints: [
      { resource_id: RESOURCE_ID, canonical_url: q, method: "GET" },
    ],
  },
});

export const resolveNotInCatalog = (q: string): MockReply => ({
  status: 200,
  body: {
    query: { kind: "url", value: q },
    endpoints: [],
    not_found: { reason: "not_in_catalog", note: "n/a" },
  },
});

export const decisionBody = (
  overrides: Record<string, unknown> = {},
): MockReply => ({
  status: 200,
  body: {
    recommendation: "ALLOW",
    reason_codes: ["l0_pass", "l1_delivered"],
    spending_halted: false,
    verified_terms: {
      purchase_id: "pid:e2e",
      pay_to: "0x23dd8f8e5e0a7f7b6c4d2a1e9f8c7b6a5d4c3b2a",
      asset: "0x3600000000000000000000000000000000000000",
      amount: "10000",
      decimals: 6,
      network: "eip155:5042",
      scheme: "exact",
      protocol: "x402",
      verified_at: "2026-11-19T00:00:00Z",
    },
    evidence: [],
    degraded: false,
    policy: "allow_only",
    rules_version: "2026-11-13.1",
    scoredAt: "2026-11-20T00:00:00Z",
    ...overrides,
  },
});

export async function startMockVet402(): Promise<MockVet402> {
  const mock: MockVet402 = {
    url: "",
    resolveHits: 0,
    decisionHits: 0,
    totalHits: 0,
    onResolve: (q) => resolveOk(q),
    onDecision: () => decisionBody(),
    close: () =>
      new Promise<void>((res) => server.close(() => res())),
  };

  const answer = async (res: ServerResponse, reply: MockReply) => {
    if (reply.delayMs) await new Promise((r) => setTimeout(r, reply.delayMs));
    res.writeHead(reply.status ?? 200, { "content-type": "application/json" });
    res.end(JSON.stringify(reply.body ?? {}));
  };

  const handler = async (req: IncomingMessage, res: ServerResponse) => {
    mock.totalHits += 1;
    const u = new URL(req.url ?? "/", "http://mock");
    if (u.pathname === "/api/v1/resolve") {
      mock.resolveHits += 1;
      return answer(res, mock.onResolve(u.searchParams.get("q") ?? ""));
    }
    const m = /^\/api\/v1\/resources\/([^/]+)\/decision$/.exec(u.pathname);
    if (m) {
      mock.decisionHits += 1;
      return answer(res, mock.onDecision(m[1]));
    }
    res.writeHead(404, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: "unknown path", path: u.pathname }));
  };

  const server: Server = createServer((req, res) => {
    handler(req, res).catch(() => {
      res.writeHead(500);
      res.end();
    });
  });
  await new Promise<void>((res) => server.listen(0, "127.0.0.1", res));
  mock.url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return mock;
}
