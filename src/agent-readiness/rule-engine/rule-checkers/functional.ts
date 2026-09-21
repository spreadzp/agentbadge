import type { SourceState } from "../../scanner/source-state";
import type { Evidence } from "../evidence.types";
import { getSnapshots, httpEvidence } from "./helpers";

// ─── AB-119: OAuth token endpoint reachable ───────────────────────────────────
export function checkAb119(state: SourceState): Evidence[] {
  const snaps = getSnapshots(state);
  if (!snaps.auth_probe) return [];
  const probe = JSON.parse(snaps.auth_probe.body ?? "{}");
  if (probe.tokenObtained) {
    return [httpEvidence({ ...snaps.auth_probe, status: 200 })];
  }
  return [httpEvidence({ ...snaps.auth_probe, status: 0 })];
}

// ─── AB-120: Authenticated endpoint callable ──────────────────────────────────
export function checkAb120(state: SourceState): Evidence[] {
  const snaps = getSnapshots(state);
  if (!snaps.auth_probe) return [];
  const probe = JSON.parse(snaps.auth_probe.body ?? "{}");
  const endpointStatus = probe.endpointStatus ?? 0;
  return [httpEvidence({ ...snaps.auth_probe, status: endpointStatus })];
}

// ─── AB-121: Token response valid format ──────────────────────────────────────
export function checkAb121(state: SourceState): Evidence[] {
  const snaps = getSnapshots(state);
  if (!snaps.auth_probe) return [];
  const probe = JSON.parse(snaps.auth_probe.body ?? "{}");
  if (probe.tokenObtained) {
    return [httpEvidence({ ...snaps.auth_probe, status: 200 })];
  }
  return [httpEvidence({ ...snaps.auth_probe, status: 0 })];
}

// ─── AB-122: At least one endpoint callable ───────────────────────────────────
export function checkAb122(state: SourceState): Evidence[] {
  const snaps = getSnapshots(state);
  if (!snaps.endpoint_probe) return [];
  const probe = JSON.parse(snaps.endpoint_probe.body ?? "{}");
  const endpoints = probe.endpoints ?? [];
  const anyOk = endpoints.some((e: { responseStatus?: number }) => e.responseStatus === 200);
  return [httpEvidence({ ...snaps.endpoint_probe, status: anyOk ? 200 : 0 })];
}

// ─── AB-123: Response matches OpenAPI schema ──────────────────────────────────
export function checkAb123(state: SourceState): Evidence[] {
  const snaps = getSnapshots(state);
  if (!snaps.endpoint_probe) return [];
  const probe = JSON.parse(snaps.endpoint_probe.body ?? "{}");
  const endpoints = probe.endpoints ?? [];
  if (endpoints.length === 0) return [httpEvidence({ ...snaps.endpoint_probe, status: 0 })];
  const allMatch = endpoints.every((e: { matchesOpenApi?: boolean }) => e.matchesOpenApi === true);
  return [httpEvidence({ ...snaps.endpoint_probe, status: allMatch ? 200 : 0 })];
}

// ─── AB-124: Response content-type present ────────────────────────────────────
export function checkAb124(state: SourceState): Evidence[] {
  const snaps = getSnapshots(state);
  if (!snaps.endpoint_probe) return [];
  const probe = JSON.parse(snaps.endpoint_probe.body ?? "{}");
  const endpoints = probe.endpoints ?? [];
  const anyContentType = endpoints.some((e: { contentType?: string }) => e.contentType != null);
  return [httpEvidence({ ...snaps.endpoint_probe, status: anyContentType ? 200 : 0 })];
}

// ─── AB-125: LocalBusiness schema.org present ─────────────────────────────────
export function checkAb125(state: SourceState): Evidence[] {
  const snaps = getSnapshots(state);
  if (!snaps.operational_discovery) return [];
  const data = JSON.parse(snaps.operational_discovery.body ?? "{}");
  const found = data.status === "found";
  return [httpEvidence({ ...snaps.operational_discovery, status: found ? 200 : 0 })];
}

// ─── AB-126: Opening hours machine-readable ───────────────────────────────────
export function checkAb126(state: SourceState): Evidence[] {
  const snaps = getSnapshots(state);
  if (!snaps.operational_discovery) return [];
  const data = JSON.parse(snaps.operational_discovery.body ?? "{}");
  const hasHours = !!data.business?.openingHours;
  return [httpEvidence({ ...snaps.operational_discovery, status: hasHours ? 200 : 0 })];
}

// ─── AB-127: Area served defined ──────────────────────────────────────────────
export function checkAb127(state: SourceState): Evidence[] {
  const snaps = getSnapshots(state);
  if (!snaps.operational_discovery) return [];
  const data = JSON.parse(snaps.operational_discovery.body ?? "{}");
  const hasArea = !!data.business?.areaServed;
  return [httpEvidence({ ...snaps.operational_discovery, status: hasArea ? 200 : 0 })];
}
