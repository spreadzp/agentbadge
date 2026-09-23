/**
 * Barrel re-export — implementation moved to services/audit-store.ts
 * (SLICE-145-4, D9). This path is kept so existing imports and vi.mock
 * specifiers ("../lib/keeperhub-audit-store") keep working.
 */

export { auditStore, AuditStore } from "../services/audit-store";
export type { AuditEvent } from "../services/audit-store";
