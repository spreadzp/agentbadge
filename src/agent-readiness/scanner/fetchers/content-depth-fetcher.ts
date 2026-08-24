export interface ContentDepthSnapshot {
  source: "content-depth";
  data: {
    wordCount: number;
    paragraphCount: number;
    headingCount: number;
    headingHierarchy: { level: number; text: string }[];
    hasTableOfContents: boolean;
    hasInternalLinks: number;
    hasExternalLinks: number;
  };
}

type FetchFn = typeof fetch;

function stripTags(html: string): string {
  return html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

export async function fetchContentDepth(
  pageUrl: string,
  fetchFn?: FetchFn,
): Promise<ContentDepthSnapshot> {
  const _fetch = fetchFn ?? fetch;

  let html = "";
  try {
    const resp = await _fetch(pageUrl);
    if (resp.ok) {
      html = await resp.text();
    }
  } catch {
    return emptySnapshot();
  }

  const text = stripTags(html);
  const wordCount = text ? text.split(/\s+/).length : 0;

  const pMatches = html.match(/<p[\s>]/gi) ?? [];
  const headingMatches = html.match(/<h([1-6])[^>]*>([\s\S]*?)<\/h\1>/gi) ?? [];

  const headingHierarchy = headingMatches.map((h) => {
    const levelMatch = h.match(/<h([1-6])/i);
    const textMatch = h.match(/>([\s\S]*?)</);
    const level = levelMatch ? parseInt(levelMatch[1], 10) : 0;
    const headingText = textMatch ? stripTags(textMatch[1]) : "";
    return { level, text: headingText };
  });

  const linkMatches = html.match(/<a[\s][^>]*href=["']([^"']+)["']/gi) ?? [];
  const pageOrigin = (() => {
    try {
      const u = new URL(pageUrl);
      return `${u.protocol}//${u.host}`;
    } catch {
      return "";
    }
  })();

  let hasInternalLinks = 0;
  let hasExternalLinks = 0;
  for (const linkTag of linkMatches) {
    const hrefMatch = linkTag.match(/href=["']([^"']+)["']/i);
    if (!hrefMatch) continue;
    const href = hrefMatch[1];
    if (href.startsWith("#") || href.startsWith("/") || href.startsWith(pageOrigin)) {
      hasInternalLinks++;
    } else if (href.startsWith("http://") || href.startsWith("https://")) {
      hasExternalLinks++;
    }
  }

  return {
    source: "content-depth",
    data: {
      wordCount,
      paragraphCount: pMatches.length,
      headingCount: headingMatches.length,
      headingHierarchy,
      hasTableOfContents: /class=["'][^"']*(?:toc|table-of-contents)[^"']*["']/i.test(html) || /id=["']toc["']/i.test(html),
      hasInternalLinks,
      hasExternalLinks,
    },
  };
}

function emptySnapshot(): ContentDepthSnapshot {
  return {
    source: "content-depth",
    data: {
      wordCount: 0,
      paragraphCount: 0,
      headingCount: 0,
      headingHierarchy: [],
      hasTableOfContents: false,
      hasInternalLinks: 0,
      hasExternalLinks: 0,
    },
  };
}
