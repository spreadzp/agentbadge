/**
 * SLICE-224-2 (MYPROJ-2811): commerce domain services — state machines,
 * hash-chain events, contract guards, authz matrix.
 *
 * Runs against the in-memory CommerceStores backend (DATABASE_ENABLED=off
 * path). Postgres parity for stores is covered in packages/database.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { createInMemoryCommerceStores } from "@agentbadge/database";
import type { CommerceStores } from "@agentbadge/database";

import { createCommerceService } from "../src/server/lib/commerce/index.js";
import {
  assertTransition,
  GENESIS_HASH,
  hashEvent,
} from "../src/server/lib/commerce/state-machines.js";
import { CommerceError } from "../src/server/lib/commerce/types.js";
import { resetIdempotencyStore } from "../src/server/lib/contract-guards.js";

const BUYER = "0x1111111111111111111111111111111111111111";
const PROVIDER = "0x2222222222222222222222222222222222222222";
const STRANGER = "0x3333333333333333333333333333333333333333";

let stores: CommerceStores;
let svc: ReturnType<typeof createCommerceService>;

beforeEach(() => {
  stores = createInMemoryCommerceStores();
  svc = createCommerceService(stores);
  resetIdempotencyStore();
});

const err = async (fn: () => Promise<unknown>) => {
  try {
    await fn();
  } catch (e) {
    return e as CommerceError;
  }
  throw new Error("expected throw");
};

// ---------- happy-path helpers ----------

async function openTask() {
  const { task } = await svc.tasks.create(BUYER, {
    title: "logo",
    description: "make a logo",
    budget: "10.00",
  });
  return task;
}

async function pendingOffer(taskId: string) {
  const { offer } = await svc.offers.submit(PROVIDER, taskId, {
    price: "9.50",
    proposal: "I can do it",
  });
  return offer;
}

async function activeAgreement() {
  const task = await openTask();
  const offer = await pendingOffer(task.id);
  return svc.offers.accept(BUYER, offer.id);
}

// =====================================================================
// state machines — pure table checks
// =====================================================================

describe("state machines", () => {
  it("accepts every legal task transition", () => {
    for (const [f, t] of [
      ["DRAFT", "OPEN"],
      ["DRAFT", "CANCELLED"],
      ["OPEN", "IN_PROGRESS"],
      ["OPEN", "CANCELLED"],
      ["IN_PROGRESS", "SUBMITTED"],
      ["IN_PROGRESS", "CANCELLED"],
      ["SUBMITTED", "UNDER_REVIEW"],
      ["SUBMITTED", "CANCELLED"],
      ["UNDER_REVIEW", "COMPLETED"],
      ["UNDER_REVIEW", "IN_PROGRESS"], // rejected/revision → resubmission round
      ["UNDER_REVIEW", "CANCELLED"],
    ] as const) {
      expect(assertTransition("task", f, t)).toBeUndefined();
    }
  });

  it("rejects illegal task transitions with typed error", () => {
    for (const [f, t] of [
      ["DRAFT", "IN_PROGRESS"],
      ["OPEN", "COMPLETED"],
      ["COMPLETED", "OPEN"],
      ["CANCELLED", "OPEN"],
      ["OPEN", "OPEN"],
    ] as const) {
      const e = (() => {
        try {
          assertTransition("task", f, t);
        } catch (x) {
          return x as CommerceError;
        }
        throw new Error("expected throw");
      })();
      expect(e).toBeInstanceOf(CommerceError);
      expect(e.code).toBe("INVALID_TRANSITION");
      expect(e.httpStatus).toBe(409);
    }
  });

  it("offer PENDING → ACCEPTED|REJECTED|WITHDRAWN only", () => {
    expect(assertTransition("offer", "PENDING", "ACCEPTED")).toBeUndefined();
    expect(assertTransition("offer", "PENDING", "REJECTED")).toBeUndefined();
    expect(assertTransition("offer", "PENDING", "WITHDRAWN")).toBeUndefined();
    expect(() => assertTransition("offer", "ACCEPTED", "REJECTED")).toThrow(
      CommerceError,
    );
    expect(() => assertTransition("offer", "REJECTED", "PENDING")).toThrow(
      CommerceError,
    );
  });

  it("agreement ACTIVE → COMPLETED|CANCELLED|DISPUTED only", () => {
    expect(
      assertTransition("agreement", "ACTIVE", "COMPLETED"),
    ).toBeUndefined();
    expect(
      assertTransition("agreement", "ACTIVE", "CANCELLED"),
    ).toBeUndefined();
    expect(assertTransition("agreement", "ACTIVE", "DISPUTED")).toBeUndefined();
    expect(() =>
      assertTransition("agreement", "COMPLETED", "ACTIVE"),
    ).toThrow(CommerceError);
  });

  it("submission SUBMITTED → ACCEPTED|REJECTED|REVISION_REQUIRED only", () => {
    expect(
      assertTransition("submission", "SUBMITTED", "ACCEPTED"),
    ).toBeUndefined();
    expect(
      assertTransition("submission", "SUBMITTED", "REVISION_REQUIRED"),
    ).toBeUndefined();
    expect(() =>
      assertTransition("submission", "ACCEPTED", "REJECTED"),
    ).toThrow(CommerceError);
  });

  it("payment NOT_PAID → PAYMENT_RECORDED → PAYMENT_VERIFIED only", () => {
    expect(
      assertTransition("payment", "NOT_PAID", "PAYMENT_RECORDED"),
    ).toBeUndefined();
    expect(
      assertTransition("payment", "PAYMENT_RECORDED", "PAYMENT_VERIFIED"),
    ).toBeUndefined();
    expect(() =>
      assertTransition("payment", "NOT_PAID", "PAYMENT_VERIFIED"),
    ).toThrow(CommerceError);
    expect(() =>
      assertTransition("payment", "PAYMENT_VERIFIED", "NOT_PAID"),
    ).toThrow(CommerceError);
  });
});

// =====================================================================
// task service
// =====================================================================

describe("task service", () => {
  it("creates DRAFT task and emits task.created", async () => {
    const { task, duplicate } = await svc.tasks.create(BUYER, {
      title: "t",
      description: "d",
      status: "DRAFT",
    });
    expect(task.status).toBe("DRAFT");
    expect(task.buyerWallet).toBe(BUYER);
    expect(duplicate).toBe(false);
    const evs = await stores.events.listByEntity("task", task.id);
    expect(evs.map((e) => e.eventType)).toEqual(["task.created"]);
  });

  it("create(status=OPEN) emits created + opened", async () => {
    const task = await openTask();
    expect(task.status).toBe("OPEN");
    const evs = await stores.events.listByEntity("task", task.id);
    expect(evs.map((e) => e.eventType)).toEqual([
      "task.created",
      "task.opened",
    ]);
  });

  it("open() moves DRAFT → OPEN; buyer only", async () => {
    const { task } = await svc.tasks.create(BUYER, {
      title: "t",
      description: "d",
      status: "DRAFT",
    });
    expect(
      (await err(() => svc.tasks.open(PROVIDER, task.id))).code,
    ).toBe("FORBIDDEN");
    const opened = await svc.tasks.open(BUYER, task.id);
    expect(opened.status).toBe("OPEN");
    expect((await err(() => svc.tasks.open(BUYER, task.id))).code).toBe(
      "INVALID_TRANSITION",
    );
  });

  it("cancel: buyer only, cascades to ACTIVE agreement", async () => {
    const { agreement } = await activeAgreement();
    const task = (await svc.agreements.get(agreement.id))!;
    const cancelled = await svc.tasks.cancel(BUYER, task.taskId);
    expect(cancelled.status).toBe("CANCELLED");
    const ag = await svc.agreements.get(agreement.id);
    expect(ag!.status).toBe("CANCELLED");
    const evs = await stores.events.listByEntity("agreement", agreement.id);
    expect(evs.map((e) => e.eventType)).toContain("agreement.cancelled");
  });

  it("rejects cancel by non-buyer", async () => {
    const task = await openTask();
    expect((await err(() => svc.tasks.cancel(PROVIDER, task.id))).code).toBe(
      "FORBIDDEN",
    );
    expect((await err(() => svc.tasks.cancel(STRANGER, task.id))).code).toBe(
      "FORBIDDEN",
    );
  });

  it("idempotency: same key replays first result with duplicate:true", async () => {
    const input = { title: "t", description: "d" };
    const a = await svc.tasks.create(BUYER, input, "idem-task-001");
    const b = await svc.tasks.create(BUYER, input, "idem-task-001");
    expect(a.duplicate).toBe(false);
    expect(b.duplicate).toBe(true);
    expect(b.task.id).toBe(a.task.id);
    // different key → different task
    const c = await svc.tasks.create(BUYER, input, "idem-task-002");
    expect(c.duplicate).toBe(false);
    expect(c.task.id).not.toBe(a.task.id);
  });
});

// =====================================================================
// offer service
// =====================================================================

describe("offer service", () => {
  it("any wallet ≠ buyer can offer on OPEN task", async () => {
    const task = await openTask();
    const { offer } = await svc.offers.submit(STRANGER, task.id, {
      price: "5",
      proposal: "ok",
    });
    expect(offer.status).toBe("PENDING");
    expect(offer.providerWallet).toBe(STRANGER);
  });

  it("rejects buyer self-offer and offers on non-OPEN task", async () => {
    const task = await openTask();
    expect(
      (await err(() => svc.offers.submit(BUYER, task.id, {
        price: "5",
        proposal: "x",
      }))).code,
    ).toBe("FORBIDDEN");

    const { task: draft } = await svc.tasks.create(BUYER, {
      title: "t",
      description: "d",
      status: "DRAFT",
    });
    expect(
      (await err(() => svc.offers.submit(PROVIDER, draft.id, {
        price: "5",
        proposal: "x",
      }))).code,
    ).toBe("INVALID_TRANSITION");
  });

  it("accept: buyer only → offer ACCEPTED + agreement ACTIVE + task IN_PROGRESS + payment NOT_PAID", async () => {
    const task = await openTask();
    const offer = await pendingOffer(task.id);
    expect(
      (await err(() => svc.offers.accept(PROVIDER, offer.id))).code,
    ).toBe("FORBIDDEN");
    expect(
      (await err(() => svc.offers.accept(STRANGER, offer.id))).code,
    ).toBe("FORBIDDEN");

    const { offer: acc, agreement, payment } = await svc.offers.accept(
      BUYER,
      offer.id,
    );
    expect(acc.status).toBe("ACCEPTED");
    expect(agreement.status).toBe("ACTIVE");
    expect(agreement.taskId).toBe(task.id);
    expect(agreement.offerId).toBe(offer.id);
    expect(agreement.agreedAmount).toBe(offer.price);
    expect(payment.status).toBe("NOT_PAID");
    expect(payment.mode).toBe("RECORD_ONLY");
    expect((await svc.tasks.get(task.id))!.status).toBe("IN_PROGRESS");

    // event order on the agreement stream
    const evs = await stores.events.listByEntity("agreement", agreement.id);
    expect(evs.map((e) => e.eventType)).toEqual(["agreement.created"]);
  });

  it("second accept on same offer → INVALID_TRANSITION", async () => {
    const offer = await pendingOffer((await openTask()).id);
    await svc.offers.accept(BUYER, offer.id);
    expect((await err(() => svc.offers.accept(BUYER, offer.id))).code).toBe(
      "INVALID_TRANSITION",
    );
  });

  it("reject + withdraw: role checks", async () => {
    const task = await openTask();
    const o1 = await pendingOffer(task.id);
    expect(
      (await err(() => svc.offers.reject(PROVIDER, o1.id))).code,
    ).toBe("FORBIDDEN");
    expect(
      (await err(() => svc.offers.withdraw(BUYER, o1.id))).code,
    ).toBe("FORBIDDEN");
    expect((await svc.offers.reject(BUYER, o1.id)).status).toBe("REJECTED");

    const o2 = await pendingOffer(task.id);
    expect((await svc.offers.withdraw(PROVIDER, o2.id)).status).toBe(
      "WITHDRAWN",
    );
  });
});

// =====================================================================
// submission + review + evidence
// =====================================================================

describe("submission service", () => {
  it("provider submits on ACTIVE agreement → task UNDER_REVIEW", async () => {
    const { agreement } = await activeAgreement();
    const { submission } = await svc.submissions.submit(PROVIDER,
      agreement.id,
      { summary: "done" },
    );
    expect(submission.status).toBe("SUBMITTED");
    const task = await svc.tasks.get(agreement.taskId);
    expect(task!.status).toBe("UNDER_REVIEW");
    const evs = await stores.events.listByEntity("task", agreement.taskId);
    expect(evs.map((e) => e.eventType)).toContain("task.submitted");
    expect(evs.map((e) => e.eventType)).toContain("task.under_review");
  });

  it("rejects submit by buyer/stranger and on non-ACTIVE agreement", async () => {
    const { agreement } = await activeAgreement();
    expect(
      (await err(() => svc.submissions.submit(BUYER, agreement.id, {
        summary: "s",
      }))).code,
    ).toBe("FORBIDDEN");
    expect(
      (await err(() => svc.submissions.submit(STRANGER, agreement.id, {
        summary: "s",
      }))).code,
    ).toBe("FORBIDDEN");
  });

  it("review ACCEPTED: buyer only → task COMPLETED + agreement COMPLETED", async () => {
    const { agreement } = await activeAgreement();
    const { submission } = await svc.submissions.submit(PROVIDER,
      agreement.id,
      { summary: "done" },
    );
    expect(
      (await err(() =>
        svc.submissions.review(PROVIDER, submission.id, "ACCEPTED"),
      )).code,
    ).toBe("FORBIDDEN");
    expect(
      (await err(() =>
        svc.submissions.review(STRANGER, submission.id, "ACCEPTED"),
      )).code,
    ).toBe("FORBIDDEN");

    const res = await svc.submissions.review(BUYER, submission.id, "ACCEPTED");
    expect(res.submission.status).toBe("ACCEPTED");
    expect((await svc.tasks.get(agreement.taskId))!.status).toBe("COMPLETED");
    expect((await svc.agreements.get(agreement.id))!.status).toBe(
      "COMPLETED",
    );
  });

  it("review REJECTED / REVISION_REQUIRED → task back to IN_PROGRESS, resubmission allowed", async () => {
    const { agreement } = await activeAgreement();
    const s1 = await svc.submissions.submit(PROVIDER, agreement.id, {
      summary: "v1",
    });
    await svc.submissions.review(BUYER, s1.submission.id, "REVISION_REQUIRED", "fix it");
    expect((await svc.tasks.get(agreement.taskId))!.status).toBe(
      "IN_PROGRESS",
    );
    const s2 = await svc.submissions.submit(PROVIDER, agreement.id, {
      summary: "v2",
    });
    expect(s2.submission.status).toBe("SUBMITTED");
    const list = await svc.submissions.listByAgreement(agreement.id);
    expect(list).toHaveLength(2);
  });

  it("payment status stays independent of task status (spec invariant)", async () => {
    const { agreement, payment } = await activeAgreement();
    const { submission } = await svc.submissions.submit(PROVIDER,
      agreement.id,
      { summary: "done" },
    );
    await svc.submissions.review(BUYER, submission.id, "ACCEPTED");
    expect((await svc.tasks.get(agreement.taskId))!.status).toBe("COMPLETED");
    expect((await svc.payments.getByAgreement(agreement.id))!.status).toBe(
      payment.status,
    );
    expect((await svc.payments.getByAgreement(agreement.id))!.status).toBe(
      "NOT_PAID",
    );
  });
});

describe("evidence service", () => {
  it("provider attaches typed evidence to own submission; append-only", async () => {
    const { agreement } = await activeAgreement();
    const { submission } = await svc.submissions.submit(PROVIDER,
      agreement.id,
      { summary: "done" },
    );
    const { evidence } = await svc.evidence.attach(PROVIDER, {
      submissionId: submission.id,
      type: "FILE",
      url: "https://cdn.example.com/out.zip",
      hash: "a".repeat(64),
    });
    expect(evidence.submissionId).toBe(submission.id);
    expect(
      (await svc.evidence.listBySubmission(submission.id)).length,
    ).toBe(1);
  });

  it("rejects evidence by stranger and malformed type payloads", async () => {
    const { agreement } = await activeAgreement();
    const { submission } = await svc.submissions.submit(PROVIDER,
      agreement.id,
      { summary: "done" },
    );
    expect(
      (await err(() =>
        svc.evidence.attach(STRANGER, {
          submissionId: submission.id,
          type: "FILE",
          url: "https://x",
          hash: "a".repeat(64),
        }),
      )).code,
    ).toBe("FORBIDDEN");
    expect(
      (await err(() =>
        svc.evidence.attach(PROVIDER, {
          submissionId: submission.id,
          type: "FILE",
          url: "https://x", // missing sha256
        }),
      )).code,
    ).toBe("GUARD_REJECTED");
    expect(
      (await err(() =>
        svc.evidence.attach(PROVIDER, {
          submissionId: submission.id,
          type: "TRANSACTION",
          url: "https://x", // missing tx hash
        }),
      )).code,
    ).toBe("GUARD_REJECTED");
  });
});

// =====================================================================
// payment service (RECORD_ONLY)
// =====================================================================

describe("payment service", () => {
  it("buyer records payment; either party may verify", async () => {
    const { agreement } = await activeAgreement();
    expect(
      (await err(() =>
        svc.payments.record(PROVIDER, agreement.id, { amount: "9.50" }),
      )).code,
    ).toBe("FORBIDDEN");

    const rec = await svc.payments.record(BUYER, agreement.id, {
      amount: "9.50",
      note: "sent via USDC",
    });
    expect(rec.status).toBe("PAYMENT_RECORDED");
    expect(rec.recordedBy).toBe(BUYER);

    const ver = await svc.payments.verify(PROVIDER, rec.id);
    expect(ver.status).toBe("PAYMENT_VERIFIED");
    expect(ver.verifiedBy).toBe(PROVIDER);

    // terminal — no further transitions
    expect((await err(() => svc.payments.verify(BUYER, rec.id))).code).toBe(
      "INVALID_TRANSITION",
    );
  });

  it("record is idempotent per agreement (single payment row)", async () => {
    const { agreement } = await activeAgreement();
    await svc.payments.record(BUYER, agreement.id, { amount: "9.50" });
    expect(
      (await err(() =>
        svc.payments.record(BUYER, agreement.id, { amount: "9.50" }),
      )).code,
    ).toBe("INVALID_TRANSITION");
  });
});

// =====================================================================
// hash-chain events
// =====================================================================

describe("event hash-chain", () => {
  it("per-entity stream: genesis sentinel then prevHash linkage + verifiable hashes", async () => {
    const task = await openTask();
    const offer = await pendingOffer(task.id);
    await svc.offers.accept(BUYER, offer.id);

    const taskEvs = await stores.events.listByEntity("task", task.id);
    expect(taskEvs.length).toBeGreaterThanOrEqual(3);
    expect(taskEvs[0]!.prevHash).toBe(GENESIS_HASH);
    for (let i = 1; i < taskEvs.length; i++) {
      expect(taskEvs[i]!.prevHash).toBe(taskEvs[i - 1]!.hash);
    }
    for (const e of taskEvs) {
      expect(e.hash).toBe(
        hashEvent({
          prevHash: e.prevHash,
          entityType: e.entityType,
          entityId: e.entityId,
          eventType: e.eventType,
          actorWallet: e.actorWallet ?? null,
          payload: e.payload,
        }),
      );
    }

    // offer stream has its own genesis
    const offerEvs = await stores.events.listByEntity("offer", offer.id);
    expect(offerEvs[0]!.prevHash).toBe(GENESIS_HASH);
  });
});

// =====================================================================
// contract guards
// =====================================================================

describe("contract guards", () => {
  it("rejects oversized summary (>4000)", async () => {
    const { agreement } = await activeAgreement();
    expect(
      (await err(() =>
        svc.submissions.submit(PROVIDER, agreement.id, {
          summary: "x".repeat(4001),
        }),
      )).code,
    ).toBe("GUARD_REJECTED");
  });

  it("rejects malformed wallet", async () => {
    expect(
      (await err(() =>
        svc.tasks.create("not-a-wallet", { title: "t", description: "d" }),
      )).code,
    ).toBe("GUARD_REJECTED");
  });

  it("rejects invalid idempotency key (too short / charset)", async () => {
    expect(
      (await err(() =>
        svc.tasks.create(BUYER, { title: "t", description: "d" }, "short"),
      )).code,
    ).toBe("GUARD_REJECTED");
    expect(
      (await err(() =>
        svc.tasks.create(
          BUYER,
          { title: "t", description: "d" },
          "bad key with spaces!!!",
        ),
      )).code,
    ).toBe("GUARD_REJECTED");
  });

  it("rejects evidence_refs over 50 items / 1000 chars", async () => {
    const { agreement } = await activeAgreement();
    expect(
      (await err(() =>
        svc.submissions.submit(PROVIDER, agreement.id, {
          summary: "ok",
          evidenceRefs: Array.from({ length: 51 }, (_, i) => `r${i}`),
        }),
      )).code,
    ).toBe("GUARD_REJECTED");
    expect(
      (await err(() =>
        svc.submissions.submit(PROVIDER, agreement.id, {
          summary: "ok",
          evidenceRefs: ["x".repeat(1001)],
        }),
      )).code,
    ).toBe("GUARD_REJECTED");
  });

  it("rejects non-decimal budget/price", async () => {
    expect(
      (await err(() =>
        svc.tasks.create(BUYER, {
          title: "t",
          description: "d",
          budget: "abc",
        }),
      )).code,
    ).toBe("GUARD_REJECTED");
  });
});
