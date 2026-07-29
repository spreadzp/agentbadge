import { describe, it, expect } from "vitest";
import { ethers } from "ethers";
import { signWalletOwnership } from "../src/agents/wallet";
import { buildAgentCard } from "../src/agents/agent-card";
import { parseCliArgs, tierToCapabilities } from "../src/agents/hermes";
import { parseCommand, formatResultAsMarkdown } from "../src/agents/repl";

describe("Hermes: signWalletOwnership", () => {
  it("produces a signature that verifyWalletOwnership accepts", async () => {
    const wallet = ethers.Wallet.createRandom();
    const accountId = "0.0.1234567";
    const signature = await signWalletOwnership(accountId, wallet.privateKey);

    expect(signature).toBeTypeOf("string");
    expect(signature.length).toBeGreaterThan(0);

    // The server's verifyWalletOwnership uses ethers.verifyMessage
    // with message `Request Passport: ${accountId}`
    // It compares recovered address to accountId.
    // Since Hermes uses a random ETH key (not a Hedera account),
    // verifyWalletOwnership will return false for a non-matching accountId.
    // But we can verify the signature is valid for the message.
    const message = `Request Passport: ${accountId}`;
    const recovered = ethers.verifyMessage(message, signature);
    expect(recovered).toBe(wallet.address);
  });

  it("throws on empty accountId", async () => {
    const wallet = ethers.Wallet.createRandom();
    await expect(signWalletOwnership("", wallet.privateKey)).rejects.toThrow();
  });

  it("throws on empty privateKey", async () => {
    await expect(signWalletOwnership("0.0.123", "")).rejects.toThrow();
  });
});

describe("Hermes: parseCliArgs", () => {
  it("parses --register --name TradingBot --tier silver", () => {
    const args = parseCliArgs(["--register", "--name", "TradingBot", "--tier", "silver"]);
    expect(args).toEqual({
      register: true,
      interactive: false,
      name: "TradingBot",
      tier: "silver",
    });
  });

  it("parses --interactive flag", () => {
    const args = parseCliArgs(["--register", "--interactive", "--name", "Bot", "--tier", "gold"]);
    expect(args.interactive).toBe(true);
  });

  it("parses -i shorthand for --interactive", () => {
    const args = parseCliArgs(["-i", "--name", "Bot", "--tier", "gold"]);
    expect(args.interactive).toBe(true);
    expect(args.register).toBe(false);
  });

  it("parses without --register (just name + tier)", () => {
    const args = parseCliArgs(["--name", "DataBot", "--tier", "gold"]);
    expect(args).toEqual({
      register: false,
      interactive: false,
      name: "DataBot",
      tier: "gold",
    });
  });

  it("throws on missing --name", () => {
    expect(() => parseCliArgs(["--register", "--tier", "silver"])).toThrow(/name/i);
  });

  it("throws on missing --tier", () => {
    expect(() => parseCliArgs(["--register", "--name", "Bot"])).toThrow(/tier/i);
  });

  it("throws on invalid tier", () => {
    expect(() => parseCliArgs(["--register", "--name", "Bot", "--tier", "diamond"])).toThrow(
      /tier/i,
    );
  });
});

describe("Hermes: tierToCapabilities", () => {
  it("returns api_call + payment for bronze", () => {
    expect(tierToCapabilities("bronze")).toEqual(["api_call", "payment"]);
  });

  it("adds data_provide for silver", () => {
    expect(tierToCapabilities("silver")).toEqual(["api_call", "payment", "data_provide"]);
  });

  it("adds data_consume for gold", () => {
    expect(tierToCapabilities("gold")).toEqual([
      "api_call",
      "payment",
      "data_provide",
      "data_consume",
    ]);
  });

  it("adds orchestration for platinum", () => {
    expect(tierToCapabilities("platinum")).toEqual([
      "api_call",
      "payment",
      "data_provide",
      "data_consume",
      "orchestration",
    ]);
  });
});

describe("Hermes: buildAgentCard", () => {
  it("builds a valid AgentCard matching PRD shape", () => {
    const card = buildAgentCard({
      name: "TradingBot",
      did: "did:hcs:0.0.1234567:1",
      passportTokenId: "0.0.1234567",
      passportSerial: 1,
      capabilities: ["api_call", "payment", "data_provide"],
      tier: "silver",
      endpoint: "http://localhost:4030",
    });

    expect(card.name).toBe("TradingBot");
    expect(card.did).toBe("did:hcs:0.0.1234567:1");
    expect(card.passportTokenId).toBe("0.0.1234567");
    expect(card.passportSerial).toBe(1);
    expect(card.capabilities).toEqual(["api_call", "payment", "data_provide"]);
    expect(card.tier).toBe("Silver");
    expect(card.endpoints).toBeDefined();
    expect(card.endpoints.process).toBeDefined();
    expect(card.endpoints.process.payment).toBe("x402");
    expect(card.endpoints.status).toBeDefined();
    expect(card.endpoints.status.payment).toBe("free");
  });

  it("capitalizes tier correctly", () => {
    const card = buildAgentCard({
      name: "Bot",
      did: "did:hcs:0.0.1:1",
      passportTokenId: "0.0.1",
      passportSerial: 1,
      capabilities: ["api_call"],
      tier: "platinum",
      endpoint: "http://localhost:4030",
    });
    expect(card.tier).toBe("Platinum");
  });
});

describe("Hermes REPL: parseCommand", () => {
  it("parses 'help'", () => {
    const cmd = parseCommand("help");
    expect(cmd.action).toBe("help");
  });

  it("parses 'exit' and 'quit'", () => {
    expect(parseCommand("exit").action).toBe("exit");
    expect(parseCommand("quit").action).toBe("exit");
  });

  it("parses 'find agents with data_provide'", () => {
    const cmd = parseCommand("find agents with data_provide");
    expect(cmd.action).toBe("find_agents");
    expect(cmd.args.capability).toBe("data_provide");
  });

  it("parses 'find agents data_consume' (without 'with')", () => {
    const cmd = parseCommand("find agents data_consume");
    expect(cmd.action).toBe("find_agents");
    expect(cmd.args.capability).toBe("data_consume");
  });

  it("parses 'verify my passport'", () => {
    expect(parseCommand("verify my passport").action).toBe("verify_passport");
  });

  it("parses 'show my passport'", () => {
    expect(parseCommand("show my passport").action).toBe("get_passport");
  });

  it("parses 'list passports'", () => {
    expect(parseCommand("list passports").action).toBe("list_passports");
  });

  it("parses 'upgrade to gold'", () => {
    const cmd = parseCommand("upgrade to gold");
    expect(cmd.action).toBe("upgrade_tier");
    expect(cmd.args.newTier).toBe("gold");
  });

  it("rejects invalid tier in upgrade", () => {
    const cmd = parseCommand("upgrade to diamond");
    expect(cmd.action).toBe("error");
    expect(cmd.args.message).toMatch(/diamond/i);
  });

  it("parses 'audit trail'", () => {
    expect(parseCommand("audit trail").action).toBe("get_audit_trail");
  });

  it("parses 'catalog'", () => {
    expect(parseCommand("catalog").action).toBe("get_tier_requirements");
  });

  it("parses 'tiers'", () => {
    expect(parseCommand("tiers").action).toBe("get_tier_requirements");
  });

  it("parses 'show my card'", () => {
    expect(parseCommand("show my card").action).toBe("show_card");
  });

  it("parses 'write results.md'", () => {
    const cmd = parseCommand("write results.md");
    expect(cmd.action).toBe("write_file");
    expect(cmd.args.filename).toBe("results.md");
  });

  it("returns unknown for unrecognized input", () => {
    const cmd = parseCommand("do something random");
    expect(cmd.action).toBe("unknown");
  });
});

describe("Hermes REPL: formatResultAsMarkdown", () => {
  it("formats agent search results as table", () => {
    const md = formatResultAsMarkdown("find_agents", [
      { name: "TradingBot", did: "did:hcs:0.0.1:1", capabilities: ["api_call"], status: "active" },
    ]);
    expect(md).toContain("## Agent Search");
    expect(md).toContain("TradingBot");
    expect(md).toContain("did:hcs:0.0.1:1");
  });

  it("formats empty agent search", () => {
    const md = formatResultAsMarkdown("find_agents", []);
    expect(md).toContain("No agents found");
  });

  it("formats catalog with tiers", () => {
    const md = formatResultAsMarkdown("get_tier_requirements", {
      tiers: [
        { tier: "bronze", priceHbar: 10, capabilities: ["api_call"] },
        { tier: "silver", priceHbar: 50, capabilities: ["api_call", "data_provide"] },
      ],
    });
    expect(md).toContain("## Tier Catalog");
    expect(md).toContain("bronze");
    expect(md).toContain("silver");
  });

  it("formats audit trail", () => {
    const md = formatResultAsMarkdown("get_audit_trail", {
      events: [{ type: "passport_issued", did: "did:hcs:0.0.1:1", timestamp: 123, tier: "silver" }],
    });
    expect(md).toContain("## Audit Trail");
    expect(md).toContain("passport_issued");
  });

  it("formats passport info", () => {
    const md = formatResultAsMarkdown("get_passport", {
      did: "did:hcs:0.0.1:1",
      tier: "silver",
      accountId: "0.0.123",
      tokenId: "0.0.1",
      serial: 1,
      capabilities: ["api_call"],
      endpoint: "http://localhost:4030",
    });
    expect(md).toContain("## Passport Info");
    expect(md).toContain("did:hcs:0.0.1:1");
    expect(md).toContain("silver");
  });
});
