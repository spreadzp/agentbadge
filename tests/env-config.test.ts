import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { loadConfig, resetConfigCache } from "../src/config/env";

describe("loadConfig", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env = { ...originalEnv };
    delete process.env.MOCK_HEDERA;
    delete process.env.MOCK_X402;
    delete process.env.MOCK_IPFS;
    delete process.env.CHAIN_MODE;
    resetConfigCache();
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it("produces a correctly-typed AppConfig when all required vars are present", () => {
    process.env.HEDERA_OPERATOR_ID = "0.0.5266613";
    process.env.HEDERA_OPERATOR_KEY = "302e020100300506032b657004220420abcdef";
    process.env.HEDERA_NETWORK = "testnet";
    process.env.PASSPORT_TOKEN_ID = "0.0.1234567";
    process.env.AUDIT_TOPIC_ID = "0.0.7654321";
    process.env.DIRECTORY_TOPIC_ID = "0.0.8765432";
    process.env.x402_FACILITATOR_URL = "https://api.testnet.blocky402.com";
    process.env.x402_FEE_PAYER = "0.0.7162784";
    process.env.x402_TREASURY = "0.0.8011510";
    process.env.IPFS_API_KEY = "test-key";
    process.env.IPFS_API_SECRET = "test-secret";
    process.env.PORT = "4021";

    const config = loadConfig();

    expect(config.hederaOperatorId).toBe("0.0.5266613");
    expect(config.hederaOperatorKey).toBe("302e020100300506032b657004220420abcdef");
    expect(config.hederaNetwork).toBe("testnet");
    expect(config.passportTokenId).toBe("0.0.1234567");
    expect(config.auditTopicId).toBe("0.0.7654321");
    expect(config.directoryTopicId).toBe("0.0.8765432");
    expect(config.x402FacilitatorUrl).toBe("https://api.testnet.blocky402.com");
    expect(config.x402FeePayer).toBe("0.0.7162784");
    expect(config.x402Treasury).toBe("0.0.8011510");
    expect(config.ipfsApiKey).toBe("test-key");
    expect(config.ipfsApiSecret).toBe("test-secret");
    expect(config.port).toBe(4021);
    expect(config.mockHedera).toBe(false);
    expect(config.mockX402).toBe(false);
    expect(config.mockIpfs).toBe(false);
    expect(config.chainMode).toBe("hedera");
    expect(config.evm).toBeUndefined();
  });

  it("throws a single aggregated error listing ALL missing vars when several are absent", () => {
    delete process.env.HEDERA_OPERATOR_ID;
    delete process.env.HEDERA_OPERATOR_KEY;
    delete process.env.PASSPORT_TOKEN_ID;
    delete process.env.AUDIT_TOPIC_ID;
    expect(() => loadConfig()).toThrow(/PASSPORT_TOKEN_ID/);
    expect(() => loadConfig()).toThrow(/AUDIT_TOPIC_ID/);
  });

  it("rejects a malformed HEDERA_OPERATOR_ID (not matching 0.0.X)", () => {
    process.env.HEDERA_OPERATOR_ID = "invalid-id";
    process.env.HEDERA_OPERATOR_KEY = "302e020100300506032b657004220420abcdef";
    process.env.HEDERA_NETWORK = "testnet";
    process.env.PASSPORT_TOKEN_ID = "0.0.1234567";
    process.env.AUDIT_TOPIC_ID = "0.0.7654321";
    process.env.DIRECTORY_TOPIC_ID = "0.0.8765432";
    process.env.x402_FACILITATOR_URL = "https://api.testnet.blocky402.com";
    process.env.x402_FEE_PAYER = "0.0.7162784";
    process.env.x402_TREASURY = "0.0.8011510";
    process.env.IPFS_API_KEY = "test-key";
    process.env.IPFS_API_SECRET = "test-secret";

    expect(() => loadConfig()).toThrow(/HEDERA_OPERATOR_ID/);
  });

  it("accepts mock mode flags and sets them to true", () => {
    process.env.HEDERA_OPERATOR_ID = "0.0.5266613";
    process.env.HEDERA_OPERATOR_KEY = "302e020100300506032b657004220420abcdef";
    process.env.HEDERA_NETWORK = "testnet";
    process.env.PASSPORT_TOKEN_ID = "0.0.1234567";
    process.env.AUDIT_TOPIC_ID = "0.0.7654321";
    process.env.DIRECTORY_TOPIC_ID = "0.0.8765432";
    process.env.x402_FACILITATOR_URL = "https://api.testnet.blocky402.com";
    process.env.x402_FEE_PAYER = "0.0.7162784";
    process.env.x402_TREASURY = "0.0.8011510";
    process.env.IPFS_API_KEY = "test-key";
    process.env.IPFS_API_SECRET = "test-secret";
    process.env.MOCK_HEDERA = "true";
    process.env.MOCK_X402 = "true";
    process.env.MOCK_IPFS = "true";

    const config = loadConfig();

    expect(config.mockHedera).toBe(true);
    expect(config.mockX402).toBe(true);
    expect(config.mockIpfs).toBe(true);
  });

  it("rejects an invalid x402_FACILITATOR_URL (not a URL)", () => {
    process.env.HEDERA_OPERATOR_ID = "0.0.5266613";
    process.env.HEDERA_OPERATOR_KEY = "302e020100300506032b657004220420abcdef";
    process.env.HEDERA_NETWORK = "testnet";
    process.env.PASSPORT_TOKEN_ID = "0.0.1234567";
    process.env.AUDIT_TOPIC_ID = "0.0.7654321";
    process.env.DIRECTORY_TOPIC_ID = "0.0.8765432";
    process.env.x402_FACILITATOR_URL = "not-a-url";
    process.env.x402_FEE_PAYER = "0.0.7162784";
    process.env.x402_TREASURY = "0.0.8011510";
    process.env.IPFS_API_KEY = "test-key";
    process.env.IPFS_API_SECRET = "test-secret";

    expect(() => loadConfig()).toThrow(/x402_FACILITATOR_URL/);
  });

  it("uses default PORT=4021 when not specified", () => {
    process.env.HEDERA_OPERATOR_ID = "0.0.5266613";
    process.env.HEDERA_OPERATOR_KEY = "302e020100300506032b657004220420abcdef";
    process.env.HEDERA_NETWORK = "testnet";
    process.env.PASSPORT_TOKEN_ID = "0.0.1234567";
    process.env.AUDIT_TOPIC_ID = "0.0.7654321";
    process.env.DIRECTORY_TOPIC_ID = "0.0.8765432";
    process.env.x402_FACILITATOR_URL = "https://api.testnet.blocky402.com";
    process.env.x402_FEE_PAYER = "0.0.7162784";
    process.env.x402_TREASURY = "0.0.8011510";
    process.env.IPFS_API_KEY = "test-key";
    process.env.IPFS_API_SECRET = "test-secret";
    delete process.env.PORT;

    const config = loadConfig();

    expect(config.port).toBe(4021);
  });

  it("loads EVM config when CHAIN_MODE=evm with all required vars", () => {
    process.env.CHAIN_MODE = "evm";
    process.env.EVM_RPC_URL = "https://rpc.testnet.whitechain.io";
    process.env.EVM_CHAIN_ID = "1874";
    process.env.EVM_OPERATOR_KEY = "0xabcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789";
    process.env.EVM_PASSPORT_NFT_ADDRESS = "0x1234567890123456789012345678901234567890";
    process.env.EVM_EVENT_LOG_ADDRESS = "0x2345678901234567890123456789012345678901";
    process.env.EVM_ESCROW_ADDRESS = "0x3456789012345678901234567890123456789012";
    process.env.EVM_USDC_ADDRESS = "0x4567890123456789012345678901234567890123";
    process.env.EVM_EXPLORER_URL = "https://explorer.testnet.whitechain.io";

    const config = loadConfig();

    expect(config.chainMode).toBe("evm");
    expect(config.evm).toBeDefined();
    expect(config.evm!.rpcUrl).toBe("https://rpc.testnet.whitechain.io");
    expect(config.evm!.chainId).toBe(1874);
    expect(config.evm!.passportNft).toBe("0x1234567890123456789012345678901234567890");
    expect(config.evm!.eventLog).toBe("0x2345678901234567890123456789012345678901");
    expect(config.evm!.escrow).toBe("0x3456789012345678901234567890123456789012");
    expect(config.evm!.usdcAddress).toBe("0x4567890123456789012345678901234567890123");
    expect(config.evm!.explorerUrl).toBe("https://explorer.testnet.whitechain.io");
  });

  it("throws when CHAIN_MODE=evm but EVM vars are missing", () => {
    process.env.CHAIN_MODE = "evm";
    delete process.env.EVM_RPC_URL;
    delete process.env.EVM_OPERATOR_KEY;
    delete process.env.EVM_PASSPORT_NFT_ADDRESS;

    expect(() => loadConfig()).toThrow(/EVM_RPC_URL/);
    expect(() => loadConfig()).toThrow(/EVM_OPERATOR_KEY/);
    expect(() => loadConfig()).toThrow(/EVM_PASSPORT_NFT_ADDRESS/);
  });

  it("rejects invalid EVM address format in evm mode", () => {
    process.env.CHAIN_MODE = "evm";
    process.env.EVM_RPC_URL = "https://rpc.testnet.whitechain.io";
    process.env.EVM_CHAIN_ID = "1874";
    process.env.EVM_OPERATOR_KEY = "0xabcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789";
    process.env.EVM_PASSPORT_NFT_ADDRESS = "not-an-address";
    process.env.EVM_EVENT_LOG_ADDRESS = "0x2345678901234567890123456789012345678901";
    process.env.EVM_ESCROW_ADDRESS = "0x3456789012345678901234567890123456789012";
    process.env.EVM_USDC_ADDRESS = "0x4567890123456789012345678901234567890123";
    process.env.EVM_EXPLORER_URL = "https://explorer.testnet.whitechain.io";

    expect(() => loadConfig()).toThrow(/EVM_PASSPORT_NFT_ADDRESS/);
  });

  it("does not require Hedera vars in evm mode", () => {
    process.env.CHAIN_MODE = "evm";
    process.env.EVM_RPC_URL = "https://rpc.testnet.whitechain.io";
    process.env.EVM_CHAIN_ID = "1874";
    process.env.EVM_OPERATOR_KEY = "0xabcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789";
    process.env.EVM_PASSPORT_NFT_ADDRESS = "0x1234567890123456789012345678901234567890";
    process.env.EVM_EVENT_LOG_ADDRESS = "0x2345678901234567890123456789012345678901";
    process.env.EVM_ESCROW_ADDRESS = "0x3456789012345678901234567890123456789012";
    process.env.EVM_USDC_ADDRESS = "0x4567890123456789012345678901234567890123";
    process.env.EVM_EXPLORER_URL = "https://explorer.testnet.whitechain.io";
    delete process.env.HEDERA_OPERATOR_ID;
    delete process.env.HEDERA_OPERATOR_KEY;
    delete process.env.PASSPORT_TOKEN_ID;

    const config = loadConfig();
    expect(config.chainMode).toBe("evm");
    expect(config.hederaOperatorId).toBe("");
  });

  // ── SLICE-90-4: Base Sepolia config ─────────────────────────────────

  it("loads Base config when CHAIN_MODE=base with all required vars", () => {
    process.env.CHAIN_MODE = "base";
    process.env.BASE_RPC_URL = "https://sepolia.base.org";
    process.env.BASE_CHAIN_ID = "84532";
    process.env.BASE_OPERATOR_KEY = "0xabcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789";
    process.env.BASE_PASSPORT_NFT = "0x68ca4d1a9ff24f86328f2fb3a30d81e503d367f5";
    process.env.BASE_TASK_ESCROW = "0x10812a4fc9ac31281e4a3e6e1d60bb571c2a4ca4";
    process.env.BASE_USDC_ADDRESS = "0x036CbD53842c5426634e7929541eC2318f3dCF7e";

    const config = loadConfig();

    expect(config.chainMode).toBe("base");
    expect(config.base).toBeDefined();
    expect(config.base!.rpcUrl).toBe("https://sepolia.base.org");
    expect(config.base!.chainId).toBe(84532);
    expect(config.base!.operatorKey).toBe("0xabcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789");
    expect(config.base!.passportNft).toBe("0x68ca4d1a9ff24f86328f2fb3a30d81e503d367f5");
    expect(config.base!.taskEscrow).toBe("0x10812a4fc9ac31281e4a3e6e1d60bb571c2a4ca4");
    expect(config.base!.usdcAddress).toBe("0x036CbD53842c5426634e7929541eC2318f3dCF7e");
    expect(config.base!.explorerUrl).toBe("https://sepolia.basescan.org");
  });

  it("throws when CHAIN_MODE=base but BASE_RPC_URL is missing", () => {
    process.env.CHAIN_MODE = "base";
    delete process.env.BASE_RPC_URL;
    process.env.BASE_OPERATOR_KEY = "0xabcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789";
    process.env.BASE_PASSPORT_NFT = "0x68ca4d1a9ff24f86328f2fb3a30d81e503d367f5";
    process.env.BASE_TASK_ESCROW = "0x10812a4fc9ac31281e4a3e6e1d60bb571c2a4ca4";
    process.env.BASE_USDC_ADDRESS = "0x036CbD53842c5426634e7929541eC2318f3dCF7e";

    expect(() => loadConfig()).toThrow(/BASE_RPC_URL/);
  });

  it("throws when CHAIN_MODE=base but BASE_OPERATOR_KEY is missing", () => {
    process.env.CHAIN_MODE = "base";
    process.env.BASE_RPC_URL = "https://sepolia.base.org";
    delete process.env.BASE_OPERATOR_KEY;
    process.env.BASE_PASSPORT_NFT = "0x68ca4d1a9ff24f86328f2fb3a30d81e503d367f5";
    process.env.BASE_TASK_ESCROW = "0x10812a4fc9ac31281e4a3e6e1d60bb571c2a4ca4";
    process.env.BASE_USDC_ADDRESS = "0x036CbD53842c5426634e7929541eC2318f3dCF7e";

    expect(() => loadConfig()).toThrow(/BASE_OPERATOR_KEY/);
  });

  it("does not require Hedera vars in base mode", () => {
    process.env.CHAIN_MODE = "base";
    process.env.BASE_RPC_URL = "https://sepolia.base.org";
    process.env.BASE_CHAIN_ID = "84532";
    process.env.BASE_OPERATOR_KEY = "0xabcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789";
    process.env.BASE_PASSPORT_NFT = "0x68ca4d1a9ff24f86328f2fb3a30d81e503d367f5";
    process.env.BASE_TASK_ESCROW = "0x10812a4fc9ac31281e4a3e6e1d60bb571c2a4ca4";
    process.env.BASE_USDC_ADDRESS = "0x036CbD53842c5426634e7929541eC2318f3dCF7e";
    delete process.env.HEDERA_OPERATOR_ID;
    delete process.env.HEDERA_OPERATOR_KEY;
    delete process.env.PASSPORT_TOKEN_ID;

    const config = loadConfig();
    expect(config.chainMode).toBe("base");
    expect(config.hederaOperatorId).toBe("");
  });

  it("uses default BASE_CHAIN_ID=84532 when not specified", () => {
    process.env.CHAIN_MODE = "base";
    process.env.BASE_RPC_URL = "https://sepolia.base.org";
    delete process.env.BASE_CHAIN_ID;
    process.env.BASE_OPERATOR_KEY = "0xabcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789";
    process.env.BASE_PASSPORT_NFT = "0x68ca4d1a9ff24f86328f2fb3a30d81e503d367f5";
    process.env.BASE_TASK_ESCROW = "0x10812a4fc9ac31281e4a3e6e1d60bb571c2a4ca4";
    process.env.BASE_USDC_ADDRESS = "0x036CbD53842c5426634e7929541eC2318f3dCF7e";

    const config = loadConfig();
    expect(config.base!.chainId).toBe(84532);
  });

  it("uses default BASE_EXPLORER_URL when not specified", () => {
    process.env.CHAIN_MODE = "base";
    process.env.BASE_RPC_URL = "https://sepolia.base.org";
    process.env.BASE_OPERATOR_KEY = "0xabcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789";
    process.env.BASE_PASSPORT_NFT = "0x68ca4d1a9ff24f86328f2fb3a30d81e503d367f5";
    process.env.BASE_TASK_ESCROW = "0x10812a4fc9ac31281e4a3e6e1d60bb571c2a4ca4";
    process.env.BASE_USDC_ADDRESS = "0x036CbD53842c5426634e7929541eC2318f3dCF7e";
    delete process.env.BASE_EXPLORER_URL;

    const config = loadConfig();
    expect(config.base!.explorerUrl).toBe("https://sepolia.basescan.org");
  });

  it("rejects invalid BASE_PASSPORT_NFT address format", () => {
    process.env.CHAIN_MODE = "base";
    process.env.BASE_RPC_URL = "https://sepolia.base.org";
    process.env.BASE_OPERATOR_KEY = "0xabcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789";
    process.env.BASE_PASSPORT_NFT = "not-an-address";
    process.env.BASE_TASK_ESCROW = "0x10812a4fc9ac31281e4a3e6e1d60bb571c2a4ca4";
    process.env.BASE_USDC_ADDRESS = "0x036CbD53842c5426634e7929541eC2318f3dCF7e";

    expect(() => loadConfig()).toThrow(/BASE_PASSPORT_NFT/);
  });

  it("provides UI config defaults for base mode", () => {
    process.env.CHAIN_MODE = "base";
    process.env.BASE_RPC_URL = "https://sepolia.base.org";
    process.env.BASE_OPERATOR_KEY = "0xabcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789";
    process.env.BASE_PASSPORT_NFT = "0x68ca4d1a9ff24f86328f2fb3a30d81e503d367f5";
    process.env.BASE_TASK_ESCROW = "0x10812a4fc9ac31281e4a3e6e1d60bb571c2a4ca4";
    process.env.BASE_USDC_ADDRESS = "0x036CbD53842c5426634e7929541eC2318f3dCF7e";

    const config = loadConfig();
    expect(config.ui).toBeDefined();
    expect(config.ui!.chainDisplayName).toBe("Base Sepolia");
    expect(config.ui!.currencySymbol).toBe("USDC");
    expect(config.ui!.currencyDecimals).toBe(6);
    expect(config.ui!.explorerName).toBe("Basescan");
    expect(config.ui!.accountLabel).toBe("Wallet Address");
    expect(config.ui!.accountPlaceholder).toBe("0x...");
  });

  it("provides UI config defaults for hedera mode", () => {
    process.env.HEDERA_OPERATOR_ID = "0.0.5266613";
    process.env.HEDERA_OPERATOR_KEY = "302e020100300506032b657004220420abcdef";
    process.env.HEDERA_NETWORK = "testnet";
    process.env.PASSPORT_TOKEN_ID = "0.0.1234567";
    process.env.AUDIT_TOPIC_ID = "0.0.7654321";
    process.env.DIRECTORY_TOPIC_ID = "0.0.8765432";
    process.env.x402_FACILITATOR_URL = "https://api.testnet.blocky402.com";
    process.env.x402_FEE_PAYER = "0.0.7162784";
    process.env.x402_TREASURY = "0.0.8011510";
    process.env.IPFS_API_KEY = "test-key";
    process.env.IPFS_API_SECRET = "test-secret";

    const config = loadConfig();
    expect(config.ui).toBeDefined();
    expect(config.ui!.chainDisplayName).toBe("Hedera Testnet");
    expect(config.ui!.currencySymbol).toBe("HBAR");
    expect(config.ui!.currencyDecimals).toBe(8);
    expect(config.ui!.explorerName).toBe("HashScan");
    expect(config.ui!.accountLabel).toBe("Hedera Account ID");
    expect(config.ui!.accountPlaceholder).toBe("0.0.xxxx");
  });

  it("allows overriding UI config vars via env", () => {
    process.env.CHAIN_MODE = "base";
    process.env.BASE_RPC_URL = "https://sepolia.base.org";
    process.env.BASE_OPERATOR_KEY = "0xabcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789";
    process.env.BASE_PASSPORT_NFT = "0x68ca4d1a9ff24f86328f2fb3a30d81e503d367f5";
    process.env.BASE_TASK_ESCROW = "0x10812a4fc9ac31281e4a3e6e1d60bb571c2a4ca4";
    process.env.BASE_USDC_ADDRESS = "0x036CbD53842c5426634e7929541eC2318f3dCF7e";
    process.env.CHAIN_DISPLAY_NAME = "Custom Chain";
    process.env.CURRENCY_SYMBOL = "TEST";
    process.env.CURRENCY_DECIMALS = "3";

    const config = loadConfig();
    expect(config.ui!.chainDisplayName).toBe("Custom Chain");
    expect(config.ui!.currencySymbol).toBe("TEST");
    expect(config.ui!.currencyDecimals).toBe(3);
  });
});
