/**
 * GA4 gtag.js client-side script snippet.
 *
 * Returns the official Google Analytics gtag.js script tags when enabled,
 * empty string otherwise. Mirrors the plausible.ts pattern.
 * Injection into layouts happens in SLICE-130-10.
 */

const GA4_ID_RE = /^G-[A-Z0-9]+$/;

export function getGA4Script(): string {
  const enabled = process.env.GA4_ENABLED === "true";
  const id = process.env.GA4_MEASUREMENT_ID;
  if (!enabled || !id || !GA4_ID_RE.test(id)) return "";
  return `<script async src="https://www.googletagmanager.com/gtag/js?id=${id}"></script><script>window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments);}gtag('js',new Date());gtag('config','${id}');</script>`;
}
