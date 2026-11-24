# Review Findings — x402-payto-proof (EPIC-258)
## Scope
Reviewed all 22 attached files: `packages/x402-payto-proof` (types, parse, canonical, signature, evaluate, freshness, psl, index), the DoH, DNS, well-known and MPP fetchers, the two input collectors, the AB-188, AB-189 and AB-190 checkers, the verdict mapper, `payto-recheck/*`, and `public/.well-known/x402-payto.json`. Not provided, so unverified: `safe-fetch`, the x402 probe fetcher that sets `divergent`, `Snapshots` and `helpers`, and the `serveStatic` wiring.

## Verdict
BLOCK. The cross-scan diff reports false revocations (reproduced) and the checkers can emit a clean `verified` verdict while hiding endpoints that were never verified (code-proven). Several documented guards are weaker than their comments claim: dual-resolver agreement, the DNS-unchecked mismatch gate, and "never infer confirmed absence". The signature, parse and freshness core is solid, and the issues below are mostly in the orchestration around it.

How findings were checked: I ran the attached source unmodified in a scratch harness outside the repo (`diffPaytoReports`, `proofSnapshotFromInputs`, `evaluatePaytoProofs`, `lookupNameCandidates`, `parseDnsTxtRecord`). Findings marked **Reproduced** come from that harness. The scratch files are deleted and no source was changed.

## Critical

### C1. False revocation of site-tier payout proofs on any well-known fetch failure (Reproduced)
- `payto-recheck/snapshot.ts:68-70`: `absence_confirmed = liveRecheckDone === true && dnsState === "ok"`. It ignores `siteState`.
- `payto-recheck/diff.ts:43`: `if (cur.absence_confirmed === true) return true;` runs before the site-member guard at `diff.ts:47-50`. The `site_state !== "unchecked"` check is therefore dead for every scan with a fresh DNS lookup.
- Repro: prev has site member P with DNS absent. cur has a fresh DNS lookup returning absent (`dnsState "ok"`, `liveRecheckDone true`) and a well-known fetch that timed out (`siteState "unchecked"`, `siteEntries []`). Result: `cur.absence_confirmed === true`, and the diff returns `["DROPPED:medium"]` with the note "possible rotation or compromise".
- Same outcome for status 0 (`payto-wellknown-fetcher.ts:51`), 3xx (`maxRedirects: 0`, collapses to `unchecked` at `x402-payto-inputs.ts:168`), 5xx, and a missing site snapshot (`x402-payto-inputs.ts:157`).
- Exploit: anyone who can make one well-known fetch fail (a 503 or 429 for the scanner, a slow response) makes the watcher report every site-tier address as revoked. If any other member is added in the same run, every drop is relabelled `ROTATED` with `replaced_by: added[0]` (`diff.ts:196-206`). This is the false-revocation case the module says it prevents.
- Fix: compute confirmation per tier (`dnsConfirmed`, `siteConfirmed`) and remove the L43 shortcut. A site member needs `site_state !== "unchecked"` in all cases.

### C2. A `verified`/`found` verdict silently ignores endpoints that were skipped, so unverified quotes ride along (Code-proven)
- `x402-payto-inputs.ts:260-269`: when probe 2 fails or probe 1 has no accepts, the endpoint hits `continue` and adds no observation and no `unchecked` row. Only `skipReasons` is touched.
- `mpp-recipient-inputs.ts:101-109` and `140-145` do the same for MPP.
- `evaluate.ts:200-225` aggregates over the rows that exist. `payto-proof-verdict.ts:86-94` returns `found` / "Payout address proven at … level" and never reads `coverage.skip_reasons`. `coverage` is only used in the `partial` summary text.
- Exploit: a seller has `/a` (stable, quotes proven P) and `/b` (quotes attacker address X to real payers, answers the second request with a 5xx or a non-402). `/b` contributes only `second_probe_failed`. The aggregate is `verified` over `/a` alone, so the verdict is `found`. `coverage.probed` is 2 and `accepts_found` is 1, but nothing downgrades the outcome. Returning 200 on probe 1 gives the same result via `no_accepts_in_402`.
- Assumption: the site has at least one endpoint that verifies. A single compromised endpoint alone yields `not_applicable`, which is safe.
- Fix: if `skipReasons` is non-empty or `probed` is greater than the number of endpoints that produced rows, cap the aggregate at `partial`, or emit an `unchecked` row per skipped endpoint.

## High

### H1. Dual-DoH "both resolvers must agree" is enforced only when both answer `ok` (`doh-txt.ts:111-128`)
- `doh-txt.ts:115` compares sets only when `live.length === 2 && a.status === "ok" && b.status === "ok"`.
- `doh-txt.ts:122`: `winner = live.find(ok) ?? live[0]`. One resolver `ok` plus the other `absent` returns `ok` with the first resolver's records. One resolver `ok` plus the other failed (`null`, dropped at L111) also returns `ok`. One resolver `absent` plus the other failed returns `absent`.
- Exploit: a single misbehaving or compromised resolver, or a resolver-side poisoned cache, injects `v=x402payto1; a=<attacker>` while the other resolver correctly says NXDOMAIN. The result is `hit`, which shadows the site tier and gives level `dns`. The same single-survivor path turns a real record into `absent` (cached 5 minutes at `payto-dns-fetcher.ts:181`), which opens the site-tier fallback.
- The header comment ("resolver disagreement is never resolved by picking one side") and `dual: true` do not hold. `resolversAgreed` is returned but never read by `payto-dns-fetcher.ts`.
- Assumption: threat model includes one hostile or buggy resolver, which is what `dual` exists for.
- Fix: in dual mode, return `unchecked` unless both resolvers answered with the same status and set.

### H2. DNS `unchecked` still lets the site tier decide, and a failed lookup counts as a "live re-check" (Reproduced)
- `evaluate.ts:75-81`: with `dnsState "unchecked"` and site entries present, `setState` is `ready`. The only effect is the anomaly string `dns_unchecked_precedence_unknown`. `evaluate.ts:187` then emits `mismatch` whenever `liveRecheckDone` is true.
- `x402-payto-inputs.ts:148`: `liveRecheckDone = fromCache === false`. A fresh lookup that failed returns `fromCache:false, status:"unchecked"` (`payto-dns-fetcher.ts:190-195`). The rate-limited path at `payto-dns-fetcher.ts:152-161` returns the same shape without doing any lookup. So `liveRecheckDone` is true while DNS was never read.
- Repro: `dnsState "unchecked"`, site `[P]`, quote X, `liveRecheckDone true` gives aggregate `mismatch`, then the verdict short-circuits to `conflict` (`payto-proof-verdict.ts:75`). DNS would have shadowed the site file, so the accusation is unfounded.
- Forward case: a web-server compromiser plus any condition that makes both DoH lookups fail or disagree gets `verified` at level `site` with only an anomaly string. The verdict ignores that anomaly.
- Fix: require `dnsState === "ok"` for `mismatch`, and for `verified` via the site tier when DNS could shadow it. Set `liveRecheckDone` only when `status !== "unchecked"`.

### H3. DNS-tier `DROPPED` is inferred on cache-hit and single-resolver results (Reproduced)
- `diff.ts:44`: `if (prev.source === "dns") return cur.dns_state === "ok";`. This runs even when `absence_confirmed` is false.
- Repro: prev DNS member P. cur is a cache-hit run (`liveRecheckDone false`, so `absence_confirmed false`) with `dns_state "ok"` and no entries. Result: `DROPPED`.
- `dns_state "ok"` is set for every non-`unchecked` status (`x402-payto-inputs.ts:143`), including a 5-minute negative cache entry and an H1 single-survivor `absent`.
- This contradicts `types.ts:49-54` ("The diff never INFERS confirmedness") and `snapshot.ts:24-27` ("the only path to `absence_confirmed`").
- Fix: DNS members need `absence_confirmed === true`, or a separate `dns_fresh` flag on the snapshot.

### H4. The per-payment exemption is unconditional and can be laundered across endpoints
- `evaluate.ts:130-133` checks `perPaymentSuspect` before the proof-set state, so even when no proof exists anywhere the row is `possible_per_payment_address`. Repro with DNS absent, site absent, and two divergent addresses: `conflicts 0`, aggregate `unchecked`, and `mapEvaluationVerdict` returns outcome `partial` with verdict `possible_per_payment_address` (`payto-proof-verdict.ts:115-122`). A seller with no proof gets `partial` instead of `absent` plus the fix text.
- `x402-payto-inputs.ts:246` and `mpp-recipient-inputs.ts:87` dedupe `liveKeys` across all endpoints, first writer wins. If a divergent endpoint (rows flagged suspect) is processed before a stable endpoint quoting the same unproven address, the stable endpoint's mismatch is dropped and the row stays exempt. The surviving row's `probe_id` also points to the wrong endpoint.
- Exploit: the seller controls its own endpoints. Return X and Y on alternating probes at `/deposit`, quote X at `/pay`, and the `/pay` mismatch never surfaces.
- Assumption: the scanner lists the divergent endpoint first. That ordering comes from the probe list, which the seller can influence through its manifest.
- Fix: dedupe per `(endpoint, key)`, with a non-suspect row beating a suspect one. For exempt rows, still surface the proof-set state.

## Medium

### M1. A malformed or unsupported DNS record does not shadow the site tier (Reproduced)
- `evaluate.ts:69-70`: `dnsDecides = dns.length > 0`. `x402-payto-inputs.ts:149-152` counts both `malformed` and `unsupported_version` as `malformedCount` and never creates an entry.
- Repro: `dnsEntries []`, `malformedCount 1`, site `[X]`, quote X gives `verified`, level `site`, `anomalies []`.
- The spec says any DNS proof shadows the site file. A typo or a future `v=x402payto2` record in DNS therefore hands precedence to the web server, with no anomaly emitted.
- A future-dated DNS entry dropped at `evaluate.ts:53-66` does the same.
- Counting `unsupported_version` as malformed (L151) also contradicts "MUST be ignored". A v2-only publisher gets verdict `malformed` with a v1 fix hint.

### M2. Non-calendar `issued` dates bypass the future-date drop (Reproduced)
- `canonical.ts:50-52` accepts `^\d{4}-\d{2}-\d{2}$`. `canonical.ts:62-63` returns `false` (keep) when `Date.parse` is NaN.
- `9999-99-99` and `2026-13-45` parse as NaN, so the entry is never dropped. Repro: DNS entry issued `9999-99-99`, quote matches, result `verified`. The only trace is an `issued_unparseable` anomaly. A real far-future date (`9999-12-31`) is correctly dropped.
- `parse.ts:42` and `parse.ts:117` rely on the same regex. `2026-02-31` rolls to March 3 under V8 (`Date.parse` gave `1772496000000`), which is engine-specific.
- Impact: spec §4.3 can be evaded. A signed far-future `Issued` never ages and never trips `stale_issued`.
- Fix: parse strictly (round-trip through `Date.UTC`), and treat NaN as drop or malformed.

### M3. DNS cache: TTL-0 becomes 24 hours, the longest TTL is used, and expired entries are served
- `payto-dns-fetcher.ts:178`: `Math.max(...ttls, 0) * 1000 || MAX_POSITIVE_TTL_MS`. TTL 0 is falsy, so a record published with TTL 0 is cached 24 hours (computed: `86400000`). `max` also picks the longest TTL across records, not the shortest.
- `payto-dns-fetcher.ts:140-150`: the rate-limited path returns `entry` without checking `expiresAt`. Steps: an old positive entry expires, a later live lookup returns `unchecked` (never cached, but `lastRecheck` is set at L169), then a `forceRecheck` within 60 seconds returns the long-expired positive as `fromCache:true`. A revoked proof reads `verified`.
- Effect is bounded: `fromCache` stays true, so no false mismatch results.

### M4. Unbounded and weakly keyed caches (`payto-dns-fetcher.ts:59-60, 118, 163-169`)
- Neither `cache` nor `lastRecheck` is evicted, and keys are caller-supplied domains. Each distinct `*.example.com` scan adds an entry and costs 2 DoH calls per candidate name.
- The key is only lowercased: `example.com` and `example.com.` are separate buckets, so the 60-second recheck budget doubles.
- The recheck budget is per domain and not per caller. Any scan within 60 seconds forces another caller's `forceRecheck` onto the cached view (L134-139).
- Assumption: domains come from user-submitted scans.

### M5. Signature domain is the scanned host, not the record's owner name (`x402-payto-proof.ts:86` to `evaluate.ts:99`; `snapshot.ts:48,57`)
- A proof published at a parent (`_x402-payto.example.com`) is verified against `Domain: api.example.com`. A signature the owner made for `example.com` reads `invalid` for every child, producing a `signature_invalid` anomaly. A `dns_signed` level can never be reached through a parent record.
- Assumption: spec §4 means the domain the record is published for. Confirm against the spec.
- `proof_set.signature_status` (`snapshot.ts:48,57`) re-verifies every raw entry, including future-dated, shadowed and duplicate ones. `perAddress` (`evaluate.ts:105-106`, `.find` first match) reports only the first effective entry. The two can disagree for the same address.

### M6. `proof_set` includes entries the evaluator rejected, so the diff reports them as proven
- `x402-payto-proof.ts:151-160` passes raw `inputs.dnsEntries` and `siteEntries` (pre-shadowing, pre-future-drop).
- A site entry shadowed by DNS, or a future-dated DNS entry, shows up as `still_verified` or `newly_proven` in `diffPaytoReports`, while `evaluate` excluded it.
- The `types.ts:47` comment ("pre-shadowing") makes this intentional, but the transition names say "proven".

### M7. The diff understates add-only and re-add compromise
- `diff.ts:216-238`: a new member alongside intact members is `newly_proven`, severity `info`, summary `unchanged_info` (Reproduced: `["still_verified:none","newly_proven:info"]`). Adding an attacker address while keeping the legitimate ones raises no medium alert. The transition does not carry the new entry's signature status, so unsigned and signed adds look identical.
- `REAPPEARED` (an address previously dropped, `diff.ts:217-225`) is also `info`.
- `diff.ts:119-121`: only `valid` to `invalid` is a `CONFLICT`. `valid` to `none` or `unverifiable` (signature stripped or corrupted) is `still_verified` with severity `none`.

### M8. Public-suffix approximation queries registry and platform apex names (`psl.ts:53-62`)
- The loop bound `i <= labels.length - 2` always includes the last two labels. The doc comment says the registrable suffix is excluded. Output (Reproduced): `shop.example.co.uk` gives `["shop.example.co.uk","example.co.uk","co.uk"]`. Also `t.pythonanywhere.com` gives `[..., "pythonanywhere.com"]`, `x.us-east-1.amazonaws.com` gives `[..., "us-east-1.amazonaws.com"]`, `x.s3.amazonaws.com` gives `[..., "s3.amazonaws.com"]`.
- The shared list has 22 entries and only exact-match breaks. A TXT record at an unlisted platform apex, or at any listed-platform child that is itself multi-tenant, applies to every tenant below it. Exploit needs a platform that lets a tenant create the `_x402-payto` label at its apex, or a platform that publishes its own proof. Both are assumptions.
- Positive verification: sibling names are never queried, and case, one trailing dot and a double trailing dot are all handled.

### M9. Summary and coverage mislead on mixed results (`payto-proof-verdict.ts:51-52, 86-94`)
- `v = result.perAddress.find(verified)`: the summary reports the first verified row's level, so "proven at dns_signed" can sit next to an unsigned `dns` row or a weaker `site` row.
- `coverage.absent_or_unchecked` counts `absent + unchecked + malformed` and omits `possible_per_payment_address`. Five exempt rows report `accepts_found 5`, `verified 0`, `mismatch 0`, `absent_or_unchecked 0`.

### M10. MPP quote on probe 2 only is silently dropped (`mpp-recipient-inputs.ts:101-117, 140-145`; `mpp-payment-challenge.ts:114`)
- `mppQuotesDivergent` returns `false` when either set is empty, and the caller only guards `quotes2` being empty. With `quotes1 []` and `quotes2 [X]`, the code takes the non-divergent branch, pushes `quotes1` (nothing) and records no `skipReason`. The x402 collector at least records `no_accepts_in_402` for the same shape (`x402-payto-inputs.ts:261-264`).
- The x402-embedded MPP path (`mpp-recipient-inputs.ts:140-145`) behaves the same when `m1` is empty.
- The non-divergent branch never evaluates probe 2's quotes. The x402 path trusts `p.divergent` and the MPP x402-probe path trusts `p.mppDivergent`, both set upstream (not provided).

### M11. O(n²) evaluation on seller-controlled counts (`evaluate.ts:200-204`; no cap at `x402-payto-inputs.ts:233`)
- `live = perAddress.filter(a => observations.find(o => observationKey(o) === a.key ...))` is quadratic. Measured: 4,000 observations took 2.3 s, 8,000 took 8.7 s.
- Assumption: the probe fetcher's body cap (not provided) allows thousands of `accepts`. Roughly 60 bytes per entry puts 4,000 entries near 240 KB.

### M12. Seller JSON is not validated before use (`x402-payto-inputs.ts:233-245`)
- `a.payTo` dereferences `a` without a null check, so `accepts: [null]` throws a `TypeError` and the whole checker fails. `network` and `asset` are typed `string` but never checked, and they enter `observationKey` and the key string with `|` separators.
- Seller-controlled `payTo` strings are placed uncapped into `summary` (`payto-proof-verdict.ts:76-82`), `notes` (`x402-payto-proof.ts:131-136`) and `anomalies` (`evaluate.ts:58`). Impact depends on how the report is rendered (markdown or HTML). Assumption: the renderer does not escape these.
- Assumption: the snapshot stores raw seller JSON for `accepts`. The probe fetcher is not provided. The MPP path guards this (`mpp-payment-challenge.ts:64`).

### M13. Well-known entry errors are dropped, so malformed content reads `absent` or produces false mismatch (`parse.ts:96-129`, `x402-payto-inputs.ts:165`)
- Entries with a bad `issued` or no `address` are skipped with a message in `errors`, which the collector never reads. A file whose entries are all skipped returns `status "ok"`, `entries []`, `malformedCount 0`. Result: `siteState "ok"`, set state `absent`.
- Entries beyond 20 are truncated. A 21st payout address that is quoted then reads `mismatch` (when `liveRecheckDone`), and in the diff it reads `DROPPED`. The truncation message is lost.

### M14. A blanket `catch` turns library failure into `unverifiable` (`signature.ts:50-59`)
- Any exception, including API drift, returns `null`, then `unverifiable`. Reproduced in this sandbox: with `@noble/curves 1.4.2` installed (no `Signature.fromBytes`), a genuinely valid signature returned `unverifiable`, and so did every other variant. The result is silently degraded `dns` and `site` levels with no error.
- Assumption: the target project pins `@noble/curves` v2 (where `fromBytes` and the `.js` subpaths exist). I could not run v2 here. This also means I could not test high-s or EIP-155 `v` variants against the real implementation.
- Fix: catch only the recovery failure, or assert the noble version in a startup test.

## Nits / Suggestions
- `parse.ts:26`: duplicate keys use last-wins. Reproduced: `v=other; v=x402payto1; a=…` parses as `ok`. `a=A; a=B` returns B. Strict parsers would reject both. Reject duplicate keys.
- `evaluate.ts:105-106`: `.find` takes the first entry per address, and a DoH answer order that rotates makes `level` flap when the same address is published twice with different signatures. Prefer the strongest valid entry deterministically.
- `doh-txt.ts:84-89`: `normalizeSet` lowercases and strips whitespace, so Solana base58 addresses that differ only by case are treated as agreeing. `txtCanonical` unescapes any `\X`, while the parser's `txtChunks` (`x402-payto-inputs.ts:88-91`) unescapes only `\"`. A decimal escape `\DDD` is handled differently on each side.
- `doh-txt.ts:62-64`: answer `name` is not compared to the queried name (CNAME targets are accepted), `AD` is ignored, and `response.json()` is unbounded. The resolvers are fixed, so this is hardening only.
- `canonical.ts:4-6`: `isEvmAddress` is case-sensitive on the prefix. `0X…` is not lowercased, so a proven `0x…` and a quoted `0X…` compare unequal (false `mismatch`).
- `diff.ts`: `prev.entries` / `cur.entries` missing throws (L104) instead of returning `invalid_report`. `payTo` is not re-normalized, so a checksum-case snapshot from another producer (the watcher builds snapshots without the scanner, `snapshot.ts:1-3`) gives false `DROPPED`. Duplicate identities emit duplicate transitions. `replaced_by`/`replaces` always point at `added[0]`/`dropped[0]` (L206, L230), which misattributes many-to-many rotations. Any `REAPPEARED` add flips every drop to `ROTATED`.
- `payto-dns-fetcher.ts:129`: cache hits hard-code `pslStopped: false` and `queryNames: []`, so `scope: shared_hosting_name` appears only on fresh lookups. `pslStopped` (L75) is `isSharedHostingSuffix(domain)`, which is also true for a three-label tenant whose hit was at the tenant root (`b.vercel.app` for `a.b.vercel.app`), so "own-name record only" is inaccurate there.
- `payto-dns-fetcher.ts:83-87`: the defensive shared-suffix skip is unreachable today because `lookupNameCandidates` never emits a bare suffix. Harmless defence in depth, but it is not what protects you.
- `x402-payto-inputs.ts:163`: the well-known `domain` check uses `dnsResult.domain` in preference to the fetched host (`hostOf(url)`). It diverges from "domain MUST equal serving host" if those ever differ. `hostOf` strips the port, but `lookupNameCandidates("a.example.com:8443")` does not (output: `["a.example.com:8443","example.com:8443"]`), so confirm callers pass a hostname.
- `x402-payto-inputs.ts:281,290` (collector fallback `new Date().toISOString()`) makes `observed_at` impure when no snapshot has `fetchedAt`. AB-188 uses the x402 fetch time and AB-189 uses the l402 fetch time for the same DNS data, so the same proof set carries different `observed_at` values.
- `payto-wellknown-fetcher.ts:33`: `${baseUrl}${PATH}` with a trailing slash or query in `baseUrl` builds a wrong URL. `url` is persisted (L44), so any userinfo in `baseUrl` would be stored. I could not verify that `safeFetch` enforces `maxRedirects: 0`, or whether its content-type check is exact or prefix. If exact, `application/json; charset=UTF-8` and an HTML 404 page both land in the `catch` (L51) as status 0, which reads `unchecked` and not `absent`.
- `mpp-payment-challenge.ts:22`: the `Payment` scheme match is case-sensitive, although auth schemes are case-insensitive. The segment regex has no ambiguous repetition, and I found no ReDoS path.
- `offer-receipt-declared.ts:121-135`: `found` with `extension_declared` counts `offers > 0` from the extractor only. The wording is honest (presence only), but the `found` outcome class can read as stronger than it is.
- The own proof is site-tier only (no DNS TXT is in the attached files), so it carries the weaker level. Publish `_x402-payto.agentbadge.xyz` as well.
- Neither checker passes `staleIssuedDays` to `evaluatePaytoProofs` (`x402-payto-proof.ts:77-87`, `mpp-recipient-proof.ts:64-74`), so the 30-day default always applies. That is correct. Nothing user-reachable sets it.

## Verified-good
- **Own proof**: `public/.well-known/x402-payto.json` recovers to its declared address `0x23dd…51b3` for `Domain: agentbadge.xyz`, `Issued: 2026-11-22`, using the canonical message and EIP-191 hashing (checked independently).
- **DoH status handling**: `Status 0` with no TXT, and NXDOMAIN, are the only `absent` paths. SERVFAIL, REFUSED, non-OK HTTP and timeouts return `null`, so they become `unchecked`. Queries carry only `name=` and `type=TXT` (`doh-txt.ts:51`).
- **Parent walk**: an `unchecked` lookup stops the walk and returns `unchecked`, so a parent is never consulted past a failed child (`payto-dns-fetcher.ts:98-101`). `unchecked` is never cached (L174). Sibling names are never queried (`psl.ts:56`).
- **Cache vs mismatch**: a cache hit sets `fromCache: true`, `liveRecheckDone` is false, and `evaluate` returns `unchecked` plus `no_live_recheck` instead of `mismatch` (`evaluate.ts:187-195`). A stale positive can produce `verified` but not a false `mismatch`.
- **Signature binding**: the message commits to lowercase domain, lowercase address and issued date, so cross-domain replay is impossible. ERC-6492 and non-65-byte signatures are `unverifiable`. `levelFor` raises the level only on `valid`, so `unverifiable` cannot inflate it. The signature is reported alongside the outcome, never merged.
- **Manifest handling**: a manifest observation can confirm but never mismatch. A manifest-only result gives aggregate `unchecked` and verdict `not_applicable`. The collector dedupes by `payTo`, so a manifest row cannot share a key with a live row today (`x402-payto-inputs.ts:276`). Note: `evaluate.ts:200-204` would count such a row as live for another caller (latent).
- **Precedence**: `conflicts.length > 0` short-circuits to `conflict` ahead of `partial` (`payto-proof-verdict.ts:75`). That is the right order, because a mismatch must always surface.
- **Freshness**: `issued_age_days` is never negative (future gives `null`). `stale_issued` never changes an outcome. Without a clock the result is `not_computed`, never "fresh". `staleIssuedDays` is not reachable from untrusted input.
- **Probe failure**: second-probe failure and missing attempts become `skipReasons`, never `mismatch`, in both collectors (`x402-payto-inputs.ts:260-269`, `mpp-recipient-inputs.ts:101-109`).
- **Diff gate**: it enforces same domain, same schema version and strictly increasing `observed_at` (NaN also fails). Unconfirmed absence in the DNS-`unchecked` case becomes `recheck_unchecked` with severity `none`. Same `payTo` under a new scope is `SCOPE_CHANGED`, not drop plus add.
- **Network hygiene**: well-known fetch uses `maxRedirects: 0`, a 64 KiB cap and a JSON content-type allowlist (enforcement inside `safeFetch` not verified). Fetch errors are swallowed with no URL or body echoed (`payto-wellknown-fetcher.ts:51`). The MPP header regex is linear.
- **Purity**: the lib does no IO and takes time from the caller.
