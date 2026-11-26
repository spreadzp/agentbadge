/**
 * EPIC-230 (SLICE-230-5, D-230-11): Review detail — full case,
 * platform criteria template, agent criteria context, both-side
 * evidence table, append-only decision log, INTERNAL timeline.
 * Everything agent-supplied renders escaped (hono/html default).
 */

import { html } from "hono/html";

import { criteriaForReview } from "../../server/lib/reviews/criteria";
import type { AiSuggestionView } from "../../server/lib/ai/intake";
import { aiSuggestionSection } from "../admin-interactions/ai-suggestion";
import type {
  ReviewCaseRecord,
  ReviewDecisionRecord,
  ReviewEventRecord,
  ReviewEvidenceRecord,
} from "../../server/lib/reviews/types";
import { emptyMsg, fmtMs, kv, tableShell, td } from "../finops/shared";
import {
  flashBanner,
  fmtIso,
  queueTabs,
  rcActorPill,
  reviewCenterShell,
  rvPill,
  VIS_PILL,
} from "./shared";
import {
  claimForm,
  convertForm,
  decideForm,
  declineForm,
  evidenceForm,
  reopenForm,
  returnForm,
} from "./review-forms";

function metaSection(r: ReviewCaseRecord) {
  return html`<section
      class="mb-4 rounded-lg border border-slate-800 bg-slate-900 p-3"
    >
      <h2 class="mb-2 text-sm font-semibold text-slate-200">
        ${rvPill(r.status)} ${r.id}
      </h2>
      ${kv("reviewType", r.reviewType)}
      ${kv("actor", html`${rcActorPill(r.actorResolution)} <span class="ml-1 font-mono text-slate-300">${r.actorRef ?? "—"}</span>`)}
      ${kv("assignee", r.assignee ?? "—")}
      ${kv("declineReason", r.declineReason ?? "—")}
      ${kv("reopenCount", r.reopenCount)}
      ${kv("latestDecisionSeq", r.latestDecisionSeq ?? "—")}
      ${kv("knowledgeConverted", r.knowledgeConverted ? "yes" : "no")}
      ${r.knowledgeItemId ? kv("knowledgeItem", r.knowledgeItemId) : ""}
      ${kv("created", fmtIso(r.createdAt))}
      ${kv("claimed", fmtIso(r.claimedAt))}
      ${kv("decided", fmtIso(r.decidedAt))}
      ${kv("delivered", fmtIso(r.deliveredAt))}
    </section>`;
}

function workSection(r: ReviewCaseRecord) {
  const wishes = Array.isArray(r.agentCriteria)
    ? (r.agentCriteria as string[])
    : [];
  return html`<section
      class="mb-4 rounded-lg border border-slate-800 bg-slate-900 p-3"
    >
      <h3 class="mb-2 text-xs font-semibold uppercase text-slate-500">
        Work under review
      </h3>
      <pre
        class="whitespace-pre-wrap break-words font-mono text-sm text-slate-200"
      >${r.workRef}</pre>
      ${wishes.length > 0
        ? html`<h4
            class="mb-1 mt-3 text-xs font-semibold uppercase text-slate-500"
          >
            Agent criteria — wishes only, NOT scored (D-230-6)
          </h4>
          <ul class="list-inside list-disc text-sm text-slate-300">
            ${wishes.map((w) => html`<li>${w}</li>`)}
          </ul>`
        : ""}
      <h4 class="mb-1 mt-3 text-xs font-semibold uppercase text-slate-500">
        Platform rubric (${r.reviewType})
      </h4>
      <ul class="text-sm text-slate-300">
        ${criteriaForReview(r.reviewType).map(
          (c) =>
            html`<li>
              <code class="text-emerald-400">${c.key}</code> — ${c.label}
              ${c.required
                ? html`<span class="ml-1 text-amber-400">required</span>`
                : html`<span class="ml-1 text-slate-500">optional</span>`}
            </li>`,
        )}
      </ul>
    </section>`;
}

function evidenceSection(rows: ReviewEvidenceRecord[]) {
  return html`<section
      class="mb-4 rounded-lg border border-slate-800 bg-slate-900 p-3"
    >
      <h3 class="mb-2 text-xs font-semibold uppercase text-slate-500">
        Evidence (${rows.length}/50)
      </h3>
      ${rows.length === 0
        ? emptyMsg("No evidence submitted.")
        : tableShell(
            ["type", "uri", "label", "submittedBy", "added"],
            html`${rows.map(
              (e) => html`<tr>
                ${td(e.type)}
                ${td(html`<span class="break-all">${e.uri}</span>`, false)}
                ${td(e.label ?? "—")}
                ${td(e.submittedBy)}
                ${td(fmtIso(e.createdAt))}
              </tr>`,
            )}`,
          )}
    </section>`;
}

function decisionsSection(rows: ReviewDecisionRecord[]) {
  return html`<section
      class="mb-4 rounded-lg border border-slate-800 bg-slate-900 p-3"
    >
      <h3 class="mb-2 text-xs font-semibold uppercase text-slate-500">
        Decisions — append-only
      </h3>
      ${rows.length === 0
        ? emptyMsg("No decisions yet.")
        : html`<ul class="space-y-2">
            ${rows.map(
              (d) => html`<li
                class="rounded border border-slate-800 p-2 text-sm"
              >
                <div class="mb-1 flex flex-wrap items-baseline gap-2">
                  <span class="font-mono text-slate-500">seq ${d.seq}</span>
                  ${rvPill(d.outcome)}
                  <span class="text-slate-400">by ${d.decidedBy}</span>
                  <span class="text-slate-500">${fmtIso(d.decidedAt)}</span>
                </div>
                <p class="text-slate-200">${d.summary}</p>
                <ul class="mt-1 text-xs text-slate-400">
                  ${(Array.isArray(d.criteriaResults)
                    ? (d.criteriaResults as {
                        key: string;
                        result: string;
                        note?: string;
                      }[])
                    : []
                  ).map(
                    (cr) =>
                      html`<li>
                        <code>${cr.key}</code>: ${cr.result}${cr.note
                          ? ` — ${cr.note}`
                          : ""}
                      </li>`,
                  )}
                </ul>
              </li>`,
            )}
          </ul>`}
    </section>`;
}

function eventsSection(events: ReviewEventRecord[]) {
  return html`<section
      class="rounded-lg border border-slate-800 bg-slate-900 p-3"
    >
      <h3 class="mb-2 text-xs font-semibold uppercase text-slate-500">
        Event log
      </h3>
      ${events.length === 0
        ? emptyMsg("No events.")
        : html`<ul class="space-y-1.5 text-xs">
            ${events.map(
              (e) => html`<li class="flex flex-wrap items-baseline gap-2">
                <span class="font-mono text-slate-500">#${e.seq}</span>
                ${html`<span
                  class="rounded px-1 py-0.5 text-[10px] ${VIS_PILL[e.visibility] ?? ""}"
                  >${e.visibility}</span
                >`}
                <span class="text-slate-300">${e.kind}</span>
                <span class="text-slate-500">${fmtMs(Date.parse(e.createdAt))}</span>
                <code class="break-all text-slate-400"
                  >${JSON.stringify(e.payload)}</code
                >
              </li>`,
            )}
          </ul>`}
    </section>`;
}

export function reviewDetailPage(input: {
  record: ReviewCaseRecord;
  evidence: ReviewEvidenceRecord[];
  decisions: ReviewDecisionRecord[];
  events: ReviewEventRecord[];
  /** 232-6 E5: advisory extraction suggestions (advisory block). */
  aiSuggestions?: AiSuggestionView[];
  formToken: string;
  flash?: { ok?: string; err?: string };
}): string {
  const r = input.record;
  const body = html`
    ${queueTabs("reviews", "all")} ${flashBanner(input.flash ?? {})}
    ${metaSection(r)} ${workSection(r)} ${evidenceSection(input.evidence)}
    ${aiSuggestionSection(input.aiSuggestions ?? [])}
    ${decisionsSection(input.decisions)}
    ${claimForm(r, input.formToken)}
    ${decideForm(
      r,
      input.formToken,
      // 232-7 E6: the latest visible advisory run is the ref the
      // human decision may cite — null when nothing was suggested.
      input.aiSuggestions?.find(
        (s) => s.scenario === "review_assist" && s.status === "success",
      )?.runId ?? null,
    )}
    ${declineForm(r, input.formToken)} ${reopenForm(r, input.formToken)}
    ${returnForm(r, input.formToken)} ${evidenceForm(r, input.formToken)}
    ${convertForm(r, input.formToken)}
    ${eventsSection(input.events)}
  `;
  return reviewCenterShell(`Review ${r.id}`, body).toString();
}
