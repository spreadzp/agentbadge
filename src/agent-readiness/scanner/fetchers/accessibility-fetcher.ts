export interface AccessibilitySnapshot {
  source: "accessibility";
  data: {
    totalImages: number;
    imagesWithAlt: number;
    imagesWithoutAlt: number;
    imagesWithLazyLoading: number;
    hasAriaLabels: boolean;
    hasSkipLink: boolean;
  };
}

type FetchFn = typeof fetch;

export async function fetchAccessibility(
  pageUrl: string,
  fetchFn?: FetchFn,
): Promise<AccessibilitySnapshot> {
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

  const imgMatches = html.match(/<img[\s\S]*?>/gi) ?? [];
  const totalImages = imgMatches.length;

  let imagesWithAlt = 0;
  let imagesWithoutAlt = 0;
  let imagesWithLazyLoading = 0;

  for (const img of imgMatches) {
    if (/\salt=["'][^"']+["']/i.test(img)) {
      imagesWithAlt++;
    } else {
      imagesWithoutAlt++;
    }
    if (/\sloading=["']lazy["']/i.test(img)) {
      imagesWithLazyLoading++;
    }
  }

  return {
    source: "accessibility",
    data: {
      totalImages,
      imagesWithAlt,
      imagesWithoutAlt,
      imagesWithLazyLoading,
      hasAriaLabels: /aria-label=/i.test(html) || /aria-labelledby=/i.test(html),
      hasSkipLink: /class=["'][^"']*skip[^"']*["']/i.test(html) || /href=["'][^"']*#(?:content|main)[^"']*["']/i.test(html),
    },
  };
}

function emptySnapshot(): AccessibilitySnapshot {
  return {
    source: "accessibility",
    data: {
      totalImages: 0,
      imagesWithAlt: 0,
      imagesWithoutAlt: 0,
      imagesWithLazyLoading: 0,
      hasAriaLabels: false,
      hasSkipLink: false,
    },
  };
}
