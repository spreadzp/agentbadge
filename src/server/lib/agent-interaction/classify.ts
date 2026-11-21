/**
 * EPIC-228 (SLICE-228-2, D-228-5): operator classification.
 *
 * `classify` validates the body against the vocabulary (closed dicts
 * for intent/signalType, bounded lists for topics/entities/
 * demandSignals), then calls `stores.interactions.classify` — patch
 * + `interaction.request.classified` INTERNAL event land in one unit
 * and the first classification moves submitted → working.
 * Re-classification is legal; provided keys win, unset keys keep.
 */

import type { InboxRequestRecord } from "../request-inbox/types";
import type { RequestInboxStores } from "../request-inbox/store";
import { buildEvent, emitInteractionHooks } from "./events";
import {
  validateClassifyInput,
  type ClassifyInput,
} from "./vocabulary";

export type ClassifyResult =
  | { ok: true; record: InboxRequestRecord; transitioned: boolean }
  | { ok: false; error: string; field?: string }
  | { ok: false; error: "not_found" };

export async function classify(
  stores: RequestInboxStores,
  requestId: string,
  input: ClassifyInput,
  operatorRef: string,
): Promise<ClassifyResult> {
  const v = validateClassifyInput(input);
  if (!v.ok) return { ok: false, error: v.error, field: v.field };
  if (Object.keys(v.patch).length === 0) {
    return { ok: false, error: "empty classification", field: "body" };
  }
  // Arc-audit M4: same lazy-expiry gap as respond/reject — patching a
  // row the agent already sees as 410 is a split-brain transition.
  const { expired } = await stores.requests.get(requestId);
  if (expired) return { ok: false, error: "request expired" };

  const event = buildEvent("interaction.request.classified", "INTERNAL", {
    requestId,
    operatorRef,
    patch: v.patch,
  });
  const res = await stores.interactions.classify(
    requestId,
    { ...v.patch, classifiedBy: operatorRef },
    [event],
  );
  if (!res) return { ok: false, error: "not_found" };
  emitInteractionHooks(requestId, [event]);
  return { ok: true, record: res.record, transitioned: res.transitioned };
}
