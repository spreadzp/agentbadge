/**
 * Env var validators + helpers (EPIC-140, SLICE-140-25).
 * Shared by all section loaders. Each `required*` pushes to `errors`
 * and returns undefined on failure so callers accumulate then throw.
 */

export const ACCOUNT_ID_RE = /^0\.0\.\d+$/;
export const URL_RE = /^https?:\/\/.+/;
export const ADDR_RE = /^0x[a-fA-F0-9]{40}$/;

export function isAccountId(value: string): boolean {
  return ACCOUNT_ID_RE.test(value);
}

export function isUrl(value: string): boolean {
  return URL_RE.test(value);
}

export function requiredString(
  name: string,
  errors: string[],
): string | undefined {
  const value = process.env[name];
  if (!value || !value.trim()) {
    errors.push(`Missing required env var: ${name}`);
    return undefined;
  }
  return value.trim();
}

export function requiredAccountId(
  name: string,
  errors: string[],
): string | undefined {
  const value = requiredString(name, errors);
  if (value && !isAccountId(value)) {
    errors.push(`Invalid ${name}: expected format 0.0.X, got "${value}"`);
    return undefined;
  }
  return value;
}

export function requiredUrl(
  name: string,
  errors: string[],
): string | undefined {
  const value = requiredString(name, errors);
  if (value && !isUrl(value)) {
    errors.push(`Invalid ${name}: expected a valid URL, got "${value}"`);
    return undefined;
  }
  return value;
}

export function requiredAddress(
  name: string,
  errors: string[],
): string | undefined {
  const value = requiredString(name, errors);
  if (value && !ADDR_RE.test(value)) {
    errors.push(
      `Invalid ${name}: expected 0x-prefixed 40-hex address, got "${value}"`,
    );
    return undefined;
  }
  return value;
}

export function booleanFlag(name: string): boolean {
  return process.env[name] === "true";
}

export function throwIfErrors(errors: string[]): void {
  if (errors.length > 0) {
    throw new Error(`Configuration errors:\n  - ${errors.join("\n  - ")}`);
  }
}
