// EPIC-140 (SLICE-140-20): service-page helpers (abbr expander, cross-links, CTA href/label).

export const expandAbbr = (text: string) =>
  text
    .replace(/HCS directory/g, '<abbr title="Hedera Consensus Service">HCS</abbr> directory')
    .replace(/HCS/g, '<abbr title="Hedera Consensus Service">HCS</abbr>')
    .replace(/\bDID\b/g, '<abbr title="Decentralized Identifier">DID</abbr>')
    .replace(/\bHTS\b/g, '<abbr title="Hedera Token Service">HTS</abbr>')
    .replace(/\bAEO\b/g, '<abbr title="Answer Engine Optimization">AEO</abbr>')
    .replace(/\bGEO\b/g, '<abbr title="Generative Engine Optimization">GEO</abbr>');

export function getServiceCrossLinks(serviceId: string) {
  const serviceLinks: Record<string, { label: string; href: string; description?: string }[]> = {
    scanner: [
      { label: "Passports", href: "/services/passports", description: "On-chain agent identity" },
      { label: "Marketplace", href: "/services/marketplace", description: "Task marketplace for agents" },
      { label: "FAQ", href: "/faq", description: "Common questions about our services" },
      { label: "Pricing", href: "/pricing", description: "Passport tiers and service costs" },
    ],
    passports: [
      { label: "Scanner", href: "/services/scanner", description: "Agent readiness scanning" },
      { label: "Marketplace", href: "/services/marketplace", description: "Task marketplace for agents" },
      { label: "FAQ", href: "/faq", description: "Common questions about our services" },
      { label: "Pricing", href: "/pricing", description: "Passport tiers and service costs" },
    ],
    marketplace: [
      { label: "Scanner", href: "/services/scanner", description: "Agent readiness scanning" },
      { label: "Passports", href: "/services/passports", description: "On-chain agent identity" },
      { label: "FAQ", href: "/faq", description: "Common questions about our services" },
      { label: "Pricing", href: "/pricing", description: "Passport tiers and service costs" },
    ],
  };
  return serviceLinks[serviceId] ?? [
    { label: "Scanner", href: "/services/scanner", description: "Agent readiness scanning" },
    { label: "FAQ", href: "/faq", description: "Common questions" },
    { label: "Pricing", href: "/pricing", description: "Service costs" },
  ];
}

export function getCtaHref(id: string): string {
  switch (id) {
    case "scanner":
      return "/dashboard";
    case "passports":
      return "/passport";
    case "marketplace":
      return "/ui/market/tasks";
    default:
      return "/";
  }
}

export function getCtaLabel(id: string): string {
  switch (id) {
    case "scanner":
      return "Run a scan";
    case "passports":
      return "Get a passport";
    case "marketplace":
      return "Browse tasks";
    default:
      return "Get started";
  }
}
