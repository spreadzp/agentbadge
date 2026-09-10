/**
 * SLICE-102-3: Challenge store — in-memory store for domain ownership challenges.
 */

import { generateChallenge, type Challenge } from "./challenge";

const store = new Map<string, Challenge>();

/**
 * Create and store a challenge for a domain.
 * Overwrites any existing challenge for the same domain.
 */
export function createChallenge(domain: string, createdAt?: string): Challenge {
  const challenge = generateChallenge(domain, createdAt);
  store.set(domain, challenge);
  return challenge;
}

/**
 * Get the stored challenge for a domain.
 * Returns null if no challenge exists.
 */
export function getChallenge(domain: string): Challenge | null {
  return store.get(domain) ?? null;
}

/**
 * Delete the challenge for a domain (after successful verification).
 */
export function deleteChallenge(domain: string): void {
  store.delete(domain);
}

/**
 * Clear all challenges (for testing).
 */
export function clearChallenges(): void {
  store.clear();
}
