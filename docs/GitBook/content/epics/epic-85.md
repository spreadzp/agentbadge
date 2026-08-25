# EPIC-85: Scanner SSRF Endpoint Hardening

## Goal

Protect scanner endpoints from Server-Side Request Forgery (SSRF) attacks by implementing URL validation, allowlists, and input sanitization.

## Key Deliverables

- URL validation (reject private IPs, localhost, internal ranges)
- Domain allowlist configuration
- Redirect following limits
- Request timeout enforcement
- Input sanitization for scan endpoint
- Rate limiting per IP

## Source

- [EPIC-85 full document](https://github.com/spreadzp/agentbadge/tree/main/docs/EPICS/)
