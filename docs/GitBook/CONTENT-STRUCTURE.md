# Content Structure Recommendations

## Recommended Page Hierarchy

Based on the project's existing documentation in `docs/`, here's the recommended GitBook structure:

```
content/
├── README.md                          # Homepage — project overview
├── SUMMARY.md                         # Navigation tree
├── getting-started/
│   ├── README.md                      # Getting started overview
│   ├── installation.md                # How to install/run the project
│   ├── quickstart.md                  # 5-minute quickstart
│   └── architecture.md                # High-level architecture
├── guides/
│   ├── README.md                      # Guides overview
│   ├── agent-readiness.md             # What is agent readiness
│   ├── scanner-usage.md               # How to use the scanner
│   ├── cli-reference.md               # CLI commands and flags
│   └── mcp-tools.md                   # MCP server tools
├── api-reference/
│   ├── README.md                      # API overview
│   ├── authentication.md              # Auth methods
│   ├── scanner-api.md                 # Scanner endpoints
│   ├── passport-api.md                # Passport endpoints
│   └── marketplace-api.md             # Marketplace endpoints
├── epics/
│   ├── README.md                      # EPICs overview
│   ├── epic-47.md                     # AgentGrade 100
│   ├── epic-48.md                     # CLI Feature Parity
│   ├── epic-49.md                     # isitagentready Compliance
│   ├── epic-51.md                     # Brand Repositioning
│   └── epic-56.md                     # Agent-Facing Services
├── team/
│   ├── README.md                      # Team guide overview
│   ├── onboarding.md                  # New member onboarding
│   ├── workflow.md                    # Development workflow
│   └── conventions.md                 # Code & doc conventions
└── .gitbook/
    ├── assets/                        # Images, diagrams
    ├── includes/                      # Reusable content blocks
    └── vars.yaml                      # Space-level variables
```

## SUMMARY.md Structure

The `SUMMARY.md` is the navigation tree. Here's the recommended structure:

```markdown
# Table of Contents

## Getting Started
* [Overview](getting-started/README.md)
* [Installation](getting-started/installation.md)
* [Quickstart](getting-started/quickstart.md)
* [Architecture](getting-started/architecture.md)

## Guides
* [Overview](guides/README.md)
* [Agent Readiness](guides/agent-readiness.md)
* [Scanner Usage](guides/scanner-usage.md)
* [CLI Reference](guides/cli-reference.md)
* [MCP Tools](guides/mcp-tools.md)

## API Reference
* [Overview](api-reference/README.md)
* [Authentication](api-reference/authentication.md)
* [Scanner API](api-reference/scanner-api.md)
* [Passport API](api-reference/passport-api.md)
* [Marketplace API](api-reference/marketplace-api.md)

## EPICs & Roadmap
* [Overview](epics/README.md)
* [EPIC-47: AgentGrade 100](epics/epic-47.md)
* [EPIC-48: CLI Parity](epics/epic-48.md)
* [EPIC-49: Compliance](epics/epic-49.md)
* [EPIC-51: Brand](epics/epic-51.md)
* [EPIC-56: Agent Services](epics/epic-56.md)

## Team
* [Onboarding](team/onboarding.md)
* [Workflow](team/workflow.md)
* [Conventions](team/conventions.md)
```

## Multi-Project Strategy

For multiple projects (as the user described), there are two approaches:

### Option A: Multiple Spaces (Recommended)

Each project gets its own GitBook Space:

| Space | Content Source | Audience |
|---|---|---|
| AgentBadge Knowledge Base | `docs/GitBook/content/` | Public/team |
| Scanner Docs | `hackathon/server/docs/` | Developers |
| EPICs & Planning | `docs/EPICS/` | Internal team |

Each space has its own Git Sync pointing to a different directory in the same repo.

### Option B: One Space with Sections

One GitBook space with sections for each project:

```markdown
# Summary

## AgentBadge
* [Overview](agentbadge/README.md)
* ...

## Scanner
* [Overview](scanner/README.md)
* ...

## EPICs
* [Overview](epics/README.md)
* ...
```

**Recommendation:** Start with Option B (single space) while the team is small. Migrate to Option A (multiple spaces) when you need separate access control per project.

## Content Migration Plan

To migrate existing docs into GitBook structure:

| Existing Location | GitBook Destination | Priority |
|---|---|---|
| `README.md` (root) | `content/README.md` (homepage) | High |
| `docs/EPICS/EPICS.md` | `content/epics/README.md` | Medium |
| `docs/EPICS/TEAM-ONBOARDING-GUIDE.md` | `content/team/onboarding.md` | High |
| `docs/CONCURENTS/agent-grade/` | `content/guides/agent-readiness.md` | Medium |
| `hackathon/server/README.md` | `content/getting-started/README.md` | High |
| EPIC slice documents | `content/epics/epic-{N}.md` (summaries) | Low |

**Note:** Don't copy entire EPIC slice documents — write summary pages that link to the source files in the repo.
