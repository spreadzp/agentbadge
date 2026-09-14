/**
 * Google Search Console verification meta tag.
 * SLICE-130-14: Env-gated GSC HTML tag verification.
 */

export function getGscVerificationMeta(): string {
  const content = process.env.GOOGLE_SITE_VERIFICATION;
  if (!content) return "";
  if (!/^[A-Za-z0-9_-]+$/.test(content)) return "";
  return `<meta name="google-site-verification" content="${content}" />`;
}
