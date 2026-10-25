/**
 * SLICE-173-3 (EPIC-173): key-rotation contract tests.
 *
 * AC2 — old verdicts verify WITHOUT code: the EIP-712 signature is
 *       self-describing (recovered == artifact.evaluator), rotation
 *       changes nothing in the acceptance path.
 * AC3 — public/keys/verdict-signers.json exists, {current,next} are
 *       well-formed EOAs (file is trust-ahead, not acceptance).
 * AC4 — deploy config scan: ARC_EVALUATOR_KEY / DEPLOYER_PRIVATE_KEY
 *       must not appear as set secret names.
 */

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { Wallet } from "ethers";
import type { Hex } from "viem";
import {
  createVerdictSigner,
  hashDeliverable,
  verifyVerdictSignature,
  verdictIdOf,
  type UnsignedVerdictArtifact,
} from "../src/server/lib/eaas/verdict";

const CHAIN_ID = 5042002;
const EOA_RE = /^0x[0-9a-f]{40}$/;

function unsignedFor(evaluator: Hex): UnsignedVerdictArtifact {
  const deliverableHash = hashDeliverable({ url: "https://x.test" });
  return {
    verdictId: verdictIdOf(deliverableHash, "deliverable-present", 0),
    kind: "approve",
    policy: "deliverable-present",
    deliverableHash,
    reason: "ok",
    reasonHash: ("0x" + "11".repeat(32)) as Hex,
    evidenceHash: ("0x" + "22".repeat(32)) as Hex,
    evaluator,
    chainId: CHAIN_ID,
    issuedAt: "2026-10-02T12:00:00.000Z",
  };
}

describe("173-3: rotation keeps old verdicts valid (AC2)", () => {
  it("artifact signed by the RETIRED key still verifies — file is not acceptance", async () => {
    const retired = createVerdictSigner(Wallet.createRandom().privateKey, CHAIN_ID);
    const unsigned = unsignedFor(retired.address as Hex);
    const artifact = { ...unsigned, signature: await retired.sign(unsigned) };

    const signers = JSON.parse(
      readFileSync("public/keys/verdict-signers.json", "utf8"),
    ) as { current: string; next: string };
    // rotated-out: not current, not next — still verifies.
    expect(signers.current.toLowerCase()).not.toBe(retired.address.toLowerCase());
    expect(signers.next.toLowerCase()).not.toBe(retired.address.toLowerCase());
    expect(verifyVerdictSignature(artifact)).toBe(true);
  });
});

describe("173-3: verdict-signers.json published contract (AC3)", () => {
  it("file exists with well-formed {current,next} EOAs", () => {
    const doc = JSON.parse(
      readFileSync("public/keys/verdict-signers.json", "utf8"),
    ) as { current: string; next: string; updated: string };
    expect(EOA_RE.test(doc.current)).toBe(true);
    expect(EOA_RE.test(doc.next)).toBe(true);
    expect(Number.isNaN(Date.parse(doc.updated))).toBe(false);
  });
});

describe("173-3: deploy env no longer lists retired keys (AC4)", () => {
  const secrets = readFileSync("scripts/set-fly-secrets.sh", "utf8");
  const setNames = secrets
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => /^[A-Z_]+$/.test(l));

  it("ARC_EVALUATOR_KEY is not a set secret (canonical: ARC_SETTLE_KEY/ARC_OPS_KEY)", () => {
    expect(setNames).not.toContain("ARC_EVALUATOR_KEY");
    expect(setNames).not.toContain("DEPLOYER_PRIVATE_KEY");
    expect(setNames).toContain("ARC_SETTLE_KEY");
    expect(setNames).toContain("ARC_OPS_KEY");
  });
});
