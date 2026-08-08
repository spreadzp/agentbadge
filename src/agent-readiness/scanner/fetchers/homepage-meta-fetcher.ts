export interface HomepageMetaResult {
  source: "homepage-meta";
  data: {
    jsonLd: unknown[];
    ogImage: string | null;
    ogImageReachable: boolean;
    twitterCard: string | null;
    faviconSvg: boolean;
    faviconPng: boolean;
    canonical: string | null;
    llmsTxtLinked: boolean;
  };
}

type FetchFn = typeof fetch;

function extractMeta(html: string, property: string): string | null {
  const re = new RegExp(`<meta[^>]+(?:property|name)=["']${property}["'][^>]*content=["']([^"']+)["']`, "i");
  const m = html.match(re);
  if (m) return m[1];
  const re2 = new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]*(?:property|name)=["']${property}["']`, "i");
  const m2 = html.match(re2);
  return m2 ? m2[1] : null;
}

function extractLink(html: string, rel: string, typeAttr?: string): string | null {
  const escType = typeAttr ? typeAttr.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") : null;
  // Match <link ... rel="icon" ... type="image/svg+xml" ... href="/icon.svg">
  const re = new RegExp(
    `<link[^>]+rel=["']${rel}["'][^>]*${escType ? `type=["']${escType}["'][^>]*` : ""}href=["']([^"']+)["']`,
    "i",
  );
  const m = html.match(re);
  if (m) return m[1];
  // Match <link ... type="image/svg+xml" ... rel="icon" ... href="/icon.svg">
  const re2 = new RegExp(
    `<link[^>]+${escType ? `type=["']${escType}["'][^>]*` : ""}rel=["']${rel}["'][^>]*href=["']([^"']+)["']`,
    "i",
  );
  const m2 = html.match(re2);
  return m2 ? m2[1] : null;
}

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

export async function fetchHomepageMeta(
  baseUrl: string,
  fetchFn?: FetchFn,
): Promise<HomepageMetaResult> {
  const _fetch = fetchFn ?? fetch;
  const url = `${baseUrl}/`;

  let html = "";
  try {
    const resp = await _fetch(url);
    if (resp.ok) {
      html = await resp.text();
    }
  } catch {
    return {
      source: "homepage-meta",
      data: {
        jsonLd: [],
        ogImage: null,
        ogImageReachable: false,
        twitterCard: null,
        faviconSvg: false,
        faviconPng: false,
        canonical: null,
        llmsTxtLinked: false,
      },
    };
  }

  const jsonLd = extractJsonLd(html);
  const ogImage = extractMeta(html, "og:image");
  const twitterCard = extractMeta(html, "twitter:card");
  const faviconSvgHref = extractLink(html, "icon", "image/svg+xml");
  const faviconPngHref = extractLink(html, "icon", "image/png");
  const canonical = extractLink(html, "canonical");
  const llmsTxtHref = extractLink(html, "alternate", "text/plain");

  // Check og:image reachability
  let ogImageReachable = false;
  if (ogImage) {
    try {
      const ogResp = await _fetch(ogImage);
      ogImageReachable = ogResp.ok;
    } catch {
      // not reachable
    }
  }

  return {
    source: "homepage-meta",
    data: {
      jsonLd,
      ogImage,
      ogImageReachable,
      twitterCard,
      faviconSvg: faviconSvgHref !== null,
      faviconPng: faviconPngHref !== null,
      canonical,
      llmsTxtLinked: llmsTxtHref !== null,
    },
  };
}
