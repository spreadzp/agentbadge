/**
 * Shared setup for the settlement route specs (split under the
 * staged-file token cap): accounts, sig-auth headers, request helpers,
 * plan seed. `rt` holds the per-spec app+db — `initRouteTest()` in
 * beforeEach, `teardownRouteTest()` in afterEach.
 */
import { Hono } from "hono";
import { privateKeyToAccount } from "viem/accounts";
import { createHash, randomUUID } from "node:crypto";
import { createDatabase, type Database } from "@agentbadge/database";

import {
  approveMilestone,
  createPlan,
  createSettlementCtx,
  submitForReview,
} from "../../src/server/lib/settlement/index.js";
import { createSettlementReceiptRoutes } from "../../src/server/routes/settlement/settlement-receipts";
import { createSettlementRoutes } from "../../src/server/routes/settlement/settlement";
import { createSettlementAdminRoutes } from "../../src/server/routes/settlement/settlement-admin";
import { buildCommerceChallenge } from "../../src/server/routes/commerce/shared";
import { cacheHeadersMiddleware } from "../../src/server/middleware/cache-headers";
import {
  createMemoryOperatorStore,
  seedOperator,
} from "../helpers/operators";

const BUYER_KEY =
  "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d";
const PROVIDER_KEY =
  "0x8b3a350cf5c34c9194ca85829a2df0ec3153be0318b5e2d3348e87293edff032"; // secret-scan:allow: anvil test fixture
const STRANGER_KEY =
  "0x92db14e403b83dfe3df233f83dfa3a0d7096f21ca9b0d6d6b8d88e2b4ecda4e5"; // secret-scan:allow: anvil test fixture

export const buyer = privateKeyToAccount(BUYER_KEY);
export const provider = privateKeyToAccount(PROVIDER_KEY);
export const stranger = privateKeyToAccount(STRANGER_KEY);
export const ADMIN_KEY = "test-settlement-admin-key";
export const OPS = "ops-route-1";
export const TX = `0x${"c".repeat(64)}`;

export const rt: {
  db: Database;
  app: Hono;
  opKey: string;
  operatorId: string;
  opStore: ReturnType<typeof createMemoryOperatorStore>;
} = {
  db: null as unknown as Database,
  app: null as unknown as Hono,
  opKey: "",
  operatorId: "",
  opStore: null as unknown as ReturnType<typeof createMemoryOperatorStore>,
};

export async function initRouteTest(): Promise<void> {
  process.env.ADMIN_API_KEY = ADMIN_KEY;
  rt.db = createDatabase({ enabled: false });
  // SLICE-264-8: admin surface rides a real opk_ credential — the
  // actor written to AdminAction rows is the credential principal.id.
  const opStore = createMemoryOperatorStore();
  const seeded = await seedOperator(opStore, "Route Ops");
  rt.opKey = seeded.key;
  rt.operatorId = seeded.operatorId;
  rt.opStore = opStore;
  rt.app = new Hono();
  rt.app.use(cacheHeadersMiddleware());
  rt.app.route("/", createSettlementRoutes({ getDb: () => rt.db }));
  rt.app.route(
    "/",
    createSettlementReceiptRoutes({
      getDb: () => rt.db,
      operatorStore: opStore,
    }),
  );
  rt.app.route(
    "/",
    createSettlementAdminRoutes({ getDb: () => rt.db, operatorStore: opStore }),
  );
}

export function teardownRouteTest(): void {
  delete process.env.ADMIN_API_KEY;
}

type Account = ReturnType<typeof privateKeyToAccount>;

export async function sigHeaders(
  account: Account,
  method: string,
  path: string,
  rawBody: string,
  idemKey?: string,
): Promise<Record<string, string>> {
  const timestamp = Math.floor(Date.now() / 1000);
  const nonce = randomUUID();
  const message = buildCommerceChallenge({
    wallet: account.address,
    method,
    path,
    timestamp,
    nonce,
    bodyHash: rawBody ? createHash("sha256").update(rawBody).digest("hex") : "-",
    idemKey: idemKey ?? "-",
  });
  return {
    "x-wallet": account.address,
    "x-sig": await account.signMessage({ message }),
    "x-timestamp": String(timestamp),
    "x-nonce": nonce,
    "content-type": "application/json",
    ...(idemKey ? { idempotency_key: idemKey } : {}),
  };
}

export async function req(
  method: string,
  path: string,
  opts: {
    account?: Account;
    body?: unknown;
    headers?: Record<string, string>;
    raw?: boolean;
  } = {},
) {
  const rawBody = opts.body !== undefined ? JSON.stringify(opts.body) : "";
  const headers: Record<string, string> = { ...(opts.headers ?? {}) };
  if (opts.account) {
    Object.assign(
      headers,
      await sigHeaders(opts.account, method, path, rawBody, headers["idempotency_key"]),
    );
  }
  if (rawBody && !headers["content-type"]) {
    headers["content-type"] = "application/json";
  }
  const res = await rt.app.fetch(
    new Request(`http://localhost${path}`, {
      method,
      headers,
      body: rawBody || undefined,
    }),
  );
  return {
    status: res.status,
    cacheControl: res.headers.get("cache-control"),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    body: (await res.json()) as any,
  };
}

export const adminReq = (
  method: string,
  path: string,
  body?: unknown,
  key?: string,
) => req(method, path, { body, headers: { "x-admin-key": key ?? rt.opKey } });

export const PLAN_BODY = (agreementRef: string) => ({
  agreementRef,
  buyerWallet: buyer.address,
  providerWallet: provider.address,
  totalUsd: "10.00",
  milestones: [{ milestoneId: "m1", title: "phase", amountUsd: "10.00" }],
});

/** Seed: plan (route) → submit+approve (domain) → OPEN intent. */
export async function seedApprovedIntent() {
  const agreementRef = `agr-${randomUUID()}`;
  const ctx = createSettlementCtx(rt.db);
  const plan = await createPlan(
    ctx,
    { ...PLAN_BODY(agreementRef) },
    buyer.address,
  );
  if (!plan.ok) throw new Error("plan seed failed");
  const m = plan.value.milestones[0]!;
  await submitForReview(
    ctx,
    { milestoneRowId: m.id, submissionRef: "ipfs://w" },
    provider.address,
  );
  const ap = await approveMilestone(ctx, m.id, buyer.address);
  if (!ap.ok) throw new Error("approve seed failed");
  return { plan: plan.value.plan, milestone: m, intentId: ap.value.intentId };
}
