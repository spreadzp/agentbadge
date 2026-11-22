import { queryDohTxt } from "./doh-txt";

export interface DnsAidFetchResult {
  domain: string;
  records: { name: string; type: string; data: string }[];
  found: boolean;
  fetchTime: number;
}

export async function fetchDnsAid(domain: string): Promise<DnsAidFetchResult> {
  const startTime = Date.now();

  // Query TXT records for _agent.{domain} (DNS-AID draft) —
  // sequential resolver fallback via the shared DoH helper.
  const r = await queryDohTxt(`_agent.${domain}`);

  return {
    domain,
    records: r.answers.map((a) => ({ name: a.name, type: "TXT", data: a.data })),
    found: r.status === "ok",
    fetchTime: Date.now() - startTime,
  };
}
