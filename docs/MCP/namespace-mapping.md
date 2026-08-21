# MCP Namespace Mapping — EPIC-72

**Runtime tool count:** 65 (captured from `POST /mcp` `tools/list` on localhost:4021)
**Source tool count:** 65 (from grep of `registerTool()` calls across all source files)
**Date:** 2026-08-21

## Namespace Summary

| Namespace | Endpoint | Tools | Token savings vs full list |
|---|---|---|---|
| `passport-mcp` | `/mcp/passport` | 18 | ~73% |
| `market-mcp` | `/mcp/market` | 13 | ~80% |
| `discovery-mcp` | `/mcp/discovery` | 22 | ~66% |
| `audit-mcp` | `/mcp/audit` | 12 | ~82% |
| `/mcp` (aggregator) | `/mcp` | all 65 | 0% (backward compat) |

## Full Tool Mapping

### passport-mcp (18 tools)

Identity, credentials, signing, escrow, passport tier pricing, DID resolution.

| Tool name | Source file | Registration function | Notes |
|---|---|---|---|
| `request_passport` | `passport.tools.ts` | `registerPassportTools` | |
| `upload_image` | `passport.tools.ts` | `registerPassportTools` | |
| `verify_passport` | `passport.tools.ts` | `registerPassportTools` | |
| `get_passport` | `passport.tools.ts` | `registerPassportTools` | |
| `list_passports` | `passport.tools.ts` | `registerPassportTools` | |
| `upgrade_tier` | `passport.tools.ts` | `registerPassportTools` | |
| `revoke_passport` | `passport.tools.ts` | `registerPassportTools` | |
| `sign_transaction` | `signing.tools.ts` | `registerSigningTools` | |
| `complete_task_with_key` | `signing.tools.ts` | `registerSigningTools` | |
| `post_task_with_key` | `signing.tools.ts` | `registerSigningTools` | |
| `claim_task_with_key` | `signing.tools.ts` | `registerSigningTools` | |
| `deliver_result_with_key` | `signing.tools.ts` | `registerSigningTools` | |
| `get_escrow_status` | `escrow.tools.ts` | `registerEscrowTools` | |
| `cancel_escrow` | `escrow.tools.ts` | `registerEscrowTools` | |
| `increase_reward` | `escrow.tools.ts` | `registerEscrowTools` | |
| `verify_result` | `escrow.tools.ts` | `registerEscrowTools` | |
| `resolve_did` | `parity-tools.ts` | `registerParityTools` | Moved from audit: DID = identity |
| `get_pricing` | `parity-tools.ts` | `registerParityTools` | Moved from audit: passport tier pricing |

### market-mcp (13 tools)

Marketplace tasks, dataset exchange, work requests, marketplace guides.

| Tool name | Source file | Registration function | Notes |
|---|---|---|---|
| `post_task` | `marketplace.tools.ts` | `registerMarketplaceTools` | |
| `list_tasks` | `marketplace.tools.ts` | `registerMarketplaceTools` | |
| `claim_task` | `marketplace.tools.ts` | `registerMarketplaceTools` | |
| `deliver_result` | `marketplace.tools.ts` | `registerMarketplaceTools` | |
| `prepare_payment` | `marketplace.tools.ts` | `registerMarketplaceTools` | |
| `complete_task` | `marketplace.tools.ts` | `registerMarketplaceTools` | |
| `download_dataset` | `dataset.tools.ts` | `registerDatasetTools` | |
| `upload_result` | `dataset.tools.ts` | `registerDatasetTools` | |
| `get_market_guide` | `parity-tools.ts` | `registerParityTools` | Moved from audit: marketplace guide |
| `get_marketplace_guide` | `parity-tools.ts` | `registerParityTools` | Moved from audit: marketplace guide |
| `list_work_requests` | `parity-tools.ts` | `registerParityTools` | Moved from audit: work marketplace API |
| `get_work_request` | `parity-tools.ts` | `registerParityTools` | Moved from audit: work marketplace API |
| `create_work_request` | `parity-tools.ts` | `registerParityTools` | Moved from audit: work marketplace API |

### discovery-mcp (22 tools)

Agent cards, search, directory, guides, A2A messaging, protocol discovery, service discovery, activity feed.

| Tool name | Source file | Registration function | Notes |
|---|---|---|---|
| `get_agent_card` | `discovery.tools.ts` | `registerDiscoveryTools` | |
| `search_agents` | `discovery.tools.ts` | `registerDiscoveryTools` | |
| `get_server_info` | `discovery.tools.ts` | `registerDiscoveryTools` | |
| `get_ai_sitemap` | `discovery.tools.ts` | `registerDiscoveryTools` | |
| `get_guide` | `guide.tools.ts` | `registerGuideTools` | |
| `list_guides` | `guide.tools.ts` | `registerGuideTools` | |
| `register_agent` | `directory.tools.ts` | `registerDirectoryTools` | |
| `find_agents` | `directory.tools.ts` | `registerDirectoryTools` | |
| `send_message` | `a2a.tools.ts` | `registerA2ATools` | |
| `send_message_with_key` | `a2a.tools.ts` | `registerA2ATools` | |
| `get_inbox` | `a2a.tools.ts` | `registerA2ATools` | |
| `get_conversation` | `a2a.tools.ts` | `registerA2ATools` | |
| `get_oauth_authorization_server` | `parity-tools.ts` | `registerParityTools` | Moved from audit: OAuth discovery protocol |
| `get_oauth_protected_resource` | `parity-tools.ts` | `registerParityTools` | Moved from audit: OAuth discovery protocol |
| `get_webfinger` | `parity-tools.ts` | `registerParityTools` | Moved from audit: WebFinger discovery protocol |
| `get_http_message_signatures_directory` | `parity-tools.ts` | `registerParityTools` | Moved from audit: HTTP sig discovery protocol |
| `rebuild_cache` | `parity-tools.ts` | `registerParityTools` | Moved from audit: HCS directory cache admin |
| `get_feed` | `parity-tools.ts` | `registerParityTools` | Moved from audit: activity feed = discovery |
| `get_services` | `parity-tools.ts` | `registerParityTools` | Moved from audit: service discovery |
| `get_agent_by_did` | `parity-tools.ts` | `registerParityTools` | Moved from audit: agent directory lookup |
| `get_services_info` | `parity-tools.ts` | `registerParityTools` | Moved from audit: agency profile = service discovery |
| `contact_us` | `parity-tools.ts` | `registerParityTools` | Moved from audit: contact routing = guide |

### audit-mcp (12 tools)

Compliance scanning, audit catalog, page inspection, legal/privacy verification.

| Tool name | Source file | Registration function | Notes |
|---|---|---|---|
| `get_audit_trail` | `audit-catalog.tools.ts` | `registerAuditCatalogTools` | |
| `get_tier_requirements` | `audit-catalog.tools.ts` | `registerAuditCatalogTools` | |
| `check_compliance` | `compliance-tools.ts` | `registerComplianceTools` | |
| `get_changelog` | `parity-tools.ts` | `registerParityTools` | Product audit/changelog |
| `get_faq` | `parity-tools.ts` | `registerParityTools` | Page inspection |
| `get_about` | `parity-tools.ts` | `registerParityTools` | Page inspection |
| `get_privacy` | `parity-tools.ts` | `registerParityTools` | Compliance/legal |
| `get_terms` | `parity-tools.ts` | `registerParityTools` | Compliance/legal |
| `get_team` | `parity-tools.ts` | `registerParityTools` | Page inspection |
| `get_use_cases` | `parity-tools.ts` | `registerParityTools` | Page inspection |
| `get_work_with_us` | `parity-tools.ts` | `registerParityTools` | Page inspection |
| `get_medical_guide` | `parity-tools.ts` | `registerParityTools` | Page inspection (demo guide) |

## Parity Tools Reclassification Summary

Of 26 `parity-tools.ts` tools, 17 are reclassified out of audit-mcp:

| Target namespace | Tools moved | Reason |
|---|---|---|
| passport-mcp | 2 | `resolve_did` (identity), `get_pricing` (passport tiers) |
| market-mcp | 5 | `get_market_guide`, `get_marketplace_guide`, `list_work_requests`, `get_work_request`, `create_work_request` |
| discovery-mcp | 10 | OAuth/WebFinger/HTTP-sig protocols, DID cache, feed, services, agent directory, contact |
| audit-mcp (stays) | 9 | Page inspection + legal/compliance pages |

## Token Budget Estimation

Estimated `tools/list` response size per namespace (based on ~350 bytes per tool definition: name + description + input schema):

| Namespace | Tools | Est. response size | Savings vs monolithic |
|---|---|---|---|
| passport-mcp | 18 | ~6.3 KB | ~73% |
| market-mcp | 13 | ~4.6 KB | ~80% |
| discovery-mcp | 22 | ~7.7 KB | ~66% |
| audit-mcp | 12 | ~4.2 KB | ~82% |
| **Total (monolithic)** | 65 | ~22.8 KB | 0% |

## Collision Check

No tool name collisions detected within any namespace. All tool names are unique across the entire registry.

## Count Verification

- Runtime `tools/list` returns **65** tools
- Source `registerTool()` calls total **65** across 12 source files
- Breakdown: passport(7) + signing(5) + escrow(4) + marketplace(6) + dataset(2) + discovery(4) + directory(2) + guide(2) + a2a(4) + audit-catalog(2) + compliance(1) + parity(26) = 65
