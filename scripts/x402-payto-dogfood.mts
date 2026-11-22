#!/usr/bin/env bun
/**
 * SLICE-258-6 dogfood tooling — publish + self-verify our own
 * x402 payout proof (draft-x402payto1) for agentbadge.xyz.
 *
 * Commands:
 *   inventory   live manifest + live 402 probe → what we actually quote
 *   message     canonical signable message (writes message.txt)
 *   sign        PAYOUT_PRIVATE_KEY env → signature + artifacts
 *               (key sanity-checked: must belong to payTo)
 *   emit --sig  write x402-payto.json + dns-txt.txt with given sig
 *   check       end-to-end self-verify = what AB-188 will report
 *   all         inventory → message → sign(if key) → check
 *
 * Logs: console + appended to <out>/dogfood.log (evidence trail).
 * Env: X402PAYTO_DOMAIN (default agentbadge.xyz), X402PAYTO_ISSUED
 * (default today UTC), X402PAYTO_PROBE (paid endpoint to probe),
 * X402PAYTO_OUT (artifacts dir), PAYOUT_PRIVATE_KEY (sign only).
 */
import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  buildCanonicalMessage,
  evaluatePaytoProofs,
  isIssuedDate,
  normalizeAddress,
  parseDnsTxtRecords,
  parseWellKnownFile,
  recoverEvmAddress,
  type PayToObservation,
  type ProofEntry,
} from "../../../packages/x402-payto-proof/src/index.ts";
import { queryDohTxt } from "../src/agent-readiness/scanner/fetchers/doh-txt.ts";

const REPO_ROOT = resolve(import.meta.dir, "../../..");
const DOMAIN = (process.env.X402PAYTO_DOMAIN ?? "agentbadge.xyz").toLowerCase();
const PROBE_URL =
  process.env.X402PAYTO_PROBE ?? `https://${DOMAIN}/api/v1/demo/scan-lite`;
const MANIFEST_URL = `https://${DOMAIN}/.well-known/x402.json`;
const WELLKNOWN_URL = `https://${DOMAIN}/.well-known/x402-payto.json`;
const ISSUED =
  process.env.X402PAYTO_ISSUED ?? new Date().toISOString().slice(0, 10);
const OUT_DIR =
  process.env.X402PAYTO_OUT ??
  resolve(REPO_ROOT, "docs/CONCURENTS/MESSAGES/2211/BenMcalilly/dogfood");
const DNS_NAME = `_x402-payto.${DOMAIN}`;
const FALLBACK_PAYTO = "0x23dd386015c154758ee765d2a063b94eabb251b3";

const lines: string[] = [];
function L(tag: string, msg: string) {
  const line = `${new Date().toISOString()} [${tag}] ${msg}`;
  console.log(line);
  lines.push(line);
}
function flushLog() {
  mkdirSync(OUT_DIR, { recursive: true });
  appendFileSync(resolve(OUT_DIR, "dogfood.log"), lines.join("\n") + "\n");
}
const arg = (name: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : undefined;
};

// ─── inventory ──────────────────────────────────────────────────────

async function fetchManifest(): Promise<{
  payTo: string;
  network?: string;
  services: { path?: string; method?: string }[];
}> {
  const res = await fetch(MANIFEST_URL, { signal: AbortSignal.timeout(10_000) });
  if (!res.ok) throw new Error(`manifest HTTP ${res.status}`);
  const doc = (await res.json()) as {
    payTo?: string;
    network?: string;
    services?: { path?: string; method?: string }[];
  };
  if (!doc.payTo) throw new Error("manifest has no payTo");
  return {
    payTo: normalizeAddress(doc.payTo),
    network: doc.network,
    services: doc.services ?? [],
  };
}

/** Probe the paid endpoint → decode accepts[] from PAYMENT-REQUIRED. */
async function probe402(): Promise<PayToObservation[]> {
  const res = await fetch(PROBE_URL, {
    signal: AbortSignal.timeout(10_000),
    redirect: "manual",
  });
  if (res.status !== 402) {
    L("probe", `WARN: ${PROBE_URL} → HTTP ${res.status}, expected 402`);
    return [];
  }
  const b64 =
    res.headers.get("payment-required") ??
    res.headers
      .get("www-authenticate")
      ?.match(/request="([^"]+)"/)?.[1];
  if (!b64) {
    L("probe", "WARN: 402 without PAYMENT-REQUIRED header");
    return [];
  }
  const payload = JSON.parse(atob(b64)) as {
    accepts?: { scheme?: string; network?: string; asset?: string; payTo?: string }[];
  };
  const observedAt = new Date().toISOString();
  return (payload.accepts ?? [])
    .filter((a) => a.payTo)
    .map((a) => ({
      payTo: normalizeAddress(a.payTo!),
      network: a.network,
      asset: a.asset,
      source: "live402" as const,
      observedAt,
    }));
}

async function stepInventory() {
  L("inventory", `manifest ${MANIFEST_URL}`);
  const m = await fetchManifest();
  L("inventory", `manifest payTo=${m.payTo} network=${m.network} services=${m.services.length}`);
  for (const s of m.services) L("inventory", `  service ${s.method ?? "?"} ${s.path ?? "?"}`);

  const obs = await probe402();
  const seen = new Set<string>();
  for (const o of obs) {
    const k = `${o.network}|${o.asset}|${o.payTo}`;
    if (seen.has(k)) continue;
    seen.add(k);
    L("inventory", `live402 accept network=${o.network} asset=${o.asset} payTo=${o.payTo}`);
  }
  if (obs.length === 0) L("inventory", "WARN: no live402 observations");
  const uniq = new Set(obs.map((o) => o.payTo));
  if (uniq.size > 1) L("inventory", `WARN: ${uniq.size} DISTINCT payTo in accepts — sign one record per address`);
  L("inventory", uniq.has(m.payTo)
    ? `OK: live402 payTo == manifest payTo (${m.payTo})`
    : `MISMATCH: manifest ${m.payTo} not in live402 accepts ${[...uniq].join(",")}`);
  return { manifest: m, observations: obs };
}

// ─── message / sign / emit ──────────────────────────────────────────

function messageFor(payTo: string) {
  if (!isIssuedDate(ISSUED)) throw new Error(`bad --issued ${ISSUED}`);
  return buildCanonicalMessage({ domain: DOMAIN, address: payTo, issued: ISSUED });
}

function emitArtifacts(payTo: string, sig?: string) {
  mkdirSync(OUT_DIR, { recursive: true });
  const sigField = sig ?? "0xSIGNATURE_HERE";
  writeFileSync(
    resolve(OUT_DIR, "x402-payto.json"),
    JSON.stringify(
      { version: 1, domain: DOMAIN, payTo: [{ address: payTo, issued: ISSUED, signature: sigField }] },
      null, 2,
    ) + "\n",
  );
  writeFileSync(
    resolve(OUT_DIR, "dns-txt.txt"),
    [
      `# DNS TXT — publish at ${DNS_NAME}`,
      `Type:  TXT`,
      `Name:  ${DNS_NAME}`,
      `Value: v=x402payto1; a=${payTo}; d=${ISSUED}; s=${sigField}`,
      ``,
    ].join("\n"),
  );
  L("emit", `wrote x402-payto.json + dns-txt.txt → ${OUT_DIR}`);
}

async function stepMessage(payTo: string) {
  const msg = messageFor(payTo);
  mkdirSync(OUT_DIR, { recursive: true });
  writeFileSync(resolve(OUT_DIR, "message.txt"), msg);
  L("message", `canonical message (${msg.length} bytes) → message.txt`);
  console.log("---\n" + msg + "\n---");
}

async function stepSign(payTo: string) {
  const raw = process.env.PAYOUT_PRIVATE_KEY;
  const msg = messageFor(payTo);
  if (!raw) {
    L("sign", "no PAYOUT_PRIVATE_KEY — offline sign:");
    L("sign", `  cast wallet sign --private-key $KEY "$(cat ${resolve(OUT_DIR, "message.txt")})"`);
    L("sign", "  or personal_sign in a wallet UI over the exact bytes above");
    return;
  }
  const { privateKeyToAccount } = await import("viem/accounts");
  const account = privateKeyToAccount(raw.startsWith("0x") ? (raw as `0x${string}`) : `0x${raw}`);
  if (normalizeAddress(account.address) !== normalizeAddress(payTo)) {
    L("sign", `REFUSE: key belongs to ${account.address}, payTo is ${payTo} — signature would be INVALID`);
    process.exitCode = 1;
    return;
  }
  const sig = await account.signMessage({ message: msg });
  const recovered = recoverEvmAddress(msg, sig);
  if (recovered !== normalizeAddress(payTo)) {
    L("sign", `ERROR: local recovery gave ${recovered} — do NOT publish`);
    process.exitCode = 1;
    return;
  }
  L("sign", `signature OK — recovers to ${recovered}`);
  L("sign", `s=${sig}`);
  emitArtifacts(payTo, sig);
}

// ─── check (self-verify = what AB-188 reports) ─────────────────────

function txtChunks(data: string): string[] {
  const m = data.match(/"((?:[^"\\]|\\.)*)"/g);
  return m ? m.map((s) => s.slice(1, -1).replace(/\\"/g, '"')) : [data];
}

async function stepCheck(domain: string) {
  // 1) live402 observations (authoritative) + manifest (hint)
  const obs: PayToObservation[] = await probe402();
  let manifestPayTo: string | undefined;
  try {
    const m = await fetchManifest();
    manifestPayTo = m.payTo;
    if (manifestPayTo && !obs.some((o) => o.payTo === manifestPayTo)) {
      obs.push({ payTo: manifestPayTo, network: m.network, source: "manifest", observedAt: new Date().toISOString() });
    }
  } catch (e) {
    L("check", `manifest fetch failed (hint skipped): ${(e as Error).message}`);
  }
  L("check", `observations: ${obs.length} (${obs.filter((o) => o.source === "live402").length} live402)`);

  // 2) DNS tier — dual DoH (disagreement → unchecked, never a pick)
  const doh = await queryDohTxt(DNS_NAME, { dual: true });
  L("check", `DoH ${DNS_NAME}: status=${doh.status} resolversAgreed=${doh.resolversAgreed} answers=${doh.answers.length}`);
  const parsed = parseDnsTxtRecords(doh.answers.map((a) => txtChunks(a.data)));
  const dnsEntries: ProofEntry[] = [];
  let malformedCount = 0;
  for (const p of parsed) {
    if (p.status === "ok" && p.entry) {
      dnsEntries.push(p.entry);
      L("check", `  dns entry a=${p.entry.address} d=${p.entry.issued ?? "-"} s=${p.entry.signature ? p.entry.signature.slice(0, 14) + "…" : "none"}`);
    } else {
      malformedCount += 1;
      L("check", `  dns record ${p.status}: ${p.error}`);
    }
  }

  // 3) well-known tier
  let siteEntries: ProofEntry[] = [];
  let siteState: "ok" | "absent" | "unchecked" = "unchecked";
  try {
    const res = await fetch(WELLKNOWN_URL, { signal: AbortSignal.timeout(10_000), redirect: "manual" });
    if (res.status === 404) {
      siteState = "absent";
      L("check", `well-known ${WELLKNOWN_URL}: 404 absent`);
    } else if (!res.ok) {
      L("check", `well-known ${WELLKNOWN_URL}: HTTP ${res.status} → unchecked`);
    } else {
      const wk = parseWellKnownFile(await res.json(), domain);
      siteState = "ok";
      siteEntries = wk.entries;
      for (const e of wk.entries) L("check", `  site entry a=${e.address} d=${e.issued ?? "-"} s=${e.signature ? e.signature.slice(0, 14) + "…" : "none"}`);
      for (const e of wk.errors) L("check", `  site parse warn: ${e}`);
    }
  } catch (e) {
    L("check", `well-known fetch failed → unchecked: ${(e as Error).message}`);
  }

  // 4) evaluate — same function AB-188 calls.
  // DoH "absent" (NXDOMAIN/NOERROR-no-TXT) is a SUCCESSFUL query —
  // the absence shows via empty dnsEntries; only transport-level
  // failure/disagreement maps to "unchecked".
  const result = evaluatePaytoProofs({
    observations: obs,
    dnsEntries,
    siteEntries,
    malformedCount,
    dnsState: doh.status === "unchecked" ? "unchecked" : "ok",
    siteState,
    liveRecheckDone: doh.status !== "unchecked", // fresh DNS query IS the live re-check
    observedAt: new Date().toISOString(),
    domain,
  });

  for (const a of result.perAddress) {
    L("check", `per-address ${a.key} → ${a.outcome}${a.level ? ` (${a.level})` : ""} sig=${a.signatureStatus}${a.anomalies.length ? ` [${a.anomalies.join(",")}]` : ""}`);
  }
  for (const an of result.anomalies) L("check", `anomaly: ${an}`);
  const verdict =
    result.aggregate === "verified" ? `VERIFIED (${result.perAddress[0]?.level ?? "?"})`
    : result.aggregate === "partial" ? "PARTIAL → INFERRED"
    : result.aggregate === "mismatch" || result.conflicts.length > 0 ? "CONFLICT"
    : result.aggregate === "absent" ? "GAP (recommendation)"
    : result.aggregate === "malformed" ? "GAP + fix-hint (malformed)"
    : "NOT_APPLICABLE / unchecked";
  L("check", `aggregate=${result.aggregate} conflicts=${result.conflicts.length}`);
  L("check", `AB-188 would report: ${verdict}`);
  return result.aggregate;
}

// ─── dispatch ───────────────────────────────────────────────────────

const cmd = process.argv[2] ?? "all";
try {
  L("dogfood", `cmd=${cmd} domain=${DOMAIN} issued=${ISSUED} out=${OUT_DIR}`);
  if (cmd === "inventory") {
    await stepInventory();
  } else if (cmd === "check") {
    await stepCheck(DOMAIN);
  } else if (cmd === "message" || cmd === "sign" || cmd === "emit") {
    const { manifest, observations } = await stepInventory();
    const payTo = arg("payto") ?? manifest.payTo ?? FALLBACK_PAYTO;
    if (cmd === "message") await stepMessage(payTo);
    if (cmd === "sign") await stepSign(payTo);
    if (cmd === "emit") {
      const sig = arg("sig");
      if (!sig) throw new Error("emit needs --sig 0x…");
      const recovered = recoverEvmAddress(messageFor(payTo), sig);
      if (recovered !== normalizeAddress(payTo)) {
        throw new Error(`sig recovers to ${recovered}, not ${payTo} — refusing to emit`);
      }
      L("emit", `sig verified locally → ${recovered}`);
      emitArtifacts(payTo, sig);
    }
    void observations;
  } else if (cmd === "all") {
    const { manifest } = await stepInventory();
    const payTo = arg("payto") ?? manifest.payTo ?? FALLBACK_PAYTO;
    await stepMessage(payTo);
    await stepSign(payTo);
    await stepCheck(DOMAIN);
  } else {
    L("dogfood", `unknown cmd ${cmd} — inventory|message|sign|emit|check|all`);
    process.exitCode = 1;
  }
} catch (e) {
  L("dogfood", `FATAL: ${(e as Error).message}`);
  process.exitCode = 1;
} finally {
  flushLog();
}
