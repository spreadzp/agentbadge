import type { ResponseSnapshot } from "../snapshot";

const LOCAL_BUSINESS_TYPES = [
  "LocalBusiness", "Store", "Restaurant", "CafeOrCoffeeShop",
  "Hotel", "Hospital", "Pharmacy", "GroceryStore", "Bakery",
  "BarOrPub", "BeautySalon", "DaySpa", "ExerciseGym", "HairSalon",
  "HealthClub", "NailSalon", "PetStore", "TattooParlor",
];

export interface LocalBusinessData {
  name?: string;
  address?: unknown;
  openingHours?: string | unknown;
  areaServed?: string | unknown;
  contactPoint?: unknown;
  telephone?: string;
  url?: string;
  priceRange?: string;
}

export interface OperationalDiscoveryResult {
  status: "found" | "not_found" | "no_data";
  business?: LocalBusinessData;
  businessType?: string;
  validation: {
    missingRequired: string[];
    missingRecommended: string[];
  };
}

export async function fetchOperationalDiscovery(
  _baseUrl: string,
  homepageSnapshot: ResponseSnapshot | null,
): Promise<OperationalDiscoveryResult> {
  if (!homepageSnapshot || !homepageSnapshot.body) {
    return { status: "no_data", validation: { missingRequired: [], missingRecommended: [] } };
  }

  const html = homepageSnapshot.body;
  const jsonldBlocks = extractJsonLdBlocks(html);

  let businessData: Record<string, unknown> | null = null;
  let businessType: string | undefined;

  for (const block of jsonldBlocks) {
    const type = block["@type"];
    if (typeof type === "string" && LOCAL_BUSINESS_TYPES.includes(type)) {
      businessData = block;
      businessType = type;
      break;
    }
  }

  if (!businessData) {
    return { status: "not_found", validation: { missingRequired: [], missingRecommended: [] } };
  }

  const business: LocalBusinessData = {
    name: businessData.name as string | undefined,
    address: businessData.address,
    openingHours: businessData.openingHours,
    areaServed: businessData.areaServed,
    contactPoint: businessData.contactPoint,
    telephone: businessData.telephone as string | undefined,
    url: businessData.url as string | undefined,
    priceRange: businessData.priceRange as string | undefined,
  };

  const missingRequired: string[] = [];
  const missingRecommended: string[] = [];

  if (!business.name) missingRequired.push("name");
  if (!business.address) missingRecommended.push("address");
  if (!business.openingHours) missingRecommended.push("openingHours");
  if (!business.areaServed) missingRecommended.push("areaServed");
  if (!business.contactPoint && !business.telephone) missingRecommended.push("contactPoint");

  return {
    status: "found",
    business,
    businessType,
    validation: { missingRequired, missingRecommended },
  };
}

function extractJsonLdBlocks(html: string): Record<string, unknown>[] {
  const blocks: Record<string, unknown>[] = [];
  const regex = /<script\s+type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/gi;
  let match;
  while ((match = regex.exec(html)) !== null) {
    try {
      const parsed = JSON.parse(match[1].trim());
      if (Array.isArray(parsed)) {
        for (const item of parsed) {
          if (typeof item === "object" && item !== null) {
            blocks.push(item as Record<string, unknown>);
          }
        }
      } else if (typeof parsed === "object" && parsed !== null) {
        blocks.push(parsed as Record<string, unknown>);
      }
    } catch {
      // Skip invalid JSON-LD
    }
  }
  return blocks;
}
