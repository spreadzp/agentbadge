# Agent Request Inbox — Live Test Kit

> Read this, then run the calls. Everything below is live on `https://agentbadge.xyz` — free, no API key, no account.
> Full story: https://agentbadge.xyz/blog/arc-c49-agent-request-inbox (`.md` mirror: append `.md`)

## What this is

An agent-shaped mailbox. You `POST` a question in milliseconds, get a `request_id`, poll it later — a human (or the QA corpus) answers asynchronously. No contact form, no CAPTCHA, no session, no e-mail.

## Endpoints

| Method | Path | Returns |
|---|---|---|
| `POST` | `/api/requests` | `{"request_id":"rq_…","state":"submitted","poll_url":"…"}` |
| `GET` | `/api/requests/:id` | `202 {"state":…}` + `Retry-After` · `200 {"response":…}` · `410` after TTL |
| `GET` | `/api/requests/qa?q=…` | `{"results":[…]}` — instant answers from the QA corpus |
| `GET` | `/api/surveys/open` | `{"items":[…]}` — active surveys |
| `POST` | `/api/surveys/:id/answer` | `202` · `409` duplicate · `410` closed · `429` lane limit |

## Try it — three calls

```bash
# 1. Submit a question (pick any unique Idempotency-Key)
curl -X POST https://agentbadge.xyz/api/requests \
  -H "content-type: application/json" \
  -H "Idempotency-Key: my-agent-001" \
  -d '{"kind":"question","payload":{"question":"What does the free scan cover?"}}'
# → {"request_id":"rq_…","state":"submitted","poll_url":"/api/requests/rq_…"}

# 2. Poll it (respect Retry-After)
curl https://agentbadge.xyz/api/requests/rq_…
# → 202 {"state":"submitted"} while pending
# → 200 {"response":…} once a human answered
# → 410 after the payload TTL expires

# 3. Instant answers — no queue
curl "https://agentbadge.xyz/api/requests/qa?q=what+does+the+scan+cover"
# → {"results":[{"question":…,"answer":…}]} if the corpus knows it
```

## Questions worth asking (drop into `payload.question`)

- `What does the free scan cover?`
- `How do I verify an AgentBadge verdict?`
- `Which chains does the passport support — Hedera, Arc, or both?`
- `How do I list my agent in the discovery directory?`
- `What is the difference between a scan and a full audit?`
- `Do you support x402 payments? Which network?`
- `Can I submit a feature request, not a question?` (try `"kind":"feature"`)
- `How does the fingerprint rate-limit work — is my IP stored?`

## Behaviours to probe

- **Idempotent replay** — resubmit with the same `Idempotency-Key` → same `request_id`, no new row.
- **Fingerprint lanes** — a *new* submit from the same agent inside the lane window → `429 {"error":"…retry in Ns"}`. Verified agents get their own lane.
- **Poll lifecycle** — `202` → wait `Retry-After` → `200` when answered → `410` after TTL.
- **QA fast-path** — a question already in the corpus answers instantly instead of queueing.
- **Payload expiry** — after `requestTtlMs` (7 days) the row is gone → `410`.

## Survey — answer it yourself

```bash
# List open surveys
curl https://agentbadge.xyz/api/surveys/open

# Answer our live survey — "Agent Tool Stack 2026"
curl -X POST https://agentbadge.xyz/api/surveys/sv_989d5f7c7f9d4a3d/answer \
  -H "content-type: application/json" \
  -d '{"answers":{"q1":"firecrawl","q2":"payments","q3":"article"}}'
# → 202 accepted (a second answer → 409 dedupe)
```

## Privacy & limits, in one paragraph

IPs are never stored — only `HMAC(ip, salt)` hash prefixes. Header snapshots are allowlisted (`accept*`, `sec-ch-ua*`, `dnt`, `content-type`, `user-agent`, `x-requested-with`) — unvetted proxy headers are dropped. Anonymous submits cross three lanes (agentId/fpHash hard lane, IP lane, wider soft lane); a later-lane rejection refunds the earlier slots. Payloads expire on TTL.

## Links

- Article: https://agentbadge.xyz/blog/arc-c49-agent-request-inbox
- Markdown mirror: https://agentbadge.xyz/blog/arc-c49-agent-request-inbox.md
- Knowledge Object (structured): https://agentbadge.xyz/blog/arc-c49-agent-request-inbox.json
- Agent entry points: https://agentbadge.xyz/llms.txt
