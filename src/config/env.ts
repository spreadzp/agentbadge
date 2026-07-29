/**
 * Environment configuration — loads and validates all required env vars.
 *
 * Reference: hackathon-flow.md §10 (canonical var names)
 * Reference: deployment-strategy.md §Phase 2
 */

export interface AppConfig {
  hederaOperatorId: string;
  hederaOperatorKey: string;
  hederaNetwork: string;
  passportTokenId: string;
  auditTopicId: string;
  directoryTopicId: string;
  x402FacilitatorUrl: string;
  x402FeePayer: string;
  x402Treasury: string;
  ipfsApiKey: string;
  ipfsApiSecret: string;
  port: number;
  mockHedera: boolean;
  mockX402: boolean;
  mockIpfs: boolean;
}

const ACCOUNT_ID_RE = /^0\.0\.\d+$/;
const URL_RE = /^https?:\/\/.+/;

function isAccountId(value: string): boolean {
  return ACCOUNT_ID_RE.test(value);
}

function isUrl(value: string): boolean {
  return URL_RE.test(value);
}

function requiredString(name: string, errors: string[]): string | undefined {
  const value = process.env[name];
  if (!value || !value.trim()) {
    errors.push(`Missing required env var: ${name}`);
    return undefined;
  }
  return value.trim();
}

function requiredAccountId(name: string, errors: string[]): string | undefined {
  const value = requiredString(name, errors);
  if (value && !isAccountId(value)) {
    errors.push(`Invalid ${name}: expected format 0.0.X, got "${value}"`);
    return undefined;
  }
  return value;
}

function requiredUrl(name: string, errors: string[]): string | undefined {
  const value = requiredString(name, errors);
  if (value && !isUrl(value)) {
    errors.push(`Invalid ${name}: expected a valid URL, got "${value}"`);
    return undefined;
  }
  return value;
}

function booleanFlag(name: string): boolean {
  return process.env[name] === "true";
}

export function loadConfig(): AppConfig {
  const errors: string[] = [];

  const hederaOperatorId = requiredAccountId("HEDERA_OPERATOR_ID", errors);
  const hederaOperatorKey = requiredString("HEDERA_OPERATOR_KEY", errors);
  const hederaNetwork = process.env.HEDERA_NETWORK ?? "testnet";
  const passportTokenId = requiredAccountId("PASSPORT_TOKEN_ID", errors);
  const auditTopicId = requiredAccountId("AUDIT_TOPIC_ID", errors);
  const directoryTopicId = requiredAccountId("DIRECTORY_TOPIC_ID", errors);
  const x402FacilitatorUrl = requiredUrl("x402_FACILITATOR_URL", errors);
  const x402FeePayer = requiredAccountId("x402_FEE_PAYER", errors);
  const x402Treasury = requiredAccountId("x402_TREASURY", errors);
  const ipfsApiKey = requiredString("IPFS_API_KEY", errors);
  const ipfsApiSecret = requiredString("IPFS_API_SECRET", errors);
  const port = Number(process.env.PORT ?? 4021);

  if (errors.length > 0) {
    throw new Error(`Configuration errors:\n  - ${errors.join("\n  - ")}`);
  }

  return {
    hederaOperatorId: hederaOperatorId!,
    hederaOperatorKey: hederaOperatorKey!,
    hederaNetwork,
    passportTokenId: passportTokenId!,
    auditTopicId: auditTopicId!,
    directoryTopicId: directoryTopicId!,
    x402FacilitatorUrl: x402FacilitatorUrl!,
    x402FeePayer: x402FeePayer!,
    x402Treasury: x402Treasury!,
    ipfsApiKey: ipfsApiKey!,
    ipfsApiSecret: ipfsApiSecret!,
    port,
    mockHedera: booleanFlag("MOCK_HEDERA"),
    mockX402: booleanFlag("MOCK_X402"),
    mockIpfs: booleanFlag("MOCK_IPFS"),
  };
}
