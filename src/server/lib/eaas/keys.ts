/** Evaluator/settler key — ARC_EVALUATOR_KEY, demo fallback DEPLOYER_PRIVATE_KEY. */
export function evaluatorKey(): `0x${string}` | null {
  for (const env of ["ARC_EVALUATOR_KEY", "DEPLOYER_PRIVATE_KEY"]) {
    const k = process.env[env];
    if (k && /^0x[0-9a-fA-F]{64}$/.test(k)) return k as `0x${string}`;
  }
  return null;
}
