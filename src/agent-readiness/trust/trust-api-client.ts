/**
 * SLICE-102-8: API client for trust endpoints.
 *
 * Wraps fetch calls to the AgentBadge trust API.
 */

import type { TrustSnapshot } from "./trust-schema";

export interface AttestInput {
  accountId: string;
  signature: string;
  tier: string;
}

export interface ChallengeResponse {
  token: string;
  dns_record: string;
  well_known_url: string;
  expires_at: string;
}

export interface DomainOwnershipProof {
  method: string;
  verified: boolean;
  verified_at: string | null;
  challenge_token: string;
  proof: string;
}

function getDefaultApiUrl(): string {
  return process.env.AGENTBADGE_API_URL ?? "https://agentbadge.xyz";
}

function normalizeDomain(domain: string): string {
  return domain.toLowerCase().replace(/^https?:\/\//, "").replace(/\/.*$/, "").trim();
}

export async function fetchTrustSnapshot(domain: string, apiUrl?: string): Promise<TrustSnapshot> {
  const base = apiUrl ?? getDefaultApiUrl();
  const normalized = normalizeDomain(domain);
  const res = await fetch(`${base}/api/trust/${normalized}`);

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(`Failed to fetch trust snapshot: ${res.status} ${body.error ?? res.statusText}`);
  }

  return res.json();
}

export async function fetchTrustSnapshotMarkdown(domain: string, apiUrl?: string): Promise<string> {
  const base = apiUrl ?? getDefaultApiUrl();
  const normalized = normalizeDomain(domain);
  const res = await fetch(`${base}/api/trust/${normalized}?format=markdown`);

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(`Failed to fetch trust snapshot markdown: ${res.status} ${body.error ?? res.statusText}`);
  }

  return res.text();
}

export async function attestTrustSnapshot(
  domain: string,
  input: AttestInput,
  apiUrl?: string,
): Promise<TrustSnapshot> {
  const base = apiUrl ?? getDefaultApiUrl();
  const normalized = normalizeDomain(domain);
  const res = await fetch(`${base}/api/trust/${normalized}/attest`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(`Attestation failed: ${res.status} ${body.error ?? res.statusText}`);
  }

  return res.json();
}

export async function generateChallenge(domain: string, apiUrl?: string): Promise<ChallengeResponse> {
  const base = apiUrl ?? getDefaultApiUrl();
  const normalized = normalizeDomain(domain);
  const res = await fetch(`${base}/api/trust/${normalized}/challenge`);

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(`Failed to generate challenge: ${res.status} ${body.error ?? res.statusText}`);
  }

  return res.json();
}

export async function verifyOwnership(
  domain: string,
  token: string,
  apiUrl?: string,
): Promise<DomainOwnershipProof> {
  const base = apiUrl ?? getDefaultApiUrl();
  const normalized = normalizeDomain(domain);
  const res = await fetch(`${base}/api/trust/${normalized}/verify-ownership`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token }),
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(`Ownership verification failed: ${res.status} ${body.error ?? res.statusText}`);
  }

  return res.json();
}
