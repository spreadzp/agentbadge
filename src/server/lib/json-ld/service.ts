import { SITE_NAME, BASE_URL } from "../page-meta";
import { SCHEMA_CONTEXT } from "./shared";

// ─── Agency Service + Person Schemas (SLICE-51-9) ────────────

export function serviceLd(opts: {
  name: string;
  description: string;
  path: string;
  provider?: string;
  serviceType?: string;
}): object {
  return {
    "@context": SCHEMA_CONTEXT,
    "@type": "Service",
    name: opts.name,
    serviceType: opts.serviceType ?? opts.description,
    description: opts.description,
    url: `${BASE_URL}${opts.path}`,
    provider: {
      "@type": "Organization",
      name: opts.provider ?? SITE_NAME,
      url: BASE_URL,
    },
    areaServed: "Worldwide",
    audience: {
      "@type": "Audience",
      audienceType: "Developers and AI agents",
    },
  };
}

export function personLd(opts: {
  name: string;
  role: string;
  description?: string;
  url?: string;
  linkedin?: string;
}): object {
  const sameAs: string[] = [];
  if (opts.linkedin) sameAs.push(opts.linkedin);
  if (opts.url) sameAs.push(opts.url);

  return {
    "@context": SCHEMA_CONTEXT,
    "@type": "Person",
    name: opts.name,
    jobTitle: opts.role,
    ...(opts.description ? { description: opts.description } : {}),
    ...(opts.url ? { url: opts.url } : {}),
    ...(sameAs.length > 0 ? { sameAs } : {}),
    worksFor: {
      "@type": "Organization",
      name: SITE_NAME,
      url: BASE_URL,
    },
  };
}
