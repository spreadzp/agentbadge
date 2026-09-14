/**
 * Plausible server-side events API.
 * SLICE-130-12: Track custom events via Plausible Events API.
 */

const PLAUSIBLE_EVENTS_URL = "https://plausible.io/api/event";

export function isPlausibleEventsEnabled(): boolean {
  return process.env.PLAUSIBLE_ENABLED === "true" && !!process.env.PLAUSIBLE_DOMAIN;
}

export async function trackPlausibleEvent(
  name: string,
  props: Record<string, unknown> = {},
  path = "/",
): Promise<void> {
  if (!isPlausibleEventsEnabled()) return;
  const domain = process.env.PLAUSIBLE_DOMAIN!;
  try {
    const res = await fetch(PLAUSIBLE_EVENTS_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "User-Agent": "agentbadge-server/1.0",
      },
      body: JSON.stringify({
        name,
        domain,
        url: `https://${domain}${path}`,
        props,
      }),
    });
    if (!res.ok) console.warn(`[plausible] event failed: ${res.status}`);
  } catch {
    // swallow — analytics must never break the request
  }
}
