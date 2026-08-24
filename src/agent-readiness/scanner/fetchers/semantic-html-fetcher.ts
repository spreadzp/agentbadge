export interface SemanticHtmlSnapshot {
  source: "semantic-html";
  data: {
    hasDefinitionList: boolean;
    definitionListCount: number;
    hasArticleTag: boolean;
    hasTimeTag: boolean;
    hasNavTag: boolean;
    hasBreadcrumbs: boolean;
    hasFigureCaption: boolean;
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

function hasBreadcrumbJsonLd(blocks: unknown[]): boolean {
  return blocks.some((b) => {
    const obj = b as Record<string, unknown> | null;
    return obj != null && obj["@type"] === "BreadcrumbList";
  });
}

export async function fetchSemanticHtml(
  pageUrl: string,
  fetchFn?: FetchFn,
): Promise<SemanticHtmlSnapshot> {
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

  const dlMatches = html.match(/<dl[\s>]/gi) ?? [];
  const jsonLd = extractJsonLd(html);

  return {
    source: "semantic-html",
    data: {
      hasDefinitionList: dlMatches.length > 0,
      definitionListCount: dlMatches.length,
      hasArticleTag: /<article[\s>]/i.test(html),
      hasTimeTag: /<time[\s>]/i.test(html),
      hasNavTag: /<nav[\s>]/i.test(html),
      hasBreadcrumbs: hasBreadcrumbJsonLd(jsonLd) || /class=["'][^"']*breadcrumb[^"']*["']/i.test(html),
      hasFigureCaption: /<figure[\s>]/i.test(html) && /<figcaption[\s>]/i.test(html),
    },
  };
}

function emptySnapshot(): SemanticHtmlSnapshot {
  return {
    source: "semantic-html",
    data: {
      hasDefinitionList: false,
      definitionListCount: 0,
      hasArticleTag: false,
      hasTimeTag: false,
      hasNavTag: false,
      hasBreadcrumbs: false,
      hasFigureCaption: false,
    },
  };
}
