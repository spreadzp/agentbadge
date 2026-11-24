// EPIC-262 (SLICE-262-16): capability registry v1 — TS mirror of the
// versioned contract `spec/pull-protocol/capability-registry.v1.json`.
// The JSON file is the SOURCE OF TRUTH (PHP consumes it verbatim);
// this module must not drift — tests/intel/pull-registry-drift.test.ts
// asserts byte-level parity of every field.

export const PULL_PROTOCOL_LIMITS = {
  paramsMaxBytes: 1024,
  resultMaxBytes: 8192,
  stringMaxChars: 256,
  resultsPerJob: 1,
  capabilityMaxExecMs: 5000,
  leaseSeconds: 900,
  jobTtlSeconds: 3600,
  maxReclaims: 2,
} as const;

export const CONST_WHITELIST = [
  "WP_DEBUG",
  "WP_DEBUG_LOG",
  "WP_DEBUG_DISPLAY",
  "DISALLOW_FILE_EDIT",
  "DISALLOW_FILE_MODS",
  "WP_ENVIRONMENT_TYPE",
  "AUTOMATIC_UPDATER_DISABLED",
] as const;

export interface OptionFieldSpec {
  type: "integer" | "string" | "enum" | "reduced";
  enum?: readonly number[];
  values?: readonly string[];
  max?: number;
  emit?: string;
}

export const OPTION_WHITELIST: Record<string, OptionFieldSpec> = {
  blog_public: { type: "integer", enum: [0, 1] },
  permalink_structure: { type: "string", max: 256 },
  siteurl: { type: "reduced", emit: "siteurl_https" },
  home: { type: "reduced", emit: "home_https" },
  users_can_register: { type: "integer", enum: [0, 1] },
  default_role: {
    type: "enum",
    values: ["subscriber", "contributor", "author", "editor", "administrator"],
  },
};

export const CAPABILITY_PROBE_IDS = [
  "const_read",
  "option_read",
  "phpinfo_summary",
] as const;
export type CapabilityProbeId = (typeof CAPABILITY_PROBE_IDS)[number];

export const PHPINFO_FIELDS = [
  "php_version",
  "memory_limit",
  "max_execution_time",
  "upload_max_filesize",
  "post_max_size",
  "display_errors",
  "expose_php",
  "allow_url_fopen",
] as const;

/** Params validation at create/submit boundary — exact shape per
 *  probe; anything else → reject (never a null-result, ADR §5). */
export function validateParams(
  probeId: string,
  params: unknown,
): { ok: true; params: Record<string, unknown> } | { ok: false } {
  if (typeof probeId !== "string" || params === null || typeof params !== "object") {
    return { ok: false };
  }
  const p = params as Record<string, unknown>;
  if (JSON.stringify(p).length > PULL_PROTOCOL_LIMITS.paramsMaxBytes) {
    return { ok: false };
  }
  switch (probeId) {
    case "const_read":
      return typeof p.name === "string" &&
        (CONST_WHITELIST as readonly string[]).includes(p.name)
        ? { ok: true, params: { name: p.name } }
        : { ok: false };
    case "option_read":
      return typeof p.name === "string" && p.name in OPTION_WHITELIST
        ? { ok: true, params: { name: p.name } }
        : { ok: false };
    case "phpinfo_summary":
      return Object.keys(p).length === 0 ? { ok: true, params: {} } : { ok: false };
    default:
      return { ok: false };
  }
}

/** Result-shape validation on submit — whitelist fields per probe,
 *  bounded strings; unknown fields → reject (no raw dumps). */
export function validateResultShape(
  probeId: string,
  result: unknown,
): { ok: true } | { ok: false } {
  if (result === null || typeof result !== "object") return { ok: false };
  const r = result as Record<string, unknown>;
  if (JSON.stringify(r).length > PULL_PROTOCOL_LIMITS.resultMaxBytes) {
    return { ok: false };
  }
  const strOk = (v: unknown) =>
    typeof v === "string" && v.length <= PULL_PROTOCOL_LIMITS.stringMaxChars;
  switch (probeId) {
    case "const_read":
      return (
        typeof r.name === "string" &&
        typeof r.defined === "boolean" &&
        (!("value" in r) || r.value === null || typeof r.value === "boolean" || strOk(r.value)) &&
        Object.keys(r).every((k) => ["name", "defined", "value"].includes(k))
      )
        ? { ok: true }
        : { ok: false };
    case "option_read": {
      const keys = ["name", "present", "value", "siteurl_https", "home_https"];
      return (
        typeof r.name === "string" &&
        typeof r.present === "boolean" &&
        (!("value" in r) || r.value === null || typeof r.value === "number" || strOk(r.value)) &&
        (!("siteurl_https" in r) || typeof r.siteurl_https === "boolean") &&
        (!("home_https" in r) || typeof r.home_https === "boolean") &&
        Object.keys(r).every((k) => keys.includes(k))
      )
        ? { ok: true }
        : { ok: false };
    }
    case "phpinfo_summary":
      return (
        Object.keys(r).length === PHPINFO_FIELDS.length &&
        (PHPINFO_FIELDS as readonly string[]).every((f) => strOk(r[f]))
      )
        ? { ok: true }
        : { ok: false };
    default:
      return { ok: false };
  }
}
