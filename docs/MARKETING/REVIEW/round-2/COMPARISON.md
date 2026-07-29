# EPIC-18 Re-Audit: Round 1 vs Round 2 Comparison

> **Date**: 2026-07-29
> **Deployment**: https://agent-passport-hedera.fly.dev/
> **EPIC**: 18 — SEO/GEO Discoverability
> **Target**: ≥ 2/3 agents fully correct on first iteration (no hints)

## Round 1 Summary (Before EPIC-18)

All three agents (Perplexity, Gemini, DeepSeek) **failed** their first pass:
- Saw an empty HTML shell — no meta tags, no structured data, no robots.txt
- Concluded the site was "a demo with weak SEO"
- Only after manual `/llms.txt` and `/agent-guide` hand-feeding did they reverse to "exemplary"

### Round 1 Per-Agent Verdicts

| Agent | First-Iteration | Key Failure |
| --- | --- | --- |
| **Perplexity** | ❌ FAIL | "слабый GEO/SEO-профиль", "демо/стенд", no meta tags found |
| **Gemini** | ❌ FAIL | No `<title>`, no `<meta description>`, no OG tags, no JSON-LD, "Loading..." shells |
| **DeepSeek** | ❌ FAIL | Saw dashboard data but no SEO/GEO signals, no structured data |

## Round 2 Results

| Criterion | Perplexity | Gemini | DeepSeek |
| --- | --- | --- | --- |
| Fetched `/` on first try | [ ] Y / N | [ ] Y / N | [ ] Y / N |
| Found robots.txt | [ ] Y / N | [ ] Y / N | [ ] Y / N |
| Found llms.txt | [ ] Y / N | [ ] Y / N | [ ] Y / N |
| Found JSON-LD | [ ] Y / N | [ ] Y / N | [ ] Y / N |
| Found sitemap.xml | [ ] Y / N | [ ] Y / N | [ ] Y / N |
| Found /changelog | [ ] Y / N | [ ] Y / N | [ ] Y / N |
| Product comprehension (1st iter) | [ ] Correct / Partial / No | [ ] Correct / Partial / No | [ ] Correct / Partial / No |
| **First-iteration correct** | [ ] **Yes** / No | [ ] **Yes** / No | [ ] **Yes** / No |

## Scorecard

- **First-iteration correct**: ___ / 3
- **Target**: ≥ 2/3
- **Result**: [ ] PASS / [ ] FAIL

## Per-Agent Delta (Round 1 → Round 2)

### Perplexity
- **Round 1**: "слабый GEO/SEO-профиль", "демо/стенд", no meta tags, no structured data detected. Concluded site is "not optimized for public search indexing".
- **Round 2**: (fill after audit)
- **Delta**: (fill after audit)

### Gemini
- **Round 1**: No `<title>`, no `<meta description>`, no OG/Twitter tags, no JSON-LD (Schema.org). "Loading..." shells = crawler sees empty boxes. Rated SEO as ❌ across the board.
- **Round 2**: (fill after audit)
- **Delta**: (fill after audit)

### DeepSeek
- **Round 1**: Saw dashboard data blocks (stats, audit stream, A2A inbox) but no SEO/GEO signals. No structured data, no meta tags. Described as "действующая панель мониторинга" but missed the product positioning.
- **Round 2**: (fill after audit)
- **Delta**: (fill after audit)

## New Gaps Found (EPIC-19 Candidates)

> List any NEW gaps identified by agents that were not addressed in EPIC-18.
> These should become candidate slices for EPIC-19, not silently fixed.

1. (gap description) → candidate slice: SLICE-19-X
2. (gap description) → candidate slice: SLICE-19-X
3. (none if all clear)

## Conclusion

> Final verdict: did EPIC-18 close the "first-iteration blindness" gap?
