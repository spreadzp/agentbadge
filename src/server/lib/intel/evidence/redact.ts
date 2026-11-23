// EPIC-262 (SLICE-262-1): subject normalization + secret redaction.
// Applied at the trust boundary before signing — the envelope must be safe
// to persist and relay. Conservative: object keys and URL params that LOOK
// secret-bearing get replaced; everything else passes through verbatim.
import type { Subject } from "./shapes";

const REDACTED = "[REDACTED]";
const SECRET_KEY_RE =
  /(secret|token|password|passwd|api[_-]?key|private[_-]?key|credential|authorization|auth[_-]?token)/i;
const SECRET_URL_PARAM_RE =
  /^(key|token|secret|password|passwd|api_?key|access_?token|signature|sig|credential|auth)$/i;

export function normalizeSubject(subject: Subject): Subject {
  if (subject.type !== "url") return subject;
  try {
    const url = new URL(subject.url);
    return { ...subject, url: url.toString() };
  } catch {
    return subject; // unparseable — keep verbatim, schema already enforced shape
  }
}

// Deep-redact: object keys matching the secret pattern are replaced whole;
// a name/value pair whose NAME looks secret-bearing gets its `value` masked
// (wp_option_read of `smtp_password` is the canonical case); strings that
// parse as URLs get sensitive query params masked.
const VALUE_KEY_RE = /^(value|secret|token|password|data)$/i;

export function redactSecrets<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.map((v) => redactSecrets(v)) as T;
  }
  if (value !== null && typeof value === "object") {
    const obj = value as Record<string, unknown>;
    const nameField = [obj.name, obj.key, obj.option, obj.setting].find(
      (v) => typeof v === "string",
    ) as string | undefined;
    const namedSecret = nameField !== undefined && SECRET_KEY_RE.test(nameField);
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(obj)) {
      if (SECRET_KEY_RE.test(k) || (namedSecret && VALUE_KEY_RE.test(k))) {
        out[k] = REDACTED;
      } else {
        out[k] = redactSecrets(v);
      }
    }
    return out as T;
  }
  if (typeof value === "string") {
    return redactUrlParams(value) as T;
  }
  return value;
}

function redactUrlParams(s: string): string {
  let url: URL;
  try {
    url = new URL(s);
  } catch {
    return s;
  }
  let changed = false;
  for (const key of [...url.searchParams.keys()]) {
    if (SECRET_URL_PARAM_RE.test(key)) {
      url.searchParams.set(key, REDACTED);
      changed = true;
    }
  }
  return changed ? url.toString() : s;
}
