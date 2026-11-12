/**
 * SLICE-242-10 (D-242-15): settle-failure alerts — first occurrence pings,
 * identical reason inside 15 min is deduped to a quiet log; verify-fail
 * never reaches this module. Env-gated: no channel envs → full no-op.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const sendDiscord = vi.fn<(a: { message: string }) => Promise<void>>(
  async () => undefined,
);
const sendTelegram = vi.fn<(a: { message: string }) => Promise<void>>(
  async () => undefined,
);

vi.mock("../src/server/services/contact.service", () => ({
  sendDiscordMessage: (a: { message: string }) => sendDiscord(a),
  sendTelegramMessage: (a: { message: string }) => sendTelegram(a),
}));

import {
  alertSettleFailure,
  resetSettleFailureDedupe,
} from "../src/server/services/settle-failure-alert";

const base = {
  reason: "insufficient_funds",
  endpoint: "/api/total-scan",
  payer: "0xpayer",
  amountAtomic: "4500000",
  network: "eip155:5042",
};

beforeEach(() => {
  resetSettleFailureDedupe();
  sendDiscord.mockClear();
  sendTelegram.mockClear();
  vi.stubEnv("DISCORD_WEBHOOK_URL", "https://discord.example/hook");
  vi.stubEnv("TELEGRAM_BOT_TOKEN", "t");
  vi.stubEnv("TELEGRAM_CHAT_ID", "c");
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("alertSettleFailure", () => {
  it("first occurrence pings both channels with reason+endpoint", async () => {
    await alertSettleFailure(base);
    expect(sendDiscord).toHaveBeenCalledTimes(1);
    expect(sendTelegram).toHaveBeenCalledTimes(1);
    const msg = sendDiscord.mock.calls[0]![0].message;
    expect(msg).toContain("settle FAILED");
    expect(msg).toContain("insufficient_funds");
    expect(msg).toContain("/api/total-scan");
    expect(msg).toContain("4.5 USDC");
  });

  it("same reason within 15 min → deduped (no second ping)", async () => {
    await alertSettleFailure(base);
    await alertSettleFailure(base);
    expect(sendDiscord).toHaveBeenCalledTimes(1);
    expect(sendTelegram).toHaveBeenCalledTimes(1);
  });

  it("different reason → new ping", async () => {
    await alertSettleFailure(base);
    await alertSettleFailure({ ...base, reason: "gateway_timeout" });
    expect(sendDiscord).toHaveBeenCalledTimes(2);
  });

  it("no channel envs → full no-op, never throws", async () => {
    vi.unstubAllEnvs();
    delete process.env.DISCORD_WEBHOOK_URL;
    delete process.env.TELEGRAM_BOT_TOKEN;
    delete process.env.TELEGRAM_CHAT_ID;
    await expect(alertSettleFailure(base)).resolves.toBeUndefined();
    expect(sendDiscord).not.toHaveBeenCalled();
    expect(sendTelegram).not.toHaveBeenCalled();
  });

  it("channel throw is swallowed (logged), never propagates", async () => {
    sendDiscord.mockRejectedValueOnce(new Error("discord down"));
    await expect(alertSettleFailure(base)).resolves.toBeUndefined();
    expect(sendTelegram).toHaveBeenCalledTimes(1);
  });
});
