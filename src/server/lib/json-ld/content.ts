import { SITE_NAME, BASE_URL } from "../page-meta";
import { BUILD_DATE } from "../build-info";
import { SCHEMA_CONTEXT } from "./shared";

// ─── Content Page Schemas (SLICE-18-7) ────────────────────────

export function faqPageLd(qaPairs: { question: string; answer: string }[]): object {
  return {
    "@context": SCHEMA_CONTEXT,
    "@type": "FAQPage",
    datePublished: BUILD_DATE,
    dateModified: BUILD_DATE,
    mainEntity: qaPairs.map((qa) => ({
      "@type": "Question",
      name: qa.question,
      acceptedAnswer: {
        "@type": "Answer",
        text: qa.answer,
      },
    })),
  };
}

export function articleLd(a: {
  title: string;
  description: string;
  path: string;
  sections?: { title: string; body: string }[];
  datePublished?: string;
  dateModified?: string;
}): object {
  const schema: Record<string, unknown> = {
    "@context": SCHEMA_CONTEXT,
    "@type": "Article",
    headline: a.title,
    description: a.description,
    url: `${BASE_URL}${a.path}`,
    datePublished: a.datePublished ?? BUILD_DATE,
    dateModified: a.dateModified ?? BUILD_DATE,
    author: {
      "@type": "Organization",
      name: SITE_NAME,
      url: BASE_URL,
    },
    publisher: {
      "@type": "Organization",
      name: SITE_NAME,
      url: BASE_URL,
      logo: {
        "@type": "ImageObject",
        url: `${BASE_URL}/icons/logo-32.png`,
      },
    },
  };
  if (a.sections && a.sections.length > 0) {
    schema.articleBody = a.sections.map((s) => `${s.title}. ${s.body}`).join("\n\n");
  }
  return schema;
}

// ─── Content Page Helpers (SLICE-21-3) ───────────────────────

export function webPageLd(opts: {
  title: string;
  description: string;
  path: string;
  datePublished?: string;
  dateModified?: string;
}): object {
  return {
    "@context": SCHEMA_CONTEXT,
    "@type": "WebPage",
    name: opts.title,
    description: opts.description,
    url: `${BASE_URL}${opts.path}`,
    inLanguage: "en",
    isPartOf: { "@type": "WebSite", name: SITE_NAME, url: BASE_URL },
    datePublished: opts.datePublished ?? BUILD_DATE,
    dateModified: opts.dateModified ?? BUILD_DATE,
  };
}

export function aboutPageLd(opts: {
  title: string;
  description: string;
  path: string;
}): object {
  return {
    "@context": SCHEMA_CONTEXT,
    "@type": "AboutPage",
    name: opts.title,
    description: opts.description,
    url: `${BASE_URL}${opts.path}`,
    inLanguage: "en",
    mainEntity: {
      "@type": "Organization",
      name: SITE_NAME,
      url: BASE_URL,
    },
  };
}

export function collectionPageLd(opts: {
  name: string;
  description: string;
  path: string;
}): object {
  return {
    "@context": SCHEMA_CONTEXT,
    "@type": "CollectionPage",
    name: opts.name,
    description: opts.description,
    url: `${BASE_URL}${opts.path}`,
    inLanguage: "en",
    isPartOf: { "@type": "WebSite", name: SITE_NAME, url: BASE_URL },
  };
}

export function ruleItemListLd(opts: {
  name: string;
  path: string;
  items: { name: string; url: string; description: string }[];
}): object {
  return {
    "@context": SCHEMA_CONTEXT,
    "@type": "ItemList",
    name: opts.name,
    numberOfItems: opts.items.length,
    url: `${BASE_URL}${opts.path}`,
    itemListElement: opts.items.map((item, i) => ({
      "@type": "ListItem",
      position: i + 1,
      name: item.name,
      url: item.url,
      description: item.description,
    })),
  };
}
