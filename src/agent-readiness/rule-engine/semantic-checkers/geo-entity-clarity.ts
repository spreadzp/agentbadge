// EPIC-146 (SLICE-146-7): GEO citability checkers — ported from
// packages/agent-readiness-scanner/src/rule-engine/semantic-checkers.ts.
// Keep in sync with the core package implementation.
import type { SemanticChecker } from "./helpers";
import {
  ABOUT_LINK_RE,
  CATEGORY_STATEMENT_RE,
  collectJsonLdEntities,
  countWords,
  extractMetaContent,
  htmlToText,
  type JsonLdEntity,
  JSONLD_BLOCK_RE,
  normalizeEntityName,
} from "./geo-citability-helpers";

// ─── AB-185 (EPIC-146): Entity clarity ───────────────────────────────────
// Coherent machine-readable self-description: one canonical
// "X is a [category] for [audience]" statement, consistent brand naming
// across <title>/og:site_name/JSON-LD, an About page, and ideally an
// Organization/AboutPage schema with description. Cross-check vs AB-015:
// no JSON-LD at all → capped at partial (don't double-fail).
export const checkerEntityClarity: SemanticChecker = (sources) => {
  const snap = sources.html;
  if (!snap?.body) {
    return { outcome: "no_source", detail: "Homepage HTML snapshot not found" };
  }
  const html = snap.body;
  const text = htmlToText(html);
  const pageWords = countWords(text);

  // Parse JSON-LD entities
  const entities: JsonLdEntity[] = [];
  let hasJsonLd = false;
  for (const m of html.matchAll(JSONLD_BLOCK_RE)) {
    hasJsonLd = true;
    try {
      collectJsonLdEntities(JSON.parse(m[1].trim()), entities);
    } catch {
      /* malformed block — ignore */
    }
  }

  // Nothing to evaluate — API-only stub / redirect page
  if (pageWords < 100 && !hasJsonLd) {
    return {
      outcome: "not_applicable",
      detail: `Only ${pageWords} words and no structured data — no entity surface to evaluate`,
    };
  }

  // Collect brand names: <title> core, og:site_name, first JSON-LD entity name
  const titleRaw = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1];
  const titleCore = titleRaw ? normalizeEntityName(titleRaw) : "";
  const ogName = extractMetaContent(html, "og:site_name", "property");
  const entityName = entities.find((e) => e.name)?.name ?? null;

  const names = [titleCore, ogName && normalizeEntityName(ogName), entityName && normalizeEntityName(entityName)]
    .filter((n): n is string => !!n && n.length > 0);
  const namesConsistent =
    names.length >= 2 &&
    names.every(
      (a) =>
        names.every(
          (b) => a === b || a.includes(b) || b.includes(a),
        ),
    );
  const nameMismatch = names.length >= 2 && !namesConsistent;

  // Category statement: "<Brand> is a/an/the <category> for/to <audience>" or "<Brand> helps <audience>"
  const metaDesc = extractMetaContent(html, "description", "name") ?? "";
  const leadText = `${titleRaw ?? ""} ${metaDesc} ${text.slice(0, 1500)}`;
  const hasCategoryStatement = CATEGORY_STATEMENT_RE.test(leadText);

  const hasAboutLink = ABOUT_LINK_RE.test(html);
  const hasSchemaDesc = entities.some(
    (e) =>
      e.hasDescription &&
      // Organization/AboutPage description carries the canonical text
      true,
  );

  let score = 0;
  const marks: string[] = [];
  if (hasCategoryStatement) { score += 2; marks.push("category statement"); }
  if (namesConsistent) { score += 2; marks.push(`${names.length} consistent name sources`); }
  else if (names.length === 1 && (ogName || entityName)) {
    // bare <title> alone proves nothing — only machine-readable sources count
    score += 1; marks.push("single machine-readable name source");
  }
  if (hasAboutLink) { score += 1; marks.push("about page link"); }
  if (hasSchemaDesc) { score += 1; marks.push("schema description"); }

  const caps: string[] = [];
  if (nameMismatch) caps.push("name mismatch across title/og/schema");
  if (!hasJsonLd) caps.push("no JSON-LD (see AB-015)");

  if (
    score >= 4 && namesConsistent && hasJsonLd && hasCategoryStatement
  ) {
    return {
      outcome: "found",
      detail: `Entity clarity OK (${marks.join(", ")})`,
    };
  }
  if (score >= 1) {
    const why = caps.length ? ` — capped: ${caps.join("; ")}` : "";
    return {
      outcome: "partial",
      detail: `Partial entity clarity (${marks.join(", ") || "weak signals"}${why})`,
    };
  }
  return {
    outcome: "absent",
    detail: `No canonical 'X is a <category> for <audience>' statement, no consistent machine-readable naming`,
  };
};
