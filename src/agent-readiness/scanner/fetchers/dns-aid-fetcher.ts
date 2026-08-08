import { sha256 } from "./robots-fetcher";

export interface DnsAidFetchResult {
  domain: string;
  records: { name: string; type: string; data: string }[];
  found: boolean;
  fetchTime: number;
}

const DOH_RESOLVERS = [
  "https://dns.google/resolve",
  "https://cloudflare-dns.com/dns-query",
];

export async function fetchDnsAid(domain: string): Promise<DnsAidFetchResult> {
  const startTime = Date.now();
  const records: { name: string; type: string; data: string }[] = [];

  // Query TXT records for _agent.{domain} (DNS-AID draft)
  const queryName = `_agent.${domain}`;

  for (const resolver of DOH_RESOLVERS) {
    try {
      const url = `${resolver}?name=${encodeURIComponent(queryName)}&type=TXT`;
      const response = await fetch(url, {
        headers: { Accept: "application/dns-json" },
        signal: AbortSignal.timeout(5000),
      });
      if (!response.ok) continue;
      const data = await response.json() as {
        Status: number;
        Answer?: { name: string; type: number; data: string }[];
      };
      if (data.Answer) {
        for (const answer of data.Answer) {
          // type 16 = TXT
          if (answer.type === 16) {
            records.push({
              name: answer.name,
              type: "TXT",
              data: answer.data,
            });
          }
        }
      }
      break; // Success, no need to try next resolver
    } catch {
      // Try next resolver
    }
  }

  return {
    domain,
    records,
    found: records.length > 0,
    fetchTime: Date.now() - startTime,
  };
}
