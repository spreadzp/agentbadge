/**
 * SLICE-218-6 / D-218-9: one compact AI-block per article page.
 *
 * Article bodies embed a `<h2>For AI Agents</h2>` section. The page footer
 * already renders the KO-driven `AgentContextBlock` (the single compact
 * AI-block). The embedded section is stripped from the rendered HTML page so
 * it does not duplicate the block; the `.md` route still serves it to agents.
 *
 * Section boundary: from an optional preceding <hr> and the For-AI-Agents H2
 * up to (not including) the next <h2>, the next <hr>, or end of content.
 * Interior <h3> subsections belong to the section and are removed with it.
 */
const FOR_AI_AGENTS_SECTION_RE =
  /(?:<hr\s*\/?>\s*)?<h2\b[^>]*>\s*For AI Agents?\s*<\/h2>[\s\S]*?(?=<h2\b|<hr\b|$)/i;

export function stripForAiAgentsSection(content: string): string {
  return content.replace(FOR_AI_AGENTS_SECTION_RE, "");
}
