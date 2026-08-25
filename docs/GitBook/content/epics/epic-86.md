# EPIC-86: CI Rate Limiting Hardening

## Goal

Add rate limiting and abuse prevention for CI endpoints and scanner API to prevent resource exhaustion and ensure fair usage.

## Key Deliverables

- Rate limiting for `/api/scan/*` endpoints
- Per-IP and per-DID rate limits
- Sliding window rate limiter implementation
- 429 Too Many Requests responses with Retry-After header
- Rate limit headers (X-RateLimit-Limit, X-RateLimit-Remaining)
- Monitoring and alerting for rate limit hits

## Source

- [EPIC-86 full document](https://github.com/spreadzp/agentbadge/tree/main/docs/EPICS/)
