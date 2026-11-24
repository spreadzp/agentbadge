import { describe, it, expect, beforeEach } from "vitest";

import type { DemandStore } from "../../src/server/lib/demand/store";
import { createMemoryDemandStores } from "../../src/server/lib/demand/db-stores";
import {
  recordInteractionDemand,
  recordGapDemand,
  recordFeedbackDemand,
} from "../../src/server/lib/demand/seams";
import { DEMAND_TEXT_MAX } from "../../src/server/lib/demand/pipeline";

/**
 * SLICE-231-4: source seams — typed contracts writing through
 * ingestDemand with each DemandSource enum, deterministic
 * idempotency, actor attribution per D-228-1.
 */

let store: DemandStore;
const NOW = 1_764_000_000_000; // fixed ms — same dedupe window

beforeEach(() => {
  store = createMemoryDemandStores();
});

describe("recordInteractionDemand (228 seam)", () => {
  it("writes a signal with source=INTERACTION + request actor", async () => {
    const r = await recordInteractionDemand(store, {
      signal: "escrow-api",
      requestId: "ireq_abc123",
      actor: { resolution: "API_KEY", actorRef: "agent_1" },
      sessionId: "isess_9",
      now: NOW,
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const s = r.signal;
    expect(s.source).toBe("INTERACTION");
    expect(s.sourceRef).toBe("ireq_abc123");
    expect(s.actorResolution).toBe("API_KEY");
    expect(s.actorRef).toBe("agent_1");
    expect(s.sessionId).toBe("isess_9");
    expect(s.declaredLevel).toBe("INTEREST"); // operator-observed
    expect(s.normalizedText).toBe("escrow-api");
  });

  it("re-classification with the same signals replays — no dup", async () => {
    const input = {
      signal: "escrow-api",
      requestId: "ireq_abc123",
      actor: { resolution: "ANON" as const, actorRef: null },
      now: NOW,
    };
    const r1 = await recordInteractionDemand(store, input);
    const r2 = await recordInteractionDemand(store, input);
    expect(r1.ok && r2.ok).toBe(true);
    if (r1.ok && r2.ok) {
      expect(r2.duplicate).toBe(true);
      expect(r2.signal.id).toBe(r1.signal.id);
    }
    expect((await store.listSignals()).length).toBe(1);
  });

  it("distinct signals on one request mint distinct rows", async () => {
    const actor = { resolution: "DID" as const, actorRef: "did:hcs:x:1" };
    await recordInteractionDemand(store, {
      signal: "escrow-api",
      requestId: "ireq_1",
      actor,
      now: NOW,
    });
    await recordInteractionDemand(store, {
      signal: "audit trail export",
      requestId: "ireq_1",
      actor,
      now: NOW,
    });
    expect((await store.listSignals()).length).toBe(2);
  });

  it("passes caller category/feature/capabilityKey through", async () => {
    const r = await recordInteractionDemand(store, {
      signal: "escrow payouts",
      requestId: "ireq_2",
      actor: { resolution: "ANON", actorRef: null },
      category: "payments",
      feature: "escrow",
      capabilityKey: "payments",
      now: NOW,
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.signal.category).toBe("payments");
    expect(r.signal.feature).toBe("escrow");
    expect(r.signal.capabilityKey).toBe("payments");
    expect(r.cluster.clusterKey).toBe("dict:payments|escrow");
  });
});

describe("recordGapDemand (229 seam)", () => {
  it("writes source=KNOWLEDGE_GAP from an actorless gap", async () => {
    const r = await recordGapDemand(store, {
      gapId: "kgap_1",
      query: "how do I verify an ed25519 attestation",
      capabilityRef: "identity",
      now: NOW,
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.signal.source).toBe("KNOWLEDGE_GAP");
    expect(r.signal.sourceRef).toBe("kgap_1");
    expect(r.signal.capabilityKey).toBe("identity");
    expect(r.signal.actorResolution).toBe("ANON");
    expect(r.signal.actorRef).toBeNull(); // unattributed bucket
    expect(r.signal.declaredLevel).toBe("INTEREST");
  });

  it("detected vs reopened are distinct signals; same reason replays", async () => {
    const gap = { gapId: "kgap_2", query: "escrow refunds", now: NOW };
    const d1 = await recordGapDemand(store, { ...gap, reason: "detected" });
    const d2 = await recordGapDemand(store, { ...gap, reason: "detected" });
    const ro = await recordGapDemand(store, { ...gap, reason: "reopened" });
    expect(d1.ok && d2.ok && ro.ok).toBe(true);
    if (d2.ok) expect(d2.duplicate).toBe(true);
    expect((await store.listSignals()).length).toBe(2);
  });
});

describe("recordFeedbackDemand (230 seam)", () => {
  it("writes source=FEEDBACK with INTENT declaredLevel", async () => {
    const r = await recordFeedbackDemand(store, {
      feedbackId: "fb_1",
      text: "please add batch escrow settlement",
      actor: { resolution: "DID", actorRef: "did:hcs:x:7" },
      now: NOW,
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.signal.source).toBe("FEEDBACK");
    expect(r.signal.sourceRef).toBe("fb_1");
    expect(r.signal.declaredLevel).toBe("INTENT");
    expect(r.signal.actorRef).toBe("did:hcs:x:7");
  });

  it("one demand signal per feedback row — replay dedupes", async () => {
    const input = {
      feedbackId: "fb_2",
      text: "add webhooks",
      actor: { resolution: "API_KEY" as const, actorRef: "agent_9" },
      now: NOW,
    };
    await recordFeedbackDemand(store, input);
    const r2 = await recordFeedbackDemand(store, input);
    expect(r2.ok && r2.duplicate).toBe(true);
    expect((await store.listSignals()).length).toBe(1);
  });

  it("clamps oversized feedback text to DEMAND_TEXT_MAX", async () => {
    const r = await recordFeedbackDemand(store, {
      feedbackId: "fb_3",
      text: "x".repeat(DEMAND_TEXT_MAX + 500),
      actor: { resolution: "ANON", actorRef: null },
      now: NOW,
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.signal.normalizedText.length).toBeLessThanOrEqual(
      DEMAND_TEXT_MAX,
    );
  });
});

describe("seam level safety", () => {
  it("VERIFIED_DEMAND claims are clamped by the pipeline (§16.1)", async () => {
    const r = await recordFeedbackDemand(store, {
      feedbackId: "fb_4",
      text: "verified demand for escrow",
      actor: { resolution: "ANON", actorRef: null },
      declaredLevel: "VERIFIED_DEMAND",
      now: NOW,
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.signal.declaredLevel).toBe("PURCHASE_INTENT");
    expect(r.signal.level).toBe("PURCHASE_INTENT");
  });
});
