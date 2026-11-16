/**
 * SLICE-234-16/17 prod re-verify — signed commerce happy path with
 * ephemeral wallets, then check /api/v1/actors + /api/v1/reputation.
 * Usage: env -u NODE_OPTIONS bun scripts/prod-verify-234.mts
 */
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { createHash, randomUUID } from "node:crypto";
import { buildCommerceChallenge } from "../src/server/routes/commerce/shared";

const BASE = "https://agentbadge.xyz";
const PREFIX = `VERIFY234-${Date.now().toString(36)}`;

const buyer = privateKeyToAccount(generatePrivateKey());
const provider = privateKeyToAccount(generatePrivateKey());
console.log("buyer   =", buyer.address);
console.log("provider=", provider.address);

async function signed(
  account: ReturnType<typeof privateKeyToAccount>,
  method: string,
  path: string,
  body?: unknown,
) {
  const rawBody = body === undefined ? "" : JSON.stringify(body);
  const timestamp = Math.floor(Date.now() / 1000);
  const nonce = randomUUID();
  const message = buildCommerceChallenge({
    wallet: account.address,
    method,
    path,
    timestamp,
    nonce,
    bodyHash: rawBody
      ? createHash("sha256").update(rawBody).digest("hex")
      : "-",
    idemKey: "-",
  });
  const signature = await account.signMessage({ message });
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      "x-wallet": account.address,
      "x-sig": signature,
      "x-timestamp": String(timestamp),
      "x-nonce": nonce,
      "content-type": "application/json",
    },
    body: rawBody || undefined,
  });
  const json = await res.json().catch(() => ({}));
  return { status: res.status, json };
}

const get = async (path: string) => {
  const res = await fetch(`${BASE}${path}`, { method: "GET" });
  return { status: res.status, json: await res.json().catch(() => ({})) };
};

// 1) task create (buyer)
const t = await signed(buyer, "POST", "/api/commerce/tasks", {
  title: `${PREFIX} verify`,
  description: `${PREFIX} desc`,
});
console.log("task:", t.status, t.json?.task?.id);
if (t.status !== 201) throw new Error(JSON.stringify(t));
const taskId = t.json.task.id;

// B-1 check 1: buyer actor lazily created?
const a1 = await get(`/api/v1/actors/${buyer.address}`);
console.log("actor buyer after task:", a1.status, JSON.stringify(a1.json).slice(0, 200));

// 2) offer (provider) + accept (buyer)
const o = await signed(provider, "POST", `/api/commerce/tasks/${taskId}/offers`, {
  price: "1.00",
  proposal: `${PREFIX} proposal`,
});
console.log("offer:", o.status, o.json?.offer?.id);
const acc = await signed(buyer, "POST", `/api/commerce/offers/${o.json.offer.id}/accept`, {});
console.log("accept:", acc.status, acc.json?.agreement?.id);
const agId = acc.json.agreement.id;

// B-1 check 2: provider actor after offer
const a2 = await get(`/api/v1/actors/${provider.address}`);
console.log("actor provider after offer:", a2.status, JSON.stringify(a2.json).slice(0, 200));

// 3) submission (provider) + review ACCEPTED (buyer)
const s = await signed(
  provider,
  "POST",
  `/api/commerce/agreements/${agId}/submissions`,
  { summary: `${PREFIX} done`, evidenceRefs: ["https://example.com/ev"] },
);
console.log("submission:", s.status, s.json?.submission?.id);
const r = await signed(
  buyer,
  "POST",
  `/api/commerce/submissions/${s.json.submission.id}/review`,
  { verdict: "ACCEPTED" },
);
console.log("review:", r.status, r.json?.task?.status, r.json?.agreement?.status);

// 4) B-1 final + B-2: actors + reputation
for (const [label, w] of [["buyer", buyer.address], ["provider", provider.address]] as const) {
  const a = await get(`/api/v1/actors/${w}`);
  const rep = await get(`/api/v1/reputation/${w}`);
  console.log(
    `actor ${label}: ${a.status}`,
    a.status === 200 ? `(type=${a.json.actor?.type})` : JSON.stringify(a.json).slice(0, 120),
  );
  console.log(`reputation ${label}: ${rep.status}`, JSON.stringify(rep.json).slice(0, 400));
}
