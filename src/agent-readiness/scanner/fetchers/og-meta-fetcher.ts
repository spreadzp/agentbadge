export interface OgMetaSnapshot {
  source: "og-meta";
  data: {
    ogType: string | null;
    ogImageAlt: string | null;
    articleAuthor: string | null;
    articlePublishedTime: string | null;
    articleModifiedTime: string | null;
    ogTitle: string | null;
    ogDescription: string | null;
    ogImage: string | null;
    ogUrl: string | null;
    ogSiteName: string | null;
  };
}

type FetchFn = typeof fetch;

function extractMeta(html: string, property: string): string | null {
  const re = new RegExp(
    `<meta[^>]+(?:property|name)=["']${property}["'][^>]*content=["']([^"']+)["']`,
    "i",
  );
  const m = html.match(re);
  if (m) return m[1];
  const re2 = new RegExp(
    `<meta[^>]+content=["']([^"']+)["'][^>]*(?:property|name)=["']${property}["']`,
    "i",
  );
  const m2 = html.match(re2);
  return m2 ? m2[1] : null;
}

export async function fetchOgMeta(
  pageUrl: string,
  fetchFn?: FetchFn,
): Promise<OgMetaSnapshot> {
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

  return {
    source: "og-meta",
    data: {
      ogType: extractMeta(html, "og:type"),
      ogImageAlt: extractMeta(html, "og:image:alt"),
      articleAuthor: extractMeta(html, "article:author"),
      articlePublishedTime: extractMeta(html, "article:published_time"),
      articleModifiedTime: extractMeta(html, "article:modified_time"),
      ogTitle: extractMeta(html, "og:title"),
      ogDescription: extractMeta(html, "og:description"),
      ogImage: extractMeta(html, "og:image"),
      ogUrl: extractMeta(html, "og:url"),
      ogSiteName: extractMeta(html, "og:site_name"),
    },
  };
}

function emptySnapshot(): OgMetaSnapshot {
  return {
    source: "og-meta",
    data: {
      ogType: null,
      ogImageAlt: null,
      articleAuthor: null,
      articlePublishedTime: null,
      articleModifiedTime: null,
      ogTitle: null,
      ogDescription: null,
      ogImage: null,
      ogUrl: null,
      ogSiteName: null,
    },
  };
}
