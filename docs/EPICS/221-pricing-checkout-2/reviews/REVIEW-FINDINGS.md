# Review Findings — commerce-checkout (EPIC-221)

## Scope
Reviewed: `payments-api/{checkout,attempt,api-schemas,usdc-provider,webhook-dispatch,fulfillment,index,errors}.ts`, `commerce-catalog/index.ts`, `routes/{payments-api,commerce-catalog,checkout-pages,payment}.ts`, `lib/contract-guards.ts`, `views/checkout-page.ts`, `public/js/checkout.js`. NOT provided, so conclusions that depend on them are marked "unverified": `payments-api/money.ts` (`multiplyUsdDecimal`), `@agentbadge/payments` (`PaymentService.confirmPayment`, stores, `StripePaymentProvider`), `order-fulfillment.ts`, `event-ledger.ts`, `error-response.ts`, `views/layout.ts`, `views/payment-success.ts`. Selected claims were reproduced in a sandbox (hono 4.13, zod 3.25, qrcode 1.5.4).

## Verdict
**BLOCK.** The fulfillment layer marks a payment as fulfilled before the handler succeeds and keeps its only exactly-once guarantee in process memory, so a paid order can be silently lost or minted twice. A reflected XSS on the checkout origin lets an attacker swap the displayed USDC recipient. Several trust-model claims (idempotent fingerprint, "client cannot choose network/recipient", "no paid-but-unfulfillable state") hold only for the happy path. The money-path core (server-side price, schema-before-row, raw-body signature check) is sound and is a good base once these are fixed.

## Critical

### C-1. Fulfillment is marked done BEFORE the handler runs, so one handler failure permanently loses a paid order
- `fulfillment.ts:80-81`: `if (key) fulfilledRefs.add(key); await handler(input);`
- `webhook-dispatch.ts:76`: the boolean result of `dispatchFulfillment` is ignored. `payment.ts:201-227`: failure returns 500, Stripe retries.
- Exploit / failure scenario: the passport-mint handler throws (Hedera node timeout, bad `accountId`, insufficient treasury gas). The key `payment:<id>` is already in `fulfilledRefs`. Stripe retries the webhook, `confirm` returns CONFIRMED (or a non-CONFIRMED early return at `webhook-dispatch.ts:63`), and `dispatchFulfillment` returns `false` at line 70 without running anything. The retry gets 200, the customer has paid, no NFT is minted, and no alert fires. This is exactly the "paid but unfulfillable" state that D-221-8 claims to eliminate. An attacker who can make the handler fail (for example an `accountId` that passes the schema but is not a real account, see H-5) can also cause targeted denial of fulfillment.
- Fix: add the key only after the handler resolves (or remove it in a `catch`), and persist the fulfilled marker transactionally with the receipt. Treat a `false` return as an error that is logged and alerted.

### C-2. "Exactly-once" is process-local: restart, deploy or a second instance double-fulfills
- `fulfillment.ts:33-34` (module-level `Map` / `Set`), `fulfillment.ts:70`; `payment.ts:29` (`new EventLedger()` with no injected store); `webhook-dispatch.ts:63-67` (proceeds to fulfillment on ANY `outcome.status === "CONFIRMED"`, it cannot tell "newly confirmed" from "already confirmed").
- Exploit / failure scenario: Stripe re-delivers `checkout.session.completed` (it does this routinely on timeout or 5xx) to a different instance, or after a restart. The in-memory ledger and `fulfilledRefs` are empty. If `confirmPayment` is idempotent and returns `CONFIRMED` for an already-confirmed payment (the stores' `applyStatus(expectedFrom)` guard only protects the status transition, not this branch), the handler runs again: a second passport NFT is minted or a second listing activation and notification occurs for one payment. The same happens for a second paid Stripe attempt on one payment (see H-7). The `applyStatus` guard cannot protect the handler because dispatch never learns whether this call performed the transition.
- Fix: have `confirmPayment` return an explicit `transitioned: true/false` and dispatch only when true, or store a durable `fulfillment` row with a unique key on `paymentId` inserted in the same transaction as the receipt. Back the event ledger with the database.

### C-3. Reflected XSS on the payment origin, `GET /checkout?product=`
- `checkout-pages.ts:71` (`rawCode = c.req.query("product")?.trim()`), `checkout-pages.ts:79` (`The product "${rawCode || "?"}" ...` interpolated into a plain string, passed through `simplePage` to `Layout` as raw HTML, and returned with `c.html`). `Layout` receives body HTML as a string everywhere in this surface (`checkout-page.ts:166-168` passes `content.toString()`), so it cannot be escaping it.
- Exploit: `https://agentbadge.xyz/checkout?product=<script>…</script>` returns a 404 whose body still executes in the `agentbadge.xyz` origin. The script can rewrite `#checkout-instructions` after the legitimate flow renders, swapping the displayed USDC recipient and QR for an attacker address, or can submit payments with attacker metadata. No CSP is set on these routes. Only `rawCode` on the 404 branch is reflected; everything on the happy path goes through the `html` tag (escaped).
- Fix: `escapeHtml(rawCode)` or render the not-found page through the `html` tag, and add a CSP (`default-src 'self'; script-src 'self'`) to checkout routes.

## High

### H-1. Webhook trusts `session.metadata.paymentId` with no binding to the session that was issued for that payment, and the legacy endpoint lets clients set it
- `webhook-dispatch.ts:53-62`: `paymentId` comes straight from session metadata and `confirm({ paymentId, actor: "stripe-webhook" })` is called. `session.id`, `payment_status`, `amount_total` (declared at line 30 but never used), and currency are never compared with the payment's attempt (`providerReference`) or amount.
- `payment.ts:158-163`: the deprecated-but-live `POST /api/payment/checkout` builds `metadata: { ...product.metadata, ...metadata, productId }` where `metadata` is the client body. A client can therefore create a legitimately paid $9.99 legacy session carrying `metadata.paymentId = <id of a $499.99 PASSPORT_PLATINUM payment the attacker created via the new API>`. The webhook routes it to the confirm path instead of the legacy path.
- Impact depends on unseen `PaymentService.confirmPayment`. If it re-verifies by retrieving the Stripe session stored on that payment's own attempt, this degrades to a harmless no-op (and a lost $9.99 for the attacker). If it trusts the `stripe-webhook` actor, or verifies only that "some" paid session exists, this is a forged-payment bypass: pay the cheapest legacy price, receive Platinum. Escalate to Critical until that code is read.
- Also: `checkout.session.completed` fires for `payment_status: "unpaid"` async methods, and `checkout.session.async_payment_succeeded` / `_failed` are not handled (`payment.ts:198-231`).
- Fix: in dispatch, assert `session.payment_status === "paid"`, `session.id === attempt.providerReference` for an attempt of that payment, and `amount_total`/currency equal to the payment amount. Drop client `metadata` from the legacy endpoint (or whitelist keys and forbid `paymentId`).

### H-2. Legacy checkout lets clients override server metadata (tier / any key) on a paid session
- `payment.ts:158-162`: only `productId` is protected from the spread. Any key in `product.metadata` (for example a `tier`) can be overwritten by the request body, while the price is charged from `product.amountCents`.
- Scenario: pay for `passport-bronze`, send `metadata: { tier: "platinum", accountId: "<mine>" }`. Whether this yields a Platinum mint depends on whether `fulfillOrder` (unseen) reads tier from metadata rather than from `productId`. Same fix as H-1. Note this route is still active and is the same webhook target as the new flow.

### H-3. Idempotency-Key has no request fingerprint check, accepts empty/unbounded keys, and is globally shared across callers
- `checkout.ts:172-180`: a duplicate returns the existing payment for the same key or `chk_<key>` reference without comparing product, quantity, metadata, `customerId` or `agentId`. `checkoutFingerprint` (lines 81-97) is computed and stored (line 207) but never compared.
- `payments-api.ts:118`: `c.req.header("Idempotency-Key") ?? undefined` bypasses `idempotencyKeySchema`/`readIdempotencyKey` from `contract-guards.ts:25-52`. An empty header value yields `""`, which passes `!= null` (`checkout.ts:174`), so `reference = "chk_"` for every such caller (reproduced).
- Exploit 1 (squatting): attacker creates a payment with key `K` for PASSPORT_BRONZE with attacker `accountId`. A victim client that derives keys predictably (order number, timestamp, empty header from a bad template) calls with `K` for any product and receives the attacker's payment (201, `deduped: true`). The victim pays and the passport mints to the attacker's account. The UI path (`checkout.js:195-202`) sends no key and is not affected; API/agent clients are.
- Exploit 2: the response leaks another caller's payment id, which is the only capability protecting the unauthenticated `GET /api/v1/payments/:id` and `/receipt`.
- Fix: scope the key to the caller (or hash it with a server secret), enforce length and charset via `idempotencyKeySchema`, and return 409/422 when the stored fingerprint differs.

### H-4. `network` is used as a raw object key: prototype keys pass the "configured network" check
- `attempt.ts:131-137`: `const cfg = network ? deps.usdcNetworks[network] : undefined; if (!cfg || !network) …`. `usdc-provider.ts:43`: `this.networks[input.network ?? ""]`. Reproduced: `nets["__proto__"]`, `nets["constructor"]`, `nets["toString"]` are all truthy on a plain object, and `.recipient` is `undefined`.
- Scenario: `POST /api/v1/payments/:id/attempts {"provider":"DIRECT_USDC","network":"__proto__"}` succeeds. The attempt is persisted with `network:"__proto__"`, `payload.expectedRecipient: null` (`attempt.ts:174-178`), the payment moves to PROCESSING, and the response contains instructions with no recipient or token (JSON drops `undefined`). Recipient and token still cannot be chosen by the client, but the "bind expectations at create (H-4)" invariant is violated: any future verifier that treats a null `expectedRecipient` as "don't check recipient" would accept a transfer to any address as payment. (Applies if `cfg.usdcNetworks` is a normal object; unseen.)
- Fix: `Object.hasOwn(deps.usdcNetworks, network)` (or a `Map` / null-prototype object), and validate `network` against `^(eip155|solana):…$` in `createAttemptSchema`.

### H-5. Metadata schema is a presence/type check only: undeclared keys flow into fulfillment, and no value format is validated
- `commerce-catalog/index.ts:278`: `if (!expected) continue; // undeclared keys pass through`. `checkout.ts:206-211` stores the whole object and `checkout.ts:284-287` hands it to the handler as `metadata` (not stripped, contrary to the stated model). A payer can add `tier`, `recipient`, `price`, `productCode`, `paymentRef`, and so on; any handler that reads a key not in its schema becomes attacker-controlled.
- `commerce-catalog/index.ts:73-80` and `:271-283`: `accountId` is only "non-empty string" server-side (the `pattern` at `checkout-page.ts:59` is client-side, and the form is `novalidate` at line 128). `endpoint` and `imageUrl` accept `javascript:`/`data:`/internal URLs; `listingId` is not checked for existence or ownership; `capabilities: []` and whitespace-only strings pass (`:271-274`, `:281-282`).
- Scenario: pay for a Gold passport with `accountId: "x"` or a nonexistent account; the mint fails after the money is taken (see C-1). Or store `imageUrl: "javascript:…"` / an SSRF target that later gets rendered or fetched by the directory and mint pipeline.
- Fix: build the fulfillment `metadata` only from declared fields (pick, do not pass through), add per-field validators (`/^\d+\.\d+\.\d+$/`, https-only URLs, max lengths and array sizes, non-empty arrays), and reject unknown keys with `.strict()`-style semantics.

### H-6. Paid-but-not-fulfilled outcomes return 200 and are silent
- `webhook-dispatch.ts:63-65`: any non-CONFIRMED outcome returns normally, so Stripe sees success and never retries. This covers a late payment on a FAILED/EXPIRED payment, a verification mismatch, and a paid sibling attempt.
- `webhook-dispatch.ts:67-80`: `getFulfillmentInput` returning `null` is skipped silently; `dispatchFulfillment` returning `false` (no handler, `fulfillment.ts:77-78`) is ignored. `checkout.ts:282` falls back to productCode `"unknown"`.
- Impact: customer money captured with no refund path, no log line, no alert.
- Fix: log and alert on every non-fulfilling branch; return 5xx for a missing handler or input so Stripe retries; auto-flag or refund captured payments on terminal payments.

### H-7. Concurrent or repeated attempts create multiple payable Stripe sessions for one payment; no sibling cancellation, no refund
- `attempt.ts:63` (`PROCESSING` stays payable), `:82-103` (read-then-check, no lock or compare-and-set), `:163` (a new attempt row every call), `:186` (a new rail session every call). `POST …/attempts` has no idempotency at all (`payments-api.ts:167-222`).
- Scenario: double-click, two tabs or an agent retry yields two live Checkout Sessions. Both can be paid. The second webhook has a different `event.id`/`session.id`, so `withIdempotency` does not dedupe it; `confirm` then reports the payment as already confirmed, fulfillment is deduped (best case), and the customer is charged twice with nothing detecting or refunding it.
- Fix: one open attempt per payment per provider (return the existing one), cancel/expire sibling Stripe sessions when one is created or paid, and reconcile surplus captures to refund.

### H-8. A DIRECT_USDC rail that can never confirm is wired into production
- `usdc-provider.ts:70-72` (`verifyPayment` always `PENDING`), `index.ts:126-131` (registered whenever any `usdcNetworks` entry exists), `checkout.js:89-100` (UI says "Send USDC to complete payment" and polls 10 minutes).
- Impact: with a real mainnet treasury configured, buyers send real USDC that is never matched, fulfilled or refunded. Funds sit in the treasury with no automated link to the payment.
- Fix: gate the stub behind an explicit flag that is refused in production config, or restrict it to testnet networks until the verifier exists.

### H-9. USDC "reference/memo" cannot disambiguate EVM payments, so one transfer can settle multiple payments once a verifier exists
- `checkout.js:86` (QR encodes only `inst.recipient`), `checkout.js:99` ("include the reference in your transfer memo"), `usdc-provider.ts:47-50,55-64` (reference = `paymentId`; amount = catalog price). ERC-20 `transfer` has no memo field, and two buyers of the same product have identical `recipient + token + amount`.
- Scenario: two pending payments of the same product; one buyer's transfer matches both on amount and recipient, so a matcher that accepts the first hit confirms both, or the second buyer is unfulfilled. Also, `providerReference` uses `chk_<idemKey>` (`usdc-provider.ts:52`) while the shown reference is `pay_<id>`: two identifiers for one binding.
- Fix: bind a unique amount suffix or a per-payment deposit address, and require a unique constraint on the matched `transactionHash`. Have the verifier use a single canonical reference.

## Medium

- **M-1. Partial writes after a successful rail call are masked.** `attempt.ts:212-230`: `applyAttemptTransition(... "PENDING")` failing throws after Stripe session creation, leaving an orphaned live session with an attempt stuck in CREATED and no `providerReference`. A `null` return (lost race) is swallowed by `?? attemptRow` so the response goes out while `providerReference`/`transactionHash` were never saved, which breaks later verification. Also `attempt.ts:163-179` writes the attempt before the rail call, so a crash between them leaves an orphan CREATED row. Make transitions throw on null and add a reaper.
- **M-2. `/checkout/qr.svg` hardening.** `checkout-pages.ts:108-112`: no try/catch around `qrToString`; reproduced that a 1,000-character CJK string already throws "amount of data is too big", giving an unhandled 500, because the limit is in UTF-16 chars, not bytes. It is an unauthenticated open QR generator on the trusted domain (usable to host phishing QR codes bearing agentbadge.xyz), with no rate limit. Output SVG contains only numeric path data, so no markup injection (verified). Add a byte limit, try/catch to 400, and `X-Content-Type-Options: nosniff`.
- **M-3. QR payload lacks amount, token and chain.** `checkout.js:86` encodes only the recipient address. A wallet scan permits any amount or asset on any chain. Use an EIP-681 URI (`ethereum:<token>@<chainId>/transfer?address=…&uint256=…`) or Solana Pay.
- **M-4. Information disclosure in errors and reads.** `attempt.ts:201-209` returns `err.message` from the Stripe/rail call to the client in the 502 body. Stripe error text can include masked key fragments and request ids; `payment.ts:168` does the same for legacy checkout, and `payment.ts:194-195` echoes the signature failure reason. `payments-api.ts:256-259,287` returns raw `Payment`, attempt and receipt objects (can include `customerId`, `agentId`, metadata, `providerReference`, Stripe URLs, emails) to anyone holding the payment id, unlike the POST routes which project fields. Return generic messages and project explicit response fields.
- **M-5. `quantity` is meaningless for these products yet is billed.** `checkout.ts:154-170` allows 1..1000, `checkout.ts:278-290` drops `quantity` from the fulfillment input. A buyer (or a bug in an agent) pays 1,000 times the price for one passport or one listing. Fix `quantity` to 1 for `passport-mint` and `directory-listing`.
- **M-6. No expiry, no rate limiting, no size caps on an unauthenticated write path.** `checkout.ts:203` stores `expiresAtMs: null` so PENDING rows never expire. `createPaymentSchema` (`api-schemas.ts:7-13`) has no max lengths on `productCode`, `customerId`, `agentId`, and `metadata` is an unbounded `record(unknown)` (nested extra keys, huge arrays). Each attempt makes a live Stripe API call. Add per-IP limits, body-size and field caps, and a TTL.
- **M-7. Legacy success page reflects the session id.** `payment.ts:239-252`: `sessionId` from the query goes into `renderPaymentError(...)` text and is passed to `stripe.checkout.sessions.retrieve` unvalidated, rendering session details for any id. If `renderPaymentError` does not escape (unseen), this is another reflected XSS. Validate `^cs_(test|live)_[A-Za-z0-9]+$` and escape.
- **M-8. Fulfillment text fields are attacker-controlled free text.** `name`, `endpoint`, `skills`, `capabilities` reach the handler and `notifier` (Discord). Escape mentions and markdown, and cap lengths.

## Nits / Suggestions

- `checkout-page.ts:123`: `${hbar ? \`<p …>\` : ""}` is a plain string interpolated into the hono `html` tag, so it is HTML-escaped. Reproduced: the page prints the literal text `<p class="text-xs …">22.5 HBAR equivalent</p>`. Wrap in `raw()` or use a nested `html` fragment.
- `commerce-catalog/index.ts:60`: `(tb / TINYBAR_PER_HBAR).toString()` is float division and can emit artifacts or exponent notation, against the stated D-220 money rule. Use bigint decimal formatting.
- `createPaymentSchema` (`api-schemas.ts:7`) is not `.strict()`, so a client-sent `amount` or `currency` is silently ignored instead of rejected like the rail fields.
- `createAttemptSchema` uses `z.never().optional()` redundantly with the manual loop at `payments-api.ts:173`; the `.strict()` already rejects them. Consolidate to avoid error-shape drift (both give different codes).
- `validateProductMetadata` (`commerce-catalog/index.ts:276-281`) does `fieldTypes[field]` on a plain object, so keys like `constructor`/`__proto__` look "declared" (reproduced). They then fail the type check, which is only a self-inflicted 400, but use `Object.hasOwn`.
- `webhook-dispatch.ts:70-74`: `input.email = input.buyerRef` can be a `customerId`/`agentId` rather than an email.
- `fulfillment.ts:72-77`: documented "legacy productId" resolution does not work, because `getCommerceProduct("passport-bronze")` is undefined (needs `productCodeForLegacyId`). `kind` silently falls back to `productCode`.
- `checkout.js:148`: `status.toLowerCase()` throws if `body.payment` is missing; the error is swallowed by the `.catch` so polling continues silently.
- `checkout-pages.ts:109-111`: the qr 400 uses `{ error }` instead of `errorResponse`. `/checkout/success` claims "payment was received" for anyone who loads the URL, without verifying.
- `legacyEndpointDeprecation` (`contract-guards.ts:181-189`) stages headers with `c.header()` before `next()`. Hono merges these only into responses built via `c.json/c.html/c.body`; a handler or `onError` returning a bare `new Response(...)` would drop them. Setting them after `await next()` on `c.res` (as `legacyWriteDeprecation` does) is more robust. Unverified for `errorResponse`.
- `Sunset: Thu, 31 Dec 2026` is about seven weeks away, while `POST /api/payment/checkout` still creates paid sessions (see H-1/H-2).
- `defaultId` falls back to `Date.now()` + `Math.random()` (`checkout.ts:73-77`), which is guessable; payment ids are the only read capability, so fail hard if `crypto.randomUUID` is missing.
- Redact the webhook `lastError` and `captureError` payloads, which may contain buyer emails.

## Verified-good

- **Amount is server-derived only.** `checkout.ts:162-170` takes price from the catalog (`USD && active`), multiplies by a validated integer quantity, and the attempt copies `paymentRow.amount` (`attempt.ts:169,187`). There is no client path to amount, currency or unit price. (`multiplyUsdDecimal` itself was not provided.)
- **Schema validation precedes the PENDING row** (`checkout.ts:145-153` before `:190`), and type confusion between `string` and `string[]` is rejected for declared fields (`catalog:279-282`); `metadata: null`/arrays are rejected by zod. Zod's `record` drops `__proto__` keys (reproduced), so no prototype pollution via metadata.
- **Product resolution is exact.** `createPayment` requires the canonical code and an `active` product; legacy kebab ids are only accepted on the page route, which sends the canonical code to the API.
- **Recipient and token never come from the client.** `createAttemptSchema` is `.strict()`, a route-level loop rejects `recipient`/`tokenContract`/`token`, and values are copied only from the server config map (`attempt.ts:146-147`), then bound into the attempt payload (`:174-178`). Apart from H-4's prototype-key hole, this invariant holds.
- **Rail clamp:** a rail can never confirm at create (`attempt.ts:233-234`), provider resolution precedes any row write (`:105-114`), and attempt-on-terminal-payment returns 409 after lazy expiry (`:90-103`).
- **Webhook signature path is correct.** The raw body is read before parsing (`payment.ts:187`), `constructEventAsync` is used with the configured secret, the missing-header, missing-secret and unconfigured cases fail closed, and Stripe's default 5-minute timestamp tolerance applies. Only the expected event type is acted on.
- **In-process race safety of the dedupe set.** The `has` check and `add` at `fulfillment.ts:70,80` have no `await` between them, so concurrent deliveries in one process cannot both pass (the problem is persistence and ordering, C-1/C-2).
- **Insert race handled.** A lost unique-insert is resolved by re-reading the winner (`checkout.ts:213-219`) instead of failing or double-creating.
- **Client rendering is escaped.** Every dynamic field in `renderInstructions`, `renderReceipt` and `renderStatus` goes through `escapeHtml`; the QR `src` uses `encodeURIComponent` inside a double-quoted attribute; `paymentId` for polling comes from the server response, never from the URL. Server views use the hono `html` tag, which escapes interpolations, and the remaining `raw()` content is built from catalog and config constants.
- **QR SVG cannot carry markup.** The output has only a numeric path (tested with a `"><script>` payload) and `Cache-Control: private` avoids shared-cache poisoning.
- **Deprecation coverage is correct.** `use("/api/payment/*")` and `use("/payment/*")` apply to all methods, and do not match `/api/v1/payments*`, `/checkout*` or `/api/stripe/webhook`, so the webhook is not deprecated. The Sunset date is a valid HTTP-date and a Thursday.
- **Failure design is explicit.** A rail failure fails the attempt and leaves the payment retryable, and the reasons are truncated to 200 chars.
- **Catalog routes are read-only** and compute from constants; unknown codes return 404.

---

## Triage (in-house verification, 2026-11-12)

Each Studio claim was re-checked against the source. Status: **CONFIRMED** =
reproduced in code, **PARTIAL** = real but narrower than stated,
**ACCEPTED-UNVERIFIED** = depends on unseen code.

### Critical — confirmed, fix in 221-7

- **C-1 CONFIRMED** — `fulfillment.ts:80` `fulfilledRefs.add(key)` runs BEFORE
  `await handler(input)`; throw → dedupe key retained → retry returns false →
  paid-but-unfulfilled, silent. Verified line-by-line.
- **C-2 CONFIRMED** — `fulfilledRefs`/`EventLedger` are module-level in-process;
  restart or second instance loses the dedupe set → Stripe re-delivery
  re-runs the handler (double mint). `webhook-dispatch.ts:63` dispatches on
  any CONFIRMED outcome without knowing "newly confirmed".
- **C-3 CONFIRMED** — `checkout-pages.ts:79` interpolates `rawCode` into a raw
  string passed to `simplePage`/`c.html`; `/checkout?product=<script>` reflects.
  Verified — the 404 branch is the only unescaped interpolation.

### High — confirmed, fix in 221-7

- **H-1 CONFIRMED (surface) / CONFIRM severity pending PaymentService** —
  `webhook-dispatch.ts:53` uses `session.metadata.paymentId` with no
  `session.id`↔`attempt.providerReference`, `payment_status`, or amount check;
  `payment.ts:158-163` legacy spread lets a client set `metadata.paymentId`.
  Exploit severity depends on `PaymentService.confirmPayment` internals
  (packages/payments — outside this diff; marked for 221-7 verification).
- **H-2 CONFIRMED** — legacy spread `...metadata` after `...product.metadata`
  lets clients override tier/any key except `productId`.
- **H-3 CONFIRMED** — `payments-api.ts:118` reads `Idempotency-Key` raw
  (bypasses `idempotencyKeySchema`); `checkout.ts` dedupes on key without
  comparing `checkoutFingerprint`; `""` → `reference = "chk_"` shared key.
- **H-4 CONFIRMED** — `attempt.ts:131` `deps.usdcNetworks[network]` on a plain
  object passes `__proto__`/`constructor`/`toString` (cfg=undefined →
  recipient null, expectedRecipient null bound into attempt payload).
- **H-5 CONFIRMED** — `validateProductMetadata` passes undeclared keys through
  to the stored payload/fulfillment input; `fieldTypes[field]` on a plain
  object treats `__proto__`-family keys as declared (self-400 only);
  no per-field format/length validation (accountId non-empty string,
  javascript:/data: endpoints, unbounded sizes).
- **H-6 CONFIRMED** — `webhook-dispatch.ts:63-80`: non-CONFIRMED outcome →
  normal return (200 to Stripe, no retry); null input / false dispatch →
  silent skip, no log/alert.
- **H-7 CONFIRMED** — `attempts` POST has no idempotency; concurrent calls
  create multiple payable Stripe sessions; no sibling cancel/refund.
- **H-8 CONFIRMED** — `DirectUsdcStubProvider.verifyPayment` always returns
  PENDING; registered whenever `usdcNetworks` configured → mainnet USDC
  would never be matched/fulfilled.
- **H-9 CONFIRMED** — USDC `reference = paymentId` with identical
  `recipient+token+amount` across payments; ERC-20 transfer has no memo;
  `providerReference` (`chk_<idemKey>`) ≠ shown reference (`pay_<id>`).

### Medium — confirmed (fix or accept in 221-7)

- M-1..M-8 stand as reported; notable: `checkout-page.ts:123` literal
  `<p>` interpolation bug (visual, reproduces); `/checkout/qr.svg` 400
  uses `{error}` not `errorResponse`; `/checkout/success` claims "payment
  received" with no verification; metadata/payload fields unbounded.

### Nits
- Stand as reported (see file). `Sunset` ~7 weeks out while legacy checkout
  still creates paid sessions — review date vs removal timeline.

### For SLICE-221-7 fix list
1. C-1: persist fulfilled marker after handler (transactional w/ receipt);
   false dispatch → error + alert.
2. C-2: durable fulfillment/ledger dedupe (DB-backed) or dispatch only on
   `transitioned: true` from confirmPayment.
3. C-3: escape `rawCode` (or `html` tag) on 404; CSP on checkout routes.
4. H-1: verify `PaymentService.confirmPayment` binding; assert
   `session.payment_status==="paid"`, `session.id`↔providerReference,
   amount/currency match; whitelist legacy metadata keys (ban `paymentId`).
5. H-2: same metadata whitelist on legacy endpoint.
6. H-3: use `idempotencyKeySchema`/`readIdempotencyKey`; compare
   `checkoutFingerprint` on dedupe → 409 on mismatch; empty key → no dedupe.
7. H-4: `Object.hasOwn` / Map for network lookup; validate CAIP-2 shape.
8. H-5: pick declared fields only into fulfillment metadata; per-field
   validators (accountId format, https-only URLs, caps); reject unknown keys.
9. H-6: log+alert non-fulfilling branches; 5xx on missing handler/input so
   Stripe retries.
10. H-7: idempotent attempts (return existing open attempt); expire sibling
    Stripe sessions; reconciliation for surplus captures.
11. H-8: gate stub USDC provider behind explicit non-prod flag/testnet.
12. H-9: per-payment unique amount suffix or deposit address; unique
    txHash constraint; single canonical reference.

---

## Fix status (SLICE-221-7, 2026-11-12)

All Critical and High findings fixed in `hackathon/server`; regression tests
in `hackathon/server/tests/checkout-audit-221-7.test.ts` (17 tests, all green)
plus updated `payments-api`/`payments-webhook-fulfillment`/
`payment-fulfillment`/`checkout-ui`/`payments-deprecation` suites
(77 tests green across all payment/checkout files).

### Critical — FIXED

- **C-1 FIXED** — `fulfillment.ts`: `fulfilledRefs.add(key)` now runs AFTER
  `await handler(input)`; handler errors propagate (caller retry path =
  event-ledger release). Statuses `"fulfilled" | "deduped" | "no-handler"`;
  `no-handler` is surfaced as an error upstream. Test: "handler throws →
  same dedupeKey retries (not swallowed)".
- **C-2 FIXED** — `fulfillment.ts`: optional `events` store gives durable
  claim/done markers (`fulfill-claim-<payId>` / `fulfill-done-<payId>`) for
  `payment:<id>` dedupe keys; deterministic ids make the claim atomic
  cross-instance. `claimed`-without-`done` is retryable only when stale
  (> `CLAIM_STALE_MS = 10 min`); failure writes a `failed` marker.
  Wired in `webhook-dispatch.ts` (`deps.stores.events`). Tests:
  "writes claim + done; fresh dispatch sees done", "failed marker — retry
  proceeds".
- **C-3 FIXED** — `checkout-pages.ts` 404 escapes `rawCode` via escapeHtml.
  Test: "/checkout 404 escapes".

### High — FIXED

- **H-1/H-2 FIXED** — `webhook-dispatch.ts`: with `stores` present the
  session binds by `session.id === attempt.providerReference` (unbound →
  error, no confirm); `payment_status !== "paid"` → error;
  `amount_total` vs `usdToCentsInt(attempt.amount)` → DISPUTED error.
  `confirm` is called with `{provider, providerReference}`, not the raw
  client `paymentId`. `payment.ts` legacy route whitelists client metadata
  (reserved keys stripped: paymentId/productId/productCode/tier); server
  values spread last. `machine-entry.ts` added `idempotencyKeySchema`.
  Tests: "session.id resolves the attempt", "unbound → error",
  "amount_total mismatch", "payment_status ≠ paid".
- **H-3 FIXED** — `payments-api.ts` validates `Idempotency-Key` via
  `idempotencyKeySchema` (malformed → 400); `checkout.ts` compares the
  stored `checkoutFingerprint` on dedupe hits (replay + lost-race) →
  409 `idempotency_conflict` (`errors.ts` + `error-codes.ts`). Tests:
  "same key + different fields → 409", "malformed → 400".
- **H-4 FIXED** — `attempt.ts` + `usdc-provider.ts` use `Object.hasOwn` for
  network lookup; `api-schemas.ts` validates network shape
  (`^[a-zA-Z0-9][a-zA-Z0-9:_-]{0,63}$`, supports eip155 + solana CAIP-2).
  Tests: "__proto__ / constructor → 400".
- **H-5 FIXED** — `commerce-catalog/index.ts`: `validateProductMetadata`
  rejects undeclared keys (`Object.hasOwn` on declared field types),
  per-field validators (accountId format, https-only URLs, caps, array
  limits); `sanitizeProductMetadata` projects only declared fields into the
  stored payload; `checkout.ts` injects the server-side `tier` from
  `CommerceProduct` into `getFulfillmentInput` (client can no longer pick
  a tier). Tests: "undeclared keys → 400", "malformed accountId → 400".
- **H-6 FIXED** — `webhook-dispatch.ts`: non-CONFIRMED retryable outcomes
  and missing fulfillment input / `no-handler` dispatch set `result.error`
  → `payment.ts` webhook throws → 5xx → Stripe retries. Non-retryable
  outcomes log+alert. Tests: "unbound/amount/status → error" + existing
  webhook suite.
- **H-7 FIXED** — `attempt.ts`: `submitAttempt` returns an existing
  `PENDING` attempt matching provider (+network for USDC) instead of
  minting a second payable session; a lost `CREATED→PENDING` race marks
  the attempt FAILED and errors (no orphan rail). Test: "second USDC
  attempt reuses the open attempt".
- **H-8 FIXED** — `payments-api/index.ts` already registers the
  `DirectUsdcStubProvider` only when `cfg.usdcSelfServeEnabled` (verified);
  stub is for testnet/self-serve only.
- **H-9 FIXED** — `money.ts` `addUsdcMicroSuffix(amount, paymentId)` gives
  each USDC attempt a deterministic payment-unique micro-unit suffix;
  `attempt.ts` persists the suffixed amount and passes it to the provider;
  `usdc-provider.ts` sets `providerReference = usdc_<net>_<paymentId>` and
  `paymentInstructions.reference = paymentId` (single canonical reference).
  Tests: "unique micro suffix; providerReference binds paymentId",
  "second payment → different providerReference".

### Medium — FIXED / accepted

- **M-1 FIXED** — `checkout-page.ts` uses the `html` helper for the HBAR
  equivalent block (no literal `<p>` interpolation).
- **M-2 FIXED** — `checkout-pages.ts` `/checkout/qr.svg`: UTF-8 byte cap
  (512), QR renderer errors caught → 400 `errorResponse`,
  `X-Content-Type-Options: nosniff`. Test: "qr.svg rejects >512-byte".
- **M-3 FIXED** — `checkout.js` QR content builds real EIP-681 /
  Solana Pay payment URIs (recipient+token+amount in micro-units,
  decimal-string conversion, no float).
- **M-4 FIXED** — `payments-api.ts` GET `/payments/:id` projects public
  payment fields only; receipt endpoint projects without raw
  `verificationData` (`verifiedAtMs` → ISO `verifiedAt`).
- **M-5 FIXED** — `api-schemas.ts` `quantity` restricted to `1`
  (single-entitlement checkout); `checkout.ts` enforces. Test:
  "quantity > 1 → 400".
- **M-6 FIXED** — `checkout.ts` sets `PAYMENT_TTL_MS = 24h` expiry on
  payments; `defaultId` throws without `crypto.randomUUID` (no
  Math.random fallback).
- **M-7 FIXED** — `payment.ts` `/payment/success` validates the session id
  (`^cs_(test|live)_[A-Za-z0-9]+$`); Stripe error details logged not
  returned; `payment-success.ts` escapes session/error fields.
- **M-8 FIXED** — `order-fulfillment.ts` sanitizes Discord notification
  fields (newline strip, mention/markdown chars removed, length cap).

### Nits — status

- `checkout.js` status guard added (`payment.status` non-string →
  PROCESSING fallback). `checkout.js` QR + status fixed.
- `Sunset` date on legacy checkout: **accepted** — still ~7 weeks out;
  sunset header already shipped (SLICE-221-5). Revisit at removal time.
