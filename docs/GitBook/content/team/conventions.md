# Conventions

## Code Conventions

- **Language:** TypeScript (strict mode)
- **Runtime:** Bun
- **Testing:** Vitest with `--run` flag
- **Formatting:** Prettier (config in repo root)
- **Linting:** ESLint
- **Package Manager:** Bun (not npm/yarn)

## Documentation Conventions

- **Language:** English only (repo policy)
- **Format:** Markdown
- **File naming:** `kebab-case.md` for files, `UPPERCASE.md` for root-level docs
- **EPIC naming:** `EPIC-{N}-{kebab-case-name}/`
- **Slice naming:** `SLICE-{N}-{number}-{kebab-case-name}.md`

## Git Conventions

- **Commit style:** Conventional commits (`feat:`, `fix:`, `docs:`)
- **Branch naming:** `type/topic` (e.g., `docs/api-reference`, `feat/47-4`)
- **PR titles:** Descriptive, reference slice ID if applicable

## Hedera Conventions

- **Network:** Testnet for development, Mainnet for production
- **Topics:** HCS topics for messaging, directory, audit trail
- **Tokens:** HTS for passport NFTs
- **DIDs:** `did:hcs:{tokenId}:{serialNumber}` format

## Agent Readiness Conventions

- **Rules:** `AB-{NNN}` naming (e.g., `AB-001`, `AB-061`)
- **Categories:** 17 categories defined in `shared.schema.ts`
- **Scoring:** 0-100, weighted by category
- **Badges:** red (0-59), yellow (60-79), blue (80-89), green (90-100)
