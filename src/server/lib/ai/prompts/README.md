# AI prompt registry (EPIC-232, O1)

One prompt file per scenario: `<scenario>.md` (see `AI_SCENARIOS` in
`../types.ts`). `loadPrompt(scenario)` in `../prompts.ts` reads and
caches the file; `AiRun.promptVersion` stamps the sha256:12 content
hash so shadow-agreement history stays comparable across edits — any
change to a prompt file produces a new version automatically. Do NOT
edit prompts to "fix" run history: the version string is the audit
join.

Missing file → `loadPrompt` returns null; scenario runners decide
whether a prompt is required or built programmatically (then pass
`promptVersionFor(text)` or a literal tag as `promptVersion`).
