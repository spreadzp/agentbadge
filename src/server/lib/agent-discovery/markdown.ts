/**
 * SLICE-178-4 (MYPROJ-2517): shared HTML → markdown canonicalization.
 *
 * Single canonical function (D-178-3): title → H1, headings → # levels,
 * links/images → absolute URLs, block elements → paragraphs/lists.
 * Used by both `Accept: text/markdown` negotiation and `*.md` mirrors —
 * equivalence is by construction, not by test.
 *
 * Pure: string in → string out. No IO, no env.
 */

const VOID_NEWLINE_TAGS =
  "p|div|section|article|main|aside|header|footer|ul|ol|li|br|hr|table|thead|tbody|tr|td|th|blockquote|pre|figure|figcaption|dl|dt|dd|form|fieldset";

function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)));
}

const absUrl = (href: string, base: string): string => {
  if (!href || href.startsWith("#") || href.startsWith("mailto:")) return href;
  if (/^https?:\/\//.test(href)) return href;
  return `${base.replace(/\/$/, "")}${href.startsWith("/") ? href : `/${href}`}`;
};

function stripTags(s: string): string {
  return s.replace(/<[^>]*>/g, "");
}

/**
 * Convert a rendered HTML page to its canonical markdown representation.
 * `base` is the deployment base URL used to absolutize relative links.
 */
export function htmlToMarkdown(html: string, base: string): string {
  const out: string[] = [];

  const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  if (titleMatch?.[1]) {
    out.push(`# ${decodeEntities(stripTags(titleMatch[1])).trim()}`);
  }
  const descMatch = html.match(
    /<meta[^>]+name=["']description["'][^>]+content=["']([^"']*)["'][^>]*>/i,
  );
  if (descMatch?.[1]) {
    out.push(`> ${decodeEntities(descMatch[1]).trim()}`);
  }

  const bodyMatch = html.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
  let body = bodyMatch?.[1] ?? html;

  // Drop non-content blocks entirely.
  body = body
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, "")
    .replace(/<svg[\s\S]*?<\/svg>/gi, "")
    .replace(/<!--[\s\S]*?-->/g, "");

  // Headings → markdown levels.
  body = body.replace(
    /<h([1-6])[^>]*>([\s\S]*?)<\/h\1>/gi,
    (_, lvl, inner) =>
      `\n\n${"#".repeat(Number(lvl))} ${decodeEntities(stripTags(inner)).trim()}\n\n`,
  );

  // Links/images → absolute URLs.
  body = body.replace(
    /<img[^>]+src=["']([^"']*)["'][^>]*>/gi,
    (m, src) => {
      const alt = m.match(/alt=["']([^"']*)["']/i)?.[1] ?? "";
      return ` ![${decodeEntities(alt)}](${absUrl(src, base)}) `;
    },
  );
  body = body.replace(
    /<a[^>]+href=["']([^"']*)["'][^>]*>([\s\S]*?)<\/a>/gi,
    (_, href, inner) => {
      const text = decodeEntities(stripTags(inner)).trim();
      const url = absUrl(href, base);
      if (!text) return ` <${url}> `;
      if (href.startsWith("#") || href.startsWith("mailto:")) return ` ${text} `;
      return ` [${text}](${url}) `;
    },
  );

  // Lists and block boundaries → newlines.
  body = body.replace(/<li[^>]*>/gi, "\n- ");
  body = body.replace(
    new RegExp(`<\\/?(?:${VOID_NEWLINE_TAGS})[^>]*>`, "gi"),
    "\n",
  );
  body = body.replace(/<\/(h[1-6])>/gi, "\n");

  // Inline emphasis.
  body = body
    .replace(/<(strong|b)[^>]*>([\s\S]*?)<\/\1>/gi, "**$2**")
    .replace(/<(em|i)[^>]*>([\s\S]*?)<\/\1>/gi, "*$2*")
    .replace(/<code[^>]*>([\s\S]*?)<\/code>/gi, "`$1`");

  // Everything else is a tag → strip.
  body = stripTags(body);
  body = decodeEntities(body);

  // Normalize whitespace: trim lines, collapse 3+ blank lines.
  body = body
    .split("\n")
    .map((l) => l.replace(/[ \t]+/g, " ").trimEnd())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  out.push(body);
  return out.filter(Boolean).join("\n\n") + "\n";
}
