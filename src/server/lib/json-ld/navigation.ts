import { BASE_URL } from "../page-meta";
import { SCHEMA_CONTEXT, titleCaseSegment } from "./shared";

// ─── HowTo + BreadcrumbList Schemas (SLICE-21-1) ─────────────

export function howToLd(opts: {
  name: string;
  description: string;
  path: string;
  steps: { name: string; text: string; url?: string }[];
  totalTime?: string;
  estimatedCost?: { currency: string; value: string };
}): object {
  const schema: Record<string, unknown> = {
    "@context": SCHEMA_CONTEXT,
    "@type": "HowTo",
    name: opts.name,
    description: opts.description,
    url: `${BASE_URL}${opts.path}`,
    inLanguage: "en",
    step: opts.steps.map((s, i) => ({
      "@type": "HowToStep",
      position: i + 1,
      name: s.name,
      text: s.text,
      ...(s.url ? { url: s.url.startsWith("http") ? s.url : `${BASE_URL}${s.url}` } : {}),
    })),
  };
  if (opts.totalTime) schema.totalTime = opts.totalTime;
  if (opts.estimatedCost) {
    schema.estimatedCost = {
      "@type": "MonetaryAmount",
      currency: opts.estimatedCost.currency,
      value: opts.estimatedCost.value,
    };
  }
  return schema;
}

export function breadcrumbListLd(
  items: { name: string; path: string }[],
): object {
  return {
    "@context": SCHEMA_CONTEXT,
    "@type": "BreadcrumbList",
    itemListElement: items.map((it, i) => ({
      "@type": "ListItem",
      position: i + 1,
      name: it.name,
      item: it.path.startsWith("http") ? it.path : `${BASE_URL}${it.path}`,
    })),
  };
}

// ─── Breadcrumb Auto-Generator (SLICE-112-1) ─────────────────

export function breadcrumbFor(path: string, label?: string): object {
  const segments = path.split("/").filter(Boolean);
  const items: { name: string; path: string }[] = [
    { name: "Home", path: "/" },
  ];

  let currentPath = "";
  for (let i = 0; i < segments.length; i++) {
    currentPath += `/${segments[i]}`;
    const isLast = i === segments.length - 1;
    const name = isLast && label ? label : titleCaseSegment(segments[i]);
    items.push({ name, path: currentPath });
  }

  return breadcrumbListLd(items);
}
