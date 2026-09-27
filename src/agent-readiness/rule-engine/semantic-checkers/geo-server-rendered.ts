// EPIC-146 (SLICE-146-7): GEO citability checkers — ported from
// packages/agent-readiness-scanner/src/rule-engine/semantic-checkers.ts.
// Keep in sync with the core package implementation.
import type { SemanticChecker } from "./helpers";
import {
  countWords,
  htmlToText,
  MOUNT_SHELL_RE,
  SCRIPT_SRC_RE,
  SSR_MIN_WORDS,
  SSR_THIN_WORDS,
} from "./geo-citability-helpers";

// ─── AB-186 (EPIC-146): Server-rendered primary content ──────────────────
// AI crawlers (GPTBot, PerplexityBot, ClaudeBot) largely do not execute JS —
// a CSR-only page is invisible to them. Signals: visible word count in the
// raw HTML, empty SPA mount point + script bundles, <noscript> fallback as
// mitigation. Skip (not_applicable): non-HTML bodies, redirects, auth gates.
export const checkerServerRendered: SemanticChecker = (sources) => {
  const snap = sources.html;
  if (!snap?.body) {
    return { outcome: "no_source", detail: "Homepage HTML snapshot not found" };
  }
  const html = snap.body;

  // Non-HTML payloads — nothing to render
  if (/^\s*[{[]|^\s*<\?xml/.test(html)) {
    return {
      outcome: "not_applicable",
      detail: "Response body is not HTML (JSON/XML payload) — rule does not apply",
    };
  }

  const text = htmlToText(html);
  const words = countWords(text);

  // Redirect shell / auth gate — skip rather than penalize
  if (words < SSR_THIN_WORDS && /http-equiv=["']refresh/i.test(html)) {
    return {
      outcome: "not_applicable",
      detail: "Meta-refresh redirect page — no primary content expected",
    };
  }
  if (words < SSR_MIN_WORDS && /<input[^>]+type=["']password/i.test(html)) {
    return {
      outcome: "not_applicable",
      detail: "Auth-gated page (password form) — primary content is behind login",
    };
  }

  const shellMount = MOUNT_SHELL_RE.test(html);
  const scriptBundles = html.match(SCRIPT_SRC_RE)?.length ?? 0;
  const hasNoscript = /<noscript[\s>]/i.test(html);
  const isShell = shellMount && scriptBundles >= 1;

  // Content is actually present in raw HTML — shell markers don't matter
  if (words >= SSR_MIN_WORDS) {
    return {
      outcome: "found",
      detail: `${words} words server-rendered in initial HTML`,
    };
  }

  // No JS machinery at all and nearly no text → stub/placeholder page
  if (words < SSR_THIN_WORDS && scriptBundles === 0 && !shellMount) {
    return {
      outcome: "not_applicable",
      detail: `Only ${words} words and no client-side rendering machinery — nothing to evaluate`,
    };
  }

  if (isShell) {
    return hasNoscript
      ? {
          outcome: "partial",
          detail: `CSR shell (${words} words, empty mount point, ${scriptBundles} script bundles) — <noscript> fallback present but crawlers still see no content`,
        }
      : {
          outcome: "absent",
          detail: `CSR shell: empty mount point + ${scriptBundles} script bundle(s), only ${words} words in initial HTML — invisible to AI crawlers`,
        };
  }

  return hasNoscript
    ? {
        outcome: "partial",
        detail: `${words} words (<${SSR_MIN_WORDS}) in initial HTML; <noscript> fallback present`,
      }
    : {
        outcome: "partial",
        detail: `${words} words (<${SSR_MIN_WORDS}) in initial HTML — primary content may render client-side`,
      };
};
