import { describe, expect, it } from "vitest";

import {
  createMemoryFeedbackData,
  createMemoryFeedbackStore,
} from "../../src/server/lib/feedback/store-memory";
import {
  createMemoryReviewData,
  createMemoryReviewStore,
} from "../../src/server/lib/reviews/store-memory";
import { createMemoryKnowledgeStores } from "../../src/server/lib/knowledge/db-stores";
import {
  knowledgeDraftPort,
  unavailableDraftPort,
} from "../../src/server/lib/knowledge-draft/port";
import {
  convertFeedbackToDraft,
  convertReviewToDraft,
  draftExportPayload,
  feedbackDraftInput,
  reviewDraftInput,
} from "../../src/server/lib/knowledge-draft/convert";
import { submitFeedback } from "../../src/server/lib/feedback/service";
import {
  triageFeedback,
  resolveFeedback,
} from "../../src/server/lib/feedback/workflow";
import { submitReview, decideReview } from "../../src/server/lib/reviews";
import { claimReview } from "../../src/server/lib/reviews/workflow";
import { criteriaForReview } from "../../src/server/lib/reviews/criteria";

/**
 * SLICE-230-6 DoD — KnowledgeDraftPort seam: ACCEPTED feedback and
 * DECIDED reviews convert into real 229 DRAFTs; status guards and
 * already_converted hold; unavailable port → not_available +
 * JSON export; converted entities carry knowledgeItemId +
 * INTERNAL knowledge_converted event.
 */

const fbStore = () => createMemoryFeedbackStore(createMemoryFeedbackData());
const rvStore = () => createMemoryReviewStore(createMemoryReviewData());

import type { ResolvedActor } from "../../src/server/lib/agent-interaction/actor";

const actor = (over?: Partial<ResolvedActor>): ResolvedActor => ({
  resolution: "API_KEY",
  actorRef: "agt_2306",
  verified: true,
  ...over,
});

describe("convertFeedbackToDraft", () => {
  const accepted = async (store: ReturnType<typeof fbStore>) => {
    const s = await submitFeedback(
      store,
      { text: "the settle docs miss a retry example", kind: "DOCS", target: "docs" },
      actor(),
    );
    if (!s.ok) throw new Error("submit failed");
    const id = s.record.id;
    await triageFeedback(store, id, {}, "ops_t");
    const r = await resolveFeedback(store, id, "ACCEPTED", "ops_t");
    if (!r.ok) throw new Error("resolve failed");
    return id;
  };

  it("RECEIVED/TRIAGED → not_convertible_status; ACCEPTED → draft", async () => {
    const store = fbStore();
    const ks = createMemoryKnowledgeStores();
    const port = knowledgeDraftPort(ks);

    const s = await submitFeedback(store, { text: "raw note" }, actor());
    if (!s.ok) throw new Error("submit");
    const early = await convertFeedbackToDraft(store, port, s.record.id, "ops_t");
    expect(early).toEqual({ ok: false, error: "not_convertible_status" });

    const id = await accepted(store);
    const conv = await convertFeedbackToDraft(store, port, id, "ops_t");
    if (!conv.ok) throw new Error(`convert failed: ${conv.error}`);
    expect(conv.knowledgeItemId).toMatch(/^ki_/);

    const rec = await store.getFeedback(id);
    expect(rec?.knowledgeConverted).toBe(true);
    expect(rec?.knowledgeItemId).toBe(conv.knowledgeItemId);

    const item = await ks.getItem(conv.knowledgeItemId);
    expect(item?.status).toBe("DRAFT"); // 229 approval stays human
    expect(item?.createdBy).toBe("ops_t");

    const events = await store.listEvents(id);
    const convEv = events.find(
      (e) => e.kind === "feedback.knowledge_converted",
    );
    expect(convEv?.visibility).toBe("INTERNAL");
    expect((convEv?.payload as { actor: string }).actor).toBe("ops_t");

    const again = await convertFeedbackToDraft(store, port, id, "ops_t");
    expect(again).toEqual({ ok: false, error: "already_converted" });
  });

  it("unavailable port → not_available; draft.json payload exportable", async () => {
    const store = fbStore();
    const id = await accepted(store);
    const r = await convertFeedbackToDraft(
      store,
      unavailableDraftPort(),
      id,
      "ops_t",
    );
    expect(r).toEqual({ ok: false, error: "not_available" });

    const rec = await store.getFeedback(id);
    const payload = JSON.parse(
      draftExportPayload(feedbackDraftInput(rec!), `feedback:${id}`),
    );
    expect(payload.sourceRef).toBe(`feedback:${id}`);
    expect(payload.title).toContain("Feedback DOCS/docs");
    expect(payload.body).toContain("retry example");
    // a failed convert must NOT mark the row
    expect(rec?.knowledgeConverted).toBe(false);
  });
});

describe("convertReviewToDraft", () => {
  it("DECIDED → draft with mapped evidence; PENDING → refused", async () => {
    const store = rvStore();
    const ks = createMemoryKnowledgeStores();
    const port = knowledgeDraftPort(ks);

    const s = await submitReview(
      store,
      {
      reviewType: "DOCS",
      workRef: "https://docs.example.org/guide",
      evidence: [
        {
          type: "EXTERNAL_URL",
          uri: "https://docs.example.org/guide",
          label: "guide",
        },
      ],
      },
      actor(),
    );
    if (!s.ok) throw new Error("submit");
    const id = s.record.id;

    const early = await convertReviewToDraft(store, port, id, "ops_t");
    expect(early).toEqual({ ok: false, error: "not_convertible_status" });

    await claimReview(store, id, "ops_t");
    const criteriaResults = criteriaForReview("DOCS").map((c) => ({
      key: c.key,
      result: "PASS",
    }));
    const d = await decideReview(
      store,
      id,
      { outcome: "APPROVED", summary: "solid guide", criteriaResults },
      "ops_t",
    );
    if (!d.ok) throw new Error(`decide: ${d.error}`);

    const conv = await convertReviewToDraft(store, port, id, "ops_t");
    if (!conv.ok) throw new Error(`convert: ${conv.error}`);

    const rec = await store.getReview(id);
    expect(rec?.knowledgeConverted).toBe(true);

    const item = await ks.getItem(conv.knowledgeItemId);
    expect(item?.status).toBe("DRAFT");

    const versions = await ks.listVersions(conv.knowledgeItemId);
    expect(versions).toHaveLength(1);
    const ev = await ks.listEvidence(versions[0]!.id);
    expect(ev).toHaveLength(1);
    expect(ev[0]!.type).toBe("EXTERNAL_URL");

    const again = await convertReviewToDraft(store, port, id, "ops_t");
    expect(again).toEqual({ ok: false, error: "already_converted" });
  });

  it("export payload carries sourceRef + mapped evidence", async () => {
    const store = rvStore();
    const s = await submitReview(
      store,
      {
      reviewType: "API_SURFACE",
      workRef: "https://api.example.org",
      evidence: [
        { type: "REPO_LINK", uri: "https://github.com/o/r", label: null },
        { type: "ARTIFACT_REF", uri: "internal://artifacts/x", label: null },
      ],
      },
      actor(),
    );
    if (!s.ok) throw new Error("submit");
    const rec = await store.getReview(s.record.id);
    const evidence = await store.listEvidence(s.record.id);
    const payload = JSON.parse(
      draftExportPayload(
        reviewDraftInput(rec!, evidence, []),
        `review:${s.record.id}`,
      ),
    );
    expect(payload.sourceRef).toBe(`review:${s.record.id}`);
    expect(payload.evidence[0].type).toBe("EXTERNAL_URL"); // REPO_LINK mapped
    expect(payload.evidence[1].type).toBe("INTERNAL_DOC"); // ARTIFACT_REF
  });
});
