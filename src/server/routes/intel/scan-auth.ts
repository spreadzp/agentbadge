// EPIC-262 (SLICE-262-7): dual credential resolution for POST /scans.
// absk_ authenticates an installation (site); abop_ authenticates a
// human operator on a tenant — two DIFFERENT principals over the same
// paid operation. Each authenticator self-guards its own key prefix.
import {
  authenticateOperator,
  type OperatorRole,
} from "../../lib/intel/registry";
import type { IntelRouteDeps } from "./index";

export type ScanAuth =
  | { kind: "site_key"; siteId: string }
  | { kind: "operator"; tenantId: string; role: OperatorRole }
  | { kind: "invalid" };

export async function resolveScanAuth(
  deps: IntelRouteDeps,
  token: string | null,
): Promise<ScanAuth> {
  if (!token || !deps.registry) return { kind: "invalid" };
  const site = await deps.registry.authenticateSiteKey(token);
  if (site) return { kind: "site_key", siteId: site.site_id };
  const op = deps.registryStores
    ? await authenticateOperator(deps.registryStores, token)
    : null;
  if (op) {
    return { kind: "operator", tenantId: op.tenant_id, role: op.role };
  }
  return { kind: "invalid" };
}
