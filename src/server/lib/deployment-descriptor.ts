import { getConfig } from "../../config/env";

export interface DeploymentDescriptor {
  schema_version: string;
  deployment_id: string;
  network: string;
  passport_token_id: string;
  directory_topic_id: string;
  audit_topic_id: string;
  api_version: string;
  payment_protocol: string;
  facilitator: string;
  fee_catalog_url: string;
  error_catalog_url: string;
  trust_tiers_url: string;
  generated_at: string;
}

export function getDeploymentDescriptor(): DeploymentDescriptor {
  const config = getConfig();
  const baseUrl = process.env.BASE_URL ?? "https://agentbadge.xyz";

  return {
    schema_version: "1.0",
    deployment_id: baseUrl.replace(/^https?:\/\//, ""),
    network: `hedera:${config.hederaNetwork}`,
    passport_token_id: config.passportTokenId,
    directory_topic_id: config.directoryTopicId,
    audit_topic_id: config.auditTopicId,
    api_version: process.env.npm_package_version ?? "0.13.0",
    payment_protocol: "x402",
    facilitator: config.x402FacilitatorUrl,
    fee_catalog_url: `${baseUrl}/api/meta/fees`,
    error_catalog_url: `${baseUrl}/api/meta/errors`,
    trust_tiers_url: `${baseUrl}/api/meta/trust-tiers`,
    generated_at: new Date().toISOString(),
  };
}
