/**
 * GA4 Measurement Protocol — server-side analytics.
 *
 * Privacy-friendly: no client JS, no cookies, no CSP change.
 * Feature-gated by GA4_ENABLED + GA4_MEASUREMENT_ID + GA4_API_SECRET.
 * All errors are swallowed — analytics must never break the request.
 */

const GA4_ENDPOINT = "https://www.google-analytics.com/mp/collect";

function isConfigured(): boolean {
  const enabled = process.env.GA4_ENABLED === "true";
  const measurementId = process.env.GA4_MEASUREMENT_ID;
  const apiSecret = process.env.GA4_API_SECRET;
  return enabled && !!measurementId && !!apiSecret;
}

export function isGa4Enabled(): boolean {
  return isConfigured();
}

interface Ga4Event {
  name: string;
  params: Record<string, unknown>;
}

async function collect(events: Ga4Event[]): Promise<void> {
  if (!isConfigured()) return;

  const measurementId = process.env.GA4_MEASUREMENT_ID!;
  const apiSecret = process.env.GA4_API_SECRET!;

  try {
    const res = await fetch(
      `${GA4_ENDPOINT}?measurement_id=${measurementId}&api_secret=${apiSecret}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          client_id: "server-side",
          events,
        }),
      },
    );
    if (!res.ok) {
      console.warn(`[ga4] MP collect failed: ${res.status}`);
    }
  } catch (err) {
    console.warn(
      `[ga4] MP collect error: ${err instanceof Error ? err.message : err}`,
    );
  }
}

export async function trackPageView(
  path: string,
  title: string,
  referrer?: string,
): Promise<void> {
  const baseUrl = process.env.BASE_URL ?? "https://agentbadge.xyz";
  await collect([
    {
      name: "page_view",
      params: {
        page_title: title,
        page_location: `${baseUrl}${path}`,
        ...(referrer ? { page_referrer: referrer } : {}),
      },
    },
  ]);
}

export async function trackEvent(
  name: string,
  params: Record<string, unknown> = {},
): Promise<void> {
  await collect([{ name, params }]);
}
