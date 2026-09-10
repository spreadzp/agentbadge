/**
 * SLICE-101-2: Domain parser — extracts hostname from URL.
 * Handles https://, http://, trailing paths, ports.
 */

/**
 * Extract the hostname from a URL string.
 * @example parseDomain("https://api.example.com/v1/tasks") → "api.example.com"
 * @example parseDomain("http://localhost:3000") → "localhost"
 */
export function parseDomain(url: string): string {
  try {
    const u = new URL(url);
    return u.hostname;
  } catch {
    // Fallback: strip protocol and path
    const withoutProtocol = url.replace(/^https?:\/\//, "");
    const withoutPath = withoutProtocol.split("/")[0];
    const withoutPort = withoutPath.split(":")[0];
    return withoutPort;
  }
}
