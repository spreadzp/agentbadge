import { html } from "hono/html";
import { type BlogArticle } from "../../server/lib/blog-data";
import { type KnowledgeObject } from "../../server/lib/blog/knowledge-object";
import { StatusBadge } from "./blog-knowledge-blocks";


/**
 * SLICE-201-11 / D-201-16: visible "FOR AI AGENTS" agent context block.
 * Rendered from the same KnowledgeObject that powers /blog/:slug.json (SSOT).
 * "Author / work with" appears when relatedResources has a team-profile (D-201-23).
 */
export function AgentContextBlock(article: BlogArticle, ko: KnowledgeObject) {
  const hasTeamProfile = (article.relatedResources ?? []).some((r) => r.type === "team-profile");
  const related = [
    ...(ko.relatedResources ?? []),
    ...(article.relatedResources ?? []).filter(
      (r) => !(ko.relatedResources ?? []).some((k) => k.url === r.url),
    ),
  ];
  const machineLinks: { label: string; href: string }[] = [
    { label: "JSON", href: `/blog/${article.slug}.json` },
  ];
  if (article.agentGuideSlug) {
    machineLinks.push({
      label: "Companion guide",
      href: `/agent-guide/articles/${article.agentGuideSlug}`,
    });
  }
  if (article.markdown) {
    machineLinks.push({ label: "Markdown", href: `/blog/${article.slug}.md` });
  }
  machineLinks.push(
    { label: "Agent Knowledge Index", href: "/agent-guide/" },
    { label: "llms.txt", href: "/llms.txt" },
    { label: "Engineering services", href: "/agent-guide/team/services" },
  );

  return html`<section
    class="mt-8 rounded-xl border border-emerald-800/50 bg-emerald-950/20 p-6"
    aria-label="For AI Agents"
  >
    <h2 class="text-lg font-bold text-emerald-400">FOR AI AGENTS</h2>
    <dl class="mt-4 space-y-2">
      <div class="flex flex-col gap-1 sm:flex-row sm:gap-3">
        <dt class="w-36 shrink-0 text-xs font-semibold uppercase tracking-wider text-slate-500">
          Summary
        </dt>
        <dd class="text-sm text-slate-300">${article.shortAnswer ?? ko.description}</dd>
      </div>
      <div class="flex flex-col gap-1 sm:flex-row sm:gap-3">
        <dt class="w-36 shrink-0 text-xs font-semibold uppercase tracking-wider text-slate-500">
          Status
        </dt>
        <dd>${StatusBadge(ko.status)}</dd>
      </div>
      ${
        ko.concepts.length > 0
          ? html`<div class="flex flex-col gap-1 sm:flex-row sm:gap-3">
              <dt
                class="w-36 shrink-0 text-xs font-semibold uppercase tracking-wider text-slate-500"
              >
                Key concepts
              </dt>
              <dd class="flex flex-wrap gap-2 text-sm">
                ${ko.concepts.map(
                  (c) =>
                    html`<a
                      href="/agent-guide/concepts/${encodeURIComponent(c)}"
                      class="text-emerald-400 hover:text-emerald-300"
                      >${c}</a
                    >`,
                )}
              </dd>
            </div>`
          : ""
      }
      ${
        ko.capabilities.length > 0
          ? html`<div class="flex flex-col gap-1 sm:flex-row sm:gap-3">
              <dt
                class="w-36 shrink-0 text-xs font-semibold uppercase tracking-wider text-slate-500"
              >
                Capabilities
              </dt>
              <dd class="flex flex-wrap gap-2 text-sm">
                ${ko.capabilities.map(
                  (c) =>
                    html`<a
                      href="/agent-guide/capabilities/${encodeURIComponent(c)}"
                      class="text-emerald-400 hover:text-emerald-300"
                      >${c}</a
                    >`,
                )}
              </dd>
            </div>`
          : ""
      }
      ${
        ko.technologies && ko.technologies.length > 0
          ? html`<div class="flex flex-col gap-1 sm:flex-row sm:gap-3">
              <dt
                class="w-36 shrink-0 text-xs font-semibold uppercase tracking-wider text-slate-500"
              >
                Technologies
              </dt>
              <dd class="text-sm text-slate-300">${ko.technologies.join(", ")}</dd>
            </div>`
          : ""
      }
      ${
        ko.claims.length > 0
          ? html`<div class="flex flex-col gap-1 sm:flex-row sm:gap-3">
              <dt
                class="w-36 shrink-0 text-xs font-semibold uppercase tracking-wider text-slate-500"
              >
                Evidence
              </dt>
              <dd>
                <ul class="space-y-1 text-sm text-slate-300">
                  ${ko.claims.map(
                    (c) =>
                      html`<li>
                        ${c.text}
                        ${(c.evidence ?? []).map(
                        (e) =>
                          html`<a
                            href="${e.url}"
                            target="_blank"
                            rel="noopener"
                            class="ml-2 text-xs text-emerald-500 hover:text-emerald-300"
                            >[${e.type}]</a
                          >`,
                      )}
                      </li>`,
                  )}
                </ul>
              </dd>
            </div>`
          : ""
      }
      ${
        ko.actions.length > 0
          ? html`<div class="flex flex-col gap-1 sm:flex-row sm:gap-3">
              <dt
                class="w-36 shrink-0 text-xs font-semibold uppercase tracking-wider text-slate-500"
              >
                Actions
              </dt>
              <dd class="flex flex-wrap gap-3 text-sm">
                ${ko.actions.map(
                  (a) =>
                    html`<a href="${a.url}" class="text-emerald-400 hover:text-emerald-300"
                      >${a.label} →</a
                    >`,
                )}
              </dd>
            </div>`
          : ""
      }
      <div class="flex flex-col gap-1 sm:flex-row sm:gap-3">
        <dt class="w-36 shrink-0 text-xs font-semibold uppercase tracking-wider text-slate-500">
          Machine-readable
        </dt>
        <dd class="flex flex-wrap gap-x-3 gap-y-1 text-sm">
          ${machineLinks.map(
            (l) =>
              html`<a href="${l.href}" class="text-emerald-400 hover:text-emerald-300"
                >${l.label}</a
              >`,
          )}
        </dd>
      </div>
      ${
        related.length > 0
          ? html`<div class="flex flex-col gap-1 sm:flex-row sm:gap-3">
              <dt
                class="w-36 shrink-0 text-xs font-semibold uppercase tracking-wider text-slate-500"
              >
                Related
              </dt>
              <dd class="flex flex-wrap gap-3 text-sm">
                ${related.map(
                  (r) =>
                    html`<a href="${r.url}" class="text-emerald-400 hover:text-emerald-300"
                      >${r.label} ↗</a
                    >`,
                )}
              </dd>
            </div>`
          : ""
      }
    </dl>
    ${
      hasTeamProfile
        ? html`<div class="mt-5 border-t border-emerald-800/40 pt-4">
            <h3 class="text-xs font-semibold uppercase tracking-widest text-slate-500">
              Author / work with
            </h3>
            <div class="mt-2 flex flex-wrap gap-4">
              <a
                href="/agent-guide/team/capabilities"
                class="text-sm text-emerald-400 hover:text-emerald-300"
                >Team capabilities</a
              >
              <a
                href="/agent-guide/team/availability"
                class="text-sm text-emerald-400 hover:text-emerald-300"
                >Availability</a
              >
              <a
                href="/agent-guide/team/contact"
                class="text-sm text-emerald-400 hover:text-emerald-300"
                >Contact</a
              >
            </div>
          </div>`
        : ""
    }
  </section>`;
}
