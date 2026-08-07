/**
 * RelevantEngineeringCapability component (SLICE-46-5)
 *
 * Reads article frontmatter, resolves capability IDs via registry loader,
 * renders CTA with capability name, confidence, and link to /agent-guide/team/capabilities.
 * Renders nothing if no related capabilities.
 */

import type { RegistryIndex, Capability } from "../server/registry/types";
import type { ArticleFrontmatter } from "../server/lib/frontmatter";

export function RelevantEngineeringCapability(
  frontmatter: ArticleFrontmatter,
  registry: RegistryIndex,
): string {
  const capIds = frontmatter.related_capabilities;
  if (!capIds || capIds.length === 0) {
    return "";
  }

  const capabilities: Capability[] = capIds
    .map((id) => registry.capabilities.find((c) => c.id === id))
    .filter((c): c is Capability => c !== undefined);

  if (capabilities.length === 0) {
    return "";
  }

  const serviceIds = frontmatter.related_services ?? [];
  const services = serviceIds
    .map((id) => registry.services.find((s) => s.id === id))
    .filter((s) => s !== undefined);

  const capCards = capabilities
    .map((cap) => {
      const people = cap.people
        .map((pid) => registry.people.find((p) => p.id === pid)?.name ?? pid)
        .join(", ");

      return `
        <div class="rounded-lg border border-slate-700 bg-slate-800/50 p-4">
          <div class="flex items-center justify-between">
            <h4 class="text-sm font-semibold text-emerald-400">${cap.name}</h4>
            <span class="text-xs text-slate-400">Confidence: ${cap.confidence}</span>
          </div>
          <p class="mt-1 text-xs text-slate-400">${cap.description ?? ""}</p>
          <div class="mt-2 flex items-center gap-3 text-xs text-slate-500">
            <span>People: ${people}</span>
            <span>Status: ${cap.status}</span>
          </div>
        </div>`;
    })
    .join("");

  const serviceSection =
    services.length > 0
      ? `
        <div class="mt-3">
          <p class="text-xs text-slate-500 mb-1">Related services:</p>
          <div class="flex flex-wrap gap-2">
            ${services
              .map(
                (s) =>
                  `<span class="text-xs rounded-full bg-slate-700 px-2 py-1 text-slate-300">${s!.name}</span>`,
              )
              .join("")}
          </div>
        </div>`
      : "";

  return `
    <section class="mt-8 rounded-xl border border-emerald-800/30 bg-slate-900/50 p-6">
      <h3 class="text-lg font-bold text-slate-100">Relevant Engineering Capabilities</h3>
      <p class="mt-1 text-sm text-slate-400">The AgentBadge team can help with what you're reading about.</p>
      <div class="mt-4 grid gap-3">
        ${capCards}
      </div>
      ${serviceSection}
      <div class="mt-4">
        <a href="/agent-guide/team/capabilities" class="inline-flex items-center text-sm font-medium text-emerald-400 hover:text-emerald-300">
          View all capabilities →
        </a>
      </div>
    </section>`;
}
