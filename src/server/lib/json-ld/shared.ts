import { getConfig } from "../../../config/env.js";
import { getChainTemplateVars } from "../chain-templates.js";

export const SCHEMA_CONTEXT = "https://schema.org";

export function chainCurrency(): string {
  return getConfig().ui.currencySymbol;
}

export function chainVars() {
  return getChainTemplateVars();
}

export function titleCaseSegment(segment: string): string {
  return segment
    .split("-")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}
