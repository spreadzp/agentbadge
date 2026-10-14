/**
 * SLICE-180-2 (EPIC-180): /verify — human-facing verdict verification
 * page. SSR, no JS framework: a single input accepts a verdict ID, an
 * anchor tx hash, or a memo id; the resolved verdict renders with reason
 * codes, the per-verdict memo anchor state, and hash-chain status.
 *
 * Honesty rules mirror the API: pending anchor shows a "pending" banner
 * (never "valid"), unknown ids render a 404 view, malformed input gets a
 * friendly explanation.
 */
import { html, raw } from "hono/html";
import { Layout } from "./layout";
import { PageMeta } from "../server/lib/page-meta";
import { pageCoreSchemas, breadcrumbFor, webPageLd } from "../server/lib/json-ld";
import type { ResolveVia, VerifyLookup } from "../server/lib/verify/lookup";

export interface VerifyPageProps {
  query?: string;
  result?: VerifyLookup | null;
  via?: ResolveVia;
  error?: "malformed" | "not_found";
}

const mono = "font-mono text-xs break-all";

function statusBadge(status: string): string {
  const tone =
    status === "anchored"
      ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-300"
      // 180-6 C-1: server-reported is a server-side claim, not an
      // on-chain read — render informational cyan, never verified-green.
      : status === "server-reported"
        ? "border-cyan-500/40 bg-cyan-500/10 text-cyan-300"
        : status === "failed"
          ? "border-red-500/40 bg-red-500/10 text-red-300"
          : status === "pending"
            ? "border-amber-500/40 bg-amber-500/10 text-amber-300"
            : "border-slate-600 bg-slate-800 text-slate-300";
  return `<span class="inline-block rounded-full border px-3 py-1 text-xs font-semibold uppercase tracking-wider ${tone}">${status}</span>`;
}

function row(label: string, value: string, isMono = true): string {
  return `<div class="flex flex-col gap-1 sm:flex-row sm:items-start sm:gap-4">
    <span class="w-32 shrink-0 text-xs font-medium uppercase tracking-wider text-slate-500">${label}</span>
    <span class="${isMono ? mono : ""} text-slate-200">${value}</span>
  </div>`;
}

function formHtml(query = ""): string {
  return `<form method="post" action="/verify" class="mt-6 flex flex-col gap-3 sm:flex-row">
    <input type="text" name="q" value="${query.replace(/"/g, "&quot;")}"
      placeholder="0x… verdict ID / tx hash / memo id"
      class="flex-1 rounded-lg border border-slate-700 bg-slate-950 px-4 py-3 font-mono text-sm text-white placeholder-slate-600 focus:border-emerald-500 focus:outline-none" />
    <button type="submit"
      class="rounded-lg bg-emerald-600 px-6 py-3 text-sm font-semibold text-white transition hover:bg-emerald-500">Verify</button>
  </form>`;
}

function resultHtml(r: VerifyLookup, via?: ResolveVia): string {
  const v = r.verdict;
  const banner =
    r.anchor.status === "pending"
      ? `<div class="mt-6 rounded-lg border border-amber-500/40 bg-amber-500/10 p-4 text-sm text-amber-200">
          <strong>Anchor pending</strong> — the verdict is signed and stored, but its on-chain memo anchor has not landed yet. Re-check later; a pending anchor is not a failure.
        </div>`
      : r.anchor.status === "failed"
        ? `<div class="mt-6 rounded-lg border border-red-500/40 bg-red-500/10 p-4 text-sm text-red-200">
            <strong>Anchor failed</strong> — the on-chain memo anchor could not be confirmed. The signed artifact itself is still self-verifiable.
          </div>`
        : "";
  const viaNote =
    via && via !== "verdictId"
      ? `<p class="mt-2 text-xs text-slate-500">Resolved via ${via} → verdictId</p>`
      : "";

  const anchorRows = [
    row("status", statusBadge(r.anchor.status), false),
    ...(r.anchor.memoId ? [row("memoId", r.anchor.memoId)] : []),
    ...(r.anchor.txHash
      ? [
        row(
          "txHash",
          r.anchor.explorerUrl
            ? `<a href="${r.anchor.explorerUrl}" target="_blank" rel="noopener" class="text-emerald-400 underline hover:text-emerald-300">${r.anchor.txHash}</a>`
            : r.anchor.txHash,
        ),
      ]
      : []),
    ...(r.anchor.blockNumber ? [row("block", r.anchor.blockNumber)] : []),
  ].join("");

  const chainRows = r.chain.head_ref
    ? [
      row("status", statusBadge(r.chain.status), false),
      row("headHash", r.chain.head_ref.headHash),
      row("entries", String(r.chain.head_ref.count), false),
      ...(r.chain.head_ref.seq !== undefined
        ? [row("chain seq", String(r.chain.head_ref.seq), false)]
        : []),
      ...(r.chain.head_ref.proofUrl
        ? [
          row(
            "proof",
            `<a href="${r.chain.head_ref.proofUrl}" class="text-emerald-400 underline hover:text-emerald-300">${r.chain.head_ref.proofUrl}</a>`,
          ),
        ]
        : []),
    ].join("")
    : row("status", statusBadge(r.chain.status), false);

  return `
    ${banner}
    ${viaNote}
    <section class="mt-6 rounded-xl border border-slate-800 bg-slate-900 p-6">
      <h2 class="text-lg font-semibold text-white">Verdict</h2>
      <div class="mt-4 space-y-3">
        ${row("verdictId", r.verdictId)}
        ${row("kind", statusBadge(v.kind), false)}
        ${row("policy", v.policy)}
        ${row("reason", v.reason, false)}
        ${row("evaluator", v.evaluator)}
        ${row("issuedAt", v.issuedAt)}
      </div>
      <div class="mt-4 flex flex-wrap gap-2">
        ${r.reason_codes
        .map(
          (code) =>
            `<span class="rounded-full border border-slate-700 bg-slate-800 px-3 py-1 font-mono text-xs text-slate-300">${code}</span>`,
        )
        .join("")}
      </div>
    </section>

    <section class="mt-6 rounded-xl border border-slate-800 bg-slate-900 p-6">
      <h2 class="text-lg font-semibold text-white">On-chain anchor</h2>
      <div class="mt-4 space-y-3">${anchorRows}</div>
    </section>

    <section class="mt-6 rounded-xl border border-slate-800 bg-slate-900 p-6">
      <h2 class="text-lg font-semibold text-white">Hash-chain status</h2>
      <div class="mt-4 space-y-3">${chainRows}</div>
    </section>

    <p class="mt-6 text-xs text-slate-500">
      Machine-readable: <a href="/api/verify/${r.verdictId}" class="text-emerald-400 underline hover:text-emerald-300">GET /api/verify/${r.verdictId.slice(0, 18)}…</a>
      · verified_at ${r.verified_at}
    </p>`;
}

export function VerifyPage(props: VerifyPageProps) {
  const jsonLd = [
    ...pageCoreSchemas(),
    webPageLd({
      title: "Verify a Verdict",
      description:
        "Independently verify an AgentBadge verdict: EIP-712 signature, on-chain memo anchor, and hash-chain inclusion — verdictId, tx hash, or memo id.",
      path: "/verify",
    }),
    breadcrumbFor("/verify", "Verify"),
  ];

  const errorHtml =
    props.error === "malformed"
      ? `<div class="mt-6 rounded-lg border border-slate-700 bg-slate-900 p-4 text-sm text-slate-300">
          That doesn't look like a verdict ID, tx hash, or memo id — expected <span class="${mono}">0x</span> followed by 64 hex characters.
        </div>`
      : props.error === "not_found"
        ? `<div class="mt-6 rounded-lg border border-amber-500/40 bg-amber-500/10 p-4 text-sm text-amber-200">
            Verdict not found. Check the id — or it may have been issued on a different deployment.
          </div>`
        : "";

  const content = html`
    <section class="rounded-xl border border-slate-800 bg-gradient-to-br from-slate-900 to-slate-950 p-8">
      <span class="inline-block rounded-full border border-emerald-500/40 bg-emerald-500/10 px-3 py-1 text-xs font-medium text-emerald-300">Verify</span>
      <h1 class="mt-4 text-3xl font-semibold text-white">Verify a Verdict</h1>
      <p class="mt-3 max-w-2xl text-slate-300">
        Don't trust us — check it yourself. Paste a verdict ID, an anchor
        transaction hash, or a memo id: we return the signed artifact, its
        on-chain memo anchor, and its hash-chain status.
      </p>
      ${raw(formHtml(props.query ?? ""))}
    </section>
    ${raw(errorHtml)}
    ${props.result ? raw(resultHtml(props.result, props.via)) : ""}
  `;

  return Layout(
    content.toString(),
    "Verify a Verdict | AgentBadge",
    PageMeta["/verify"],
    jsonLd,
  );
}
