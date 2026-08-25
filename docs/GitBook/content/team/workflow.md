# Development Workflow

## Branch Strategy

- `main` — production-ready code
- `docs/<topic>` — documentation changes
- `feat/<slice-id>` — feature development (e.g., `feat/47-4`)
- `fix/<issue>` — bug fixes

## Commit Conventions

Follow conventional commits:

- `feat:` — new feature
- `fix:` — bug fix
- `docs:` — documentation only
- `refactor:` — code restructuring
- `test:` — test additions/changes
- `chore:` — maintenance tasks

Example: `feat(47-4): add content negotiation endpoint`

## Pull Request Process

1. **Create** PR with descriptive title
2. **Link** related EPIC slice in PR description
3. **Ensure** CI passes (tests + linting)
4. **Request** review from at least one team member
5. **Address** review comments
6. **Squash** merge when approved

## Testing

- All new code must have tests
- Follow TDD: Red → Green → Refactor
- Run tests: `bunx vitest run --run`
- E2E tests: `bunx vitest run --run tests/e2e/`

{% hint style="warning" %}
Always use `--run` flag with vitest. Never run `bun run test` without `--run` — it enters watch mode.
{% endhint %}

## Code Style

- TypeScript strict mode
- Prettier for formatting (config in repo)
- ESLint for linting
- No inline comments explaining "what" — only "why"
