/**
 * SLICE-191-10 bonus: SQD data-availability — free, unmetered on-chain
 * data over 113+ networks via the buy gateway's /sqd/ prefix. No
 * payment, quote, or wallet signature; throttled by IP (120 req/min).
 * Used as the free reserve source when paid capabilities are denied.
 */

const SQD_BASE = "https://gateway.usebuy.ai/sqd";

type Fetcher = (url: string, init?: RequestInit) => Promise<Response>;

export function createSqd(fetcher: Fetcher = fetch) {
  /** All indexed datasets (network → dataset id). */
  async function datasets(): Promise<unknown> {
    const res = await fetcher(`${SQD_BASE}/datasets`);
    if (!res.ok) throw new Error(`sqd datasets ${res.status}`);
    return res.json();
  }

  /** Latest finalized block number for a dataset. */
  async function finalizedHead(dataset: string): Promise<number | undefined> {
    const res = await fetcher(
      `${SQD_BASE}/datasets/${dataset}/finalized-head`,
    );
    if (!res.ok) return undefined;
    const body = (await res.json()) as { number?: number } | number;
    return typeof body === "number" ? body : body.number;
  }

  /** Block number containing a timestamp (epoch seconds/ms per dataset). */
  async function blockAt(
    dataset: string,
    timestamp: number,
  ): Promise<unknown> {
    const res = await fetcher(
      `${SQD_BASE}/datasets/${dataset}/timestamps/${timestamp}/block`,
    );
    if (!res.ok) return undefined;
    return res.json();
  }

  /** Ad-hoc block/log stream query — NDJSON response. */
  async function stream(dataset: string, query: unknown): Promise<string> {
    const res = await fetcher(`${SQD_BASE}/datasets/${dataset}/stream`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(query),
    });
    if (!res.ok) throw new Error(`sqd stream ${res.status}`);
    return res.text();
  }

  return { datasets, finalizedHead, blockAt, stream };
}
