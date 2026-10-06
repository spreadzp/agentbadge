/**
 * SLICE-181-4: honest-refusal contract section for llms.txt —
 * public declaration that refused requests are never billed, plus the
 * degraded/honest-zero conventions. Extracted to keep llms.ts <300 lines.
 */
export function honestRefusalSection(): string {
  return `
## Honest Refusal Contract

- Policy: \`no-charge-on-refusal\` — refused requests are never billed
  (\`charged:false\` in every refusal body).
- Refusal codes: \`policy_refusal\` (409), \`insufficient_subject\` (422),
  \`execution_failed\` (502, auto-refund when a self-settle payment already
  landed), \`data_unavailable\` (503 — upstream data source is down; never
  answered with stale data presented as fresh).
- Machine-readable contract: \`GET /api/meta/refusal-contract\` (JSON manifest,
  zod-schema \`version:"1.0"\`).
- Degraded data: paid surfaces may carry \`degraded:true\`,
  \`data_status:"fresh"|"stale"|"unavailable"\`, \`stale_since\` (ISO-8601).
  Empty collections return \`[]\` + \`note:"no_data"\` — never synthetic
  placeholders.
- Unilateral decisions (venue evaluator reject, moderation) carry a
  \`disclosure\` field: \`{decided_by, appeal, basis}\`.
- Price truth: \`402 accepts[].amount\` is canonical; verify against the
  declared SKU price (\`priceBaseUnits\`, USDC atomic) in the service catalog.
`;
}
