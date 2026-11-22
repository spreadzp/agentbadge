/**
 * EPIC-229 (SLICE-229-9): detail-page taxonomy sections —
 * capabilities tags, relations (both directions + add/remove forms
 * + SUPERSEDES withdraw hint), evidence on the latest version,
 * and the edit-draft form. Split from detail.ts (300-line guard).
 */

import { html } from "hono/html";

import type {
  KnowledgeCapabilityRecord,
  KnowledgeEvidenceRecord,
  KnowledgeItemRecord,
} from "../../server/lib/knowledge/types";
import type { KnowledgeRelations } from "../../server/lib/knowledge/relations";
import { KNOWLEDGE_RELATION_TYPES } from "../../server/lib/knowledge/types";
import { emptyMsg, tableShell, td } from "../finops/shared";
import { miniForm, textInput, tokenField } from "./shared";

export interface TaxonomyInput {
  item: KnowledgeItemRecord;
  capabilities: KnowledgeCapabilityRecord[];
  allCapabilities: KnowledgeCapabilityRecord[];
  relations: KnowledgeRelations;
  items: KnowledgeItemRecord[];
  evidence: KnowledgeEvidenceRecord[];
  supersededBySlug: string | null;
  latestTitle: string;
  latestBody: string;
  latestSummary: string | null;
  /** Arc R2 M-8: seq at render — the edit form posts it back as the
   *  lost-update precondition. */
  latestSeq: number | null;
  editable: boolean;
}

const section = (title: string, body: unknown) => html`<div
  class="mt-5 rounded border border-slate-800 bg-slate-950/60 p-3"
>
  <h2 class="mb-2 text-sm font-semibold text-slate-300">${title}</h2>
  ${body}
</div>`;

const capabilitiesSection = (i: TaxonomyInput) => {
  const linked = new Set(i.capabilities.map((c) => c.id));
  const linkable = i.allCapabilities.filter((c) => !linked.has(c.id));
  return section(
    "Capabilities",
    html`<div class="mb-2 flex flex-wrap gap-1.5">
        ${i.capabilities.length === 0
          ? html`<span class="text-xs text-slate-500">none linked</span>`
          : i.capabilities.map(
              (cap) => html`<span
                class="inline-flex items-center gap-1 rounded bg-indigo-900/60 px-2 py-0.5 text-[11px] text-indigo-300"
                >${cap.name}
                <form
                  method="post"
                  action="/admin/knowledge/${i.item.id}/capability/unlink"
                  class="inline"
                >
                  ${tokenField()}
                  <input
                    type="hidden"
                    name="capabilityId"
                    value="${cap.id}"
                  />
                  <button type="submit" class="text-indigo-500 hover:text-indigo-200"
                    >×</button
                  >
                </form>
              </span>`,
            )}
      </div>
      ${linkable.length > 0
        ? miniForm(
            `/admin/knowledge/${i.item.id}/capability/link`,
            html`<select
              name="capabilityId"
              class="rounded border border-slate-700 bg-slate-900 px-2 py-1 text-xs text-slate-200"
            >
              ${linkable.map(
                (cap) =>
                  html`<option value="${cap.id}">${cap.name}</option>`,
              )}
            </select>`,
            "Link",
          )
        : ""}`,
  );
};

const relationsSection = (i: TaxonomyInput) => {
  const edgeRows = (edges: KnowledgeRelations["outgoing"]) =>
    edges.map(
      (e) => html`<tr>
        ${td(e.type)} ${td(html`<a
          href="/admin/knowledge/${e.item.id}"
          class="text-emerald-400 hover:underline"
          >${e.item.slug}</a
        >`)}
        ${td(
          html`<form
            method="post"
            action="/admin/knowledge/${i.item.id}/relation/remove"
          >
            ${tokenField()}
            <input type="hidden" name="relationId" value="${e.relationId}" />
            <button
              type="submit"
              class="rounded bg-slate-800 px-2 py-0.5 text-[11px] text-slate-300 hover:text-slate-100"
              >remove</button
            >
          </form>`,
          false,
        )}
      </tr>`,
    );
  const supHint =
    i.relations.outgoing.some((e) => e.type === "SUPERSEDES") ||
    i.supersededBySlug !== null
      ? html`<p class="mb-2 rounded border border-amber-800/60 bg-amber-950/40 px-2 py-1 text-[11px] text-amber-300">
          SUPERSEDES edge present —
          ${i.supersededBySlug
            ? `this item is superseded by ${i.supersededBySlug}; consider withdrawing it.`
            : "consider withdrawing the superseded item."}
        </p>`
      : "";
  return section(
    "Relations",
    html`${supHint}
      ${i.relations.outgoing.length === 0 && i.relations.incoming.length === 0
        ? emptyMsg("No edges.")
        : tableShell(
            ["type", "peer", ""],
            html`${edgeRows(i.relations.outgoing)}${edgeRows(
              i.relations.incoming,
            )}`,
          )}
      ${miniForm(
        `/admin/knowledge/${i.item.id}/relation/add`,
        html`<select
            name="type"
            class="rounded border border-slate-700 bg-slate-900 px-2 py-1 text-xs text-slate-200"
          >
            ${KNOWLEDGE_RELATION_TYPES.map(
              (t) => html`<option value="${t}">${t}</option>`,
            )}
          </select>
          <select
            name="toItemId"
            class="rounded border border-slate-700 bg-slate-900 px-2 py-1 text-xs text-slate-200"
          >
            ${i.items
              .filter((x) => x.id !== i.item.id)
              .map((x) => html`<option value="${x.id}">${x.slug}</option>`)}
          </select>`,
        "Add edge",
      )}`,
  );
};

const evidenceSection = (i: TaxonomyInput) =>
  section(
    "Evidence — latest version",
    html`${i.evidence.length === 0
        ? emptyMsg("No evidence refs.")
        : tableShell(
            ["type", "uri", "label", ""],
            html`${i.evidence.map(
              (e) => html`<tr>
                ${td(e.type)} ${td(e.uri, false)} ${td(e.label ?? "—", false)}
                ${td(
                  i.editable
                    ? html`<form
                        method="post"
                        action="/admin/knowledge/${i.item.id}/evidence/remove"
                      >
                        ${tokenField()}
                        <input
                          type="hidden"
                          name="evidenceId"
                          value="${e.id}"
                        />
                        <button
                          type="submit"
                          class="rounded bg-slate-800 px-2 py-0.5 text-[11px] text-slate-300 hover:text-slate-100"
                          >remove</button
                        >
                      </form>`
                    : html`<span class="text-[11px] text-slate-600">frozen</span>`,
                  false,
                )}
              </tr>`,
            )}`,
          )}
      ${i.editable
        ? miniForm(
            `/admin/knowledge/${i.item.id}/evidence/add`,
            html`<select
                name="type"
                class="rounded border border-slate-700 bg-slate-900 px-2 py-1 text-xs text-slate-200"
              >
                ${["INTERNAL_DOC", "EXTERNAL_URL", "ONCHAIN_TX", "API_ENDPOINT", "SCAN_REPORT"].map(
                  (t) => html`<option value="${t}">${t}</option>`,
                )}
              </select>
              ${textInput("uri", "uri — https://… or /path")}
              ${textInput("label", "label (optional)")}`,
            "Add evidence",
          )
        : emptyMsg(
            "Evidence is frozen once the item leaves DRAFT — the " +
              "verifier reviews exactly the submitted set.",
          )}`,
  );

const editSection = (i: TaxonomyInput) =>
  i.editable
    ? section(
        "Edit draft (appends a new version)",
        html`<form
          method="post"
          action="/admin/knowledge/${i.item.id}/update"
          class="flex flex-col gap-2"
        >
          ${tokenField()}
          <input
            type="hidden"
            name="expectedSeq"
            value="${i.latestSeq ?? ""}"
          />
          <input
            type="text"
            name="title"
            value="${i.latestTitle}"
            class="rounded border border-slate-700 bg-slate-900 px-2 py-1 text-xs text-slate-200"
          />
          <textarea
            name="body"
            rows="6"
            class="rounded border border-slate-700 bg-slate-900 px-2 py-1 text-xs text-slate-200"
            >${i.latestBody}</textarea
          >
          <input
            type="text"
            name="summary"
            value="${i.latestSummary ?? ""}"
            placeholder="summary"
            class="rounded border border-slate-700 bg-slate-900 px-2 py-1 text-xs text-slate-200"
          />
          <div>
            <button
              type="submit"
              class="rounded bg-emerald-800 px-3 py-1 text-xs text-emerald-100 hover:bg-emerald-700"
              >Save new version</button
            >
          </div>
        </form>`,
      )
    : "";

export const taxonomyFragment = (i: TaxonomyInput) => html`
  ${capabilitiesSection(i)} ${relationsSection(i)} ${evidenceSection(i)}
  ${editSection(i)}
`;
