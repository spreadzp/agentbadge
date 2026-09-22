import { SITE_NAME, BASE_URL } from "../page-meta";
import type { CachedMarketTask } from "@agentbadge/hedera-core";
import type { DirectoryEntry } from "@agentbadge/passport";
import { SCHEMA_CONTEXT, chainCurrency } from "./shared";

// ─── Entity Schemas (SLICE-18-5) ──────────────────────────────

export function passportLd(p: {
  tokenId: string;
  serial: number;
  tier: string;
  ownerDID?: string;
}): object {
  const schema: Record<string, unknown> = {
    "@context": SCHEMA_CONTEXT,
    "@type": "DigitalDocument",
    identifier: `did:hcs:${p.tokenId}:${p.serial}`,
    additionalType: "VerifiableCredential",
    isPartOf: {
      "@type": "SoftwareApplication",
      name: SITE_NAME,
      url: BASE_URL,
    },
    about: {
      "@type": "Thing",
      name: "AI Agent Passport",
    },
    encodingFormat: "application/json",
    url: `${BASE_URL}/ui/agents/${p.tokenId}/${p.serial}`,
  };
  if (p.ownerDID) {
    schema.creator = { "@type": "Organization", identifier: p.ownerDID };
  }
  if (p.tier) {
    schema.keywords = p.tier;
  }
  return schema;
}

export function jobPostingLd(t: CachedMarketTask): object {
  const schema: Record<string, unknown> = {
    "@context": SCHEMA_CONTEXT,
    "@type": "JobPosting",
    title: t.title,
    description: t.description,
    datePosted: new Date(t.createdAt).toISOString(),
    employmentType: "CONTRACT",
    hiringOrganization: {
      "@type": "Organization",
      identifier: t.posterDid,
    },
    baseSalary: {
      "@type": "MonetaryAmount",
      currency: chainCurrency(),
      value: t.priceHbar,
    },
    url: `${BASE_URL}/ui/market/tasks/${t.taskId}`,
  };
  if (t.deadline) {
    schema.validThrough = new Date(t.deadline).toISOString();
  }
  if (t.capabilities.length > 0) {
    schema.skills = t.capabilities.join(", ");
  }
  return schema;
}

export function profilePageLd(a: DirectoryEntry): object {
  const schema: Record<string, unknown> = {
    "@context": SCHEMA_CONTEXT,
    "@type": "ProfilePage",
    url: `${BASE_URL}/ui/agents/${a.tokenId}/${a.serial}`,
    mainEntity: {
      "@type": "Thing",
      name: a.name,
      identifier: a.did,
    },
  };
  if (a.endpoint) {
    (schema.mainEntity as Record<string, unknown>).sameAs = a.endpoint;
  }
  if (a.capabilities.length > 0) {
    (schema.mainEntity as Record<string, unknown>).knowsAbout = a.capabilities;
  }
  if (a.tier) {
    (schema.mainEntity as Record<string, unknown>).additionalType = a.tier;
  }
  return schema;
}
