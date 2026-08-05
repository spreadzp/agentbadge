import type { ResponseSnapshot } from "./snapshot";

export interface SourceState {
  domain: string;
  scannedAt: string;
  snapshots: Record<string, ResponseSnapshot | null>;
}

export function assembleSourceState(
  domain: string,
  snapshots: Record<string, ResponseSnapshot | null>,
): SourceState {
  return {
    domain,
    scannedAt: new Date().toISOString(),
    snapshots,
  };
}

export function serializeSourceState(state: SourceState): string {
  return JSON.stringify(state, null, 2);
}
