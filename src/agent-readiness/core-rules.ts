export const CORE_RULE_IDS: readonly string[] = [
  "AB-001", // Robots.txt File
  "AB-002", // Sitemap File
  "AB-003", // Agent Guide
  "AB-004", // API Specification
  "AB-014", // LLMs.txt File
  "AB-016", // JSON Format Support
  "AB-008", // Authentication Declared
  "AB-012", // Structured Error Responses
  "AB-011", // Rate Limits Declared
  "AB-010", // Machine-Readable Pricing
  "AB-015", // Agent User-Agent Format
  "AB-024", // Detailed LLMs File
  "AB-049", // RSS or Atom Feed
  "AB-054", // Canonical URL
  "AB-061", // Link Relationships
  "AB-066", // Content Signals
  "AB-068", // DNS Agent Discovery
  "AB-007", // Guide and API Consistency
  "AB-013", // Owner Verification
  "AB-052", // Social Preview Image
];

export function isCoreRule(ruleId: string): boolean {
  return CORE_RULE_IDS.includes(ruleId);
}
