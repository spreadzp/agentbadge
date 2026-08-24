export interface AeoContentSnapshot {
  source: "aeo-content";
  data: {
    hasShortAnswer: boolean;
    hasFaqSchema: boolean;
    hasHowToSchema: boolean;
    hasDefinitionList: boolean;
    hasSummaryBlock: boolean;
    wordCount: number;
    headingHierarchy: string[];
  };
}

type FetchFn = typeof fetch;

function extractJsonLd(html: string): unknown[] {
  const blocks: unknown[] = [];
  const re = /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    try {
      blocks.push(JSON.parse(m[1].trim()));
    } catch {
      // skip invalid JSON-LD
    }
  }
  return blocks;
}

function hasJsonLdType(blocks: unknown[], type: string): boolean {
  return blocks.some((b) => {
    if (Array.isArray(b)) {
      return b.some((item: Record<string, unknown>) => item && item["@type"] === type);
    }
    const obj = b as Record<string, unknown> | null;
    return obj != null && obj["@type"] === type;
  });
}

function stripTags(html: string): string {
  return html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

export async function fetchAeoContent(
  pageUrl: string,
  fetchFn?: FetchFn,
): Promise<AeoContentSnapshot> {
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

  const jsonLd = extractJsonLd(html);
  const text = stripTags(html);
  const wordCount = text ? text.split(/\s+/).length : 0;

  const headingMatches = html.match(/<h[1-6][^>]*>([\s\S]*?)<\/h[1-6]>/gi) ?? [];
  const headingHierarchy = headingMatches.map((h) => {
    const levelMatch = h.match(/<h([1-6])/i);
    const textMatch = h.match(/>([\s\S]*?)</);
    const level = levelMatch ? levelMatch[1] : "?";
    const text = textMatch ? stripTags(textMatch[1]) : "";
    return `h${level}: ${text}`;
  });

  return {
    source: "aeo-content",
    data: {
      hasShortAnswer: /class=["'][^"']*short-answer[^"']*["']/i.test(html) || /<summary[^>]*>/i.test(html),
      hasFaqSchema: hasJsonLdType(jsonLd, "FAQPage"),
      hasHowToSchema: hasJsonLdType(jsonLd, "HowTo"),
      hasDefinitionList: /<dl[\s>]/i.test(html),
      hasSummaryBlock: /<summary[\s>]/i.test(html) || /tl;dr/i.test(text),
      wordCount,
      headingHierarchy,
    },
  };
}

function emptySnapshot(): AeoContentSnapshot {
  return {
    source: "aeo-content",
    data: {
      hasShortAnswer: false,
      hasFaqSchema: false,
      hasHowToSchema: false,
      hasDefinitionList: false,
      hasSummaryBlock: false,
      wordCount: 0,
      headingHierarchy: [],
    },
  };
}
