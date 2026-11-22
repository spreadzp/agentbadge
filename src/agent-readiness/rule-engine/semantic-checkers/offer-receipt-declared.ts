// SLICE-258-9: AB-190 — x402 offer-and-receipt extension declaration
// (specs/extensions/extension-offer-and-receipt.md). Presence-detection
// only (D-258-Q15, C9): a found result proves the extension is DECLARED
// in a live 402 challenge or the x402 manifest — it says nothing about
// signature validity, signer↔domain key binding, or receipt delivery.
// Those stay `not_implemented` in the detail, split per C9.
//
// The extension composes with AB-188: offer-receipt binds the SERVER
// SIGNING KEY to the domain; payto-proof binds the PAYOUT ADDRESS.
import type { SemanticChecker, SemanticCheckResult } from "./helpers";
import { offerReceiptExtensionOf } from "../../scanner/fetchers/offer-receipt-extension";

interface AttemptDoc {
  offerReceipt?: { declared: boolean; offers: number; formats: string[]; malformed?: boolean };
}

interface ProbeDoc {
  endpoint: string;
  attempts?: AttemptDoc[];
}

interface Detail {
  verdict: "extension_declared" | "absent" | "malformed" | "not_applicable";
  summary: string;
  extension_declared: boolean;
  extension_signature_verified: "not_implemented";
  key_binding_verified: "not_implemented";
  declared_in: string[];
  offers: number;
  formats: string[];
  endpoints: string[];
  fix?: string;
}

const FIX =
  "Declare the x402 offer-and-receipt extension: add extensions[\"offer-receipt\"].info.offers[] ({format: eip712|jws, payload?, signature}) to the 402 payment-requirements response and bind the signing key to did:web:<domain>";

export const checkerOfferReceiptDeclared: SemanticChecker = (
  sources,
): SemanticCheckResult => {
  const snap = sources["x402"];
  if (!snap) {
    return { outcome: "no_source", detail: "No x402 snapshot available" };
  }

  let manifest: unknown = null;
  let probes: ProbeDoc[] = [];
  if (snap.body) {
    try {
      const doc = JSON.parse(snap.body) as { manifest?: unknown; probes?: ProbeDoc[] };
      manifest = doc.manifest ?? null;
      probes = Array.isArray(doc.probes) ? doc.probes : [];
    } catch {
      /* unparseable body — treated as no evidence */
    }
  }

  const done = (detail: Detail, outcome: SemanticCheckResult["outcome"]): SemanticCheckResult => ({
    outcome,
    detail: JSON.stringify(detail),
  });
  const base: Detail = {
    verdict: "absent",
    summary: "",
    extension_declared: false,
    extension_signature_verified: "not_implemented",
    key_binding_verified: "not_implemented",
    declared_in: [],
    offers: 0,
    formats: [],
    endpoints: [],
  };

  if (manifest === null && probes.length === 0) {
    return done(
      {
        ...base,
        verdict: "not_applicable",
        summary: "Site does not advertise x402 payments",
      },
      "not_applicable",
    );
  }

  const declaredIn = new Set<string>();
  const formats = new Set<string>();
  const endpoints = new Set<string>();
  let offers = 0;
  let sawKey = false;
  let anyValid = false;

  const absorb = (
    summary: { declared: boolean; offers: number; formats: string[]; malformed?: boolean } | null,
    where: "manifest" | "probe",
    endpoint?: string,
  ) => {
    if (!summary?.declared) return;
    sawKey = true;
    if (summary.offers === 0) return;
    anyValid = true;
    declaredIn.add(where);
    if (endpoint) endpoints.add(endpoint);
    offers += summary.offers;
    for (const f of summary.formats) formats.add(f);
  };

  absorb(offerReceiptExtensionOf(manifest), "manifest");
  for (const p of probes) {
    // Double-probe hits the same endpoint twice — count the declaration
    // once per endpoint (first attempt carrying the extension key wins;
    // an attempt with the key malformed-but-present still counts as seen).
    let seenHere = false;
    for (const a of p.attempts ?? []) {
      if (a.offerReceipt?.declared) sawKey = true;
      if (seenHere || !a.offerReceipt?.declared) continue;
      absorb(a.offerReceipt, "probe", p.endpoint);
      seenHere = true;
    }
  }

  if (anyValid) {
    return done(
      {
        ...base,
        verdict: "extension_declared",
        summary:
          "x402 offer-and-receipt extension declared — presence detected, signatures not verified",
        extension_declared: true,
        declared_in: [...declaredIn].sort(),
        offers,
        formats: [...formats].sort(),
        endpoints: [...endpoints].sort(),
      },
      "found",
    );
  }

  if (sawKey) {
    return done(
      {
        ...base,
        verdict: "malformed",
        summary:
          "offer-receipt extension key present but offers[] unusable — declaration is malformed",
        extension_declared: true,
        fix: FIX,
      },
      "absent",
    );
  }

  return done(
    {
      ...base,
      summary:
        "x402 payments advertised but the offer-and-receipt extension is not declared",
      fix: FIX,
    },
    "absent",
  );
};
