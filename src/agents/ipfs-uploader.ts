/**
 * SLICE-26-10: IPFS Upload Integration
 * Upload report bundles (HTML + JSON + metadata) to Pinata.
 * Reuses the Pinata pattern from packages/passport/src/ipfs/upload.ts.
 */

const PINATA_API = "https://api.pinata.cloud/pinning/pinJSONToIPFS";

export interface ReportMetadata {
  taskId: string;
  agentDid: string;
  agentTier: string;
  analysisType: string;
  datasetUrn: string;
  generatedAt: string;
}

export interface ReportBundleContent {
  html: string;
  json: string;
  metadata: ReportMetadata;
}

interface UploadOptions {
  maxRetries?: number;
}

/**
 * Build a JSON bundle string containing HTML, JSON report, and metadata.
 */
export function buildReportBundle(content: ReportBundleContent): string {
  return JSON.stringify(content);
}

/**
 * Upload arbitrary JSON content to Pinata and return `ipfs://{cid}`.
 * Retries on network errors with exponential backoff.
 */
export async function uploadToPinata(
  content: unknown,
  options?: UploadOptions,
): Promise<string> {
  const apiKey = process.env.IPFS_API_KEY;
  const apiSecret = process.env.IPFS_API_SECRET;

  if (!apiKey) {
    throw new Error("IPFS_API_KEY and IPFS_API_SECRET must be set in environment");
  }
  if (!apiSecret) {
    throw new Error("IPFS_API_KEY and IPFS_API_SECRET must be set in environment");
  }

  const maxRetries = options?.maxRetries ?? 3;
  let lastError: Error | null = null;

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      const res = await fetch(PINATA_API, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          pinata_api_key: apiKey,
          pinata_secret_api_key: apiSecret,
        },
        body: JSON.stringify({ pinataContent: content }),
      });

      if (!res.ok) {
        const text = await res.text();
        throw new Error(`Pinata upload error ${res.status}: ${text}`);
      }

      const data = (await res.json()) as { IpfsHash: string };
      return `ipfs://${data.IpfsHash}`;
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));

      // Only retry on network errors (TypeError from fetch), not on API errors
      if (lastError instanceof TypeError && attempt < maxRetries - 1) {
        const delay = Math.pow(2, attempt) * 1000; // 1s, 2s, 4s
        await new Promise((resolve) => setTimeout(resolve, delay));
        continue;
      }

      // Don't retry on non-network errors (e.g. API key issues, HTTP errors)
      if (!(lastError instanceof TypeError)) {
        throw lastError;
      }
    }
  }

  throw lastError ?? new Error("Upload failed after max retries");
}

/**
 * Upload a report bundle (HTML + JSON + metadata) to IPFS via Pinata.
 * Returns `ipfs://{cid}` URI.
 */
export async function uploadReportBundle(
  html: string,
  json: string,
  metadata: ReportMetadata,
): Promise<string> {
  const bundle = buildReportBundle({ html, json, metadata });
  const content = JSON.parse(bundle);
  return uploadToPinata(content);
}
