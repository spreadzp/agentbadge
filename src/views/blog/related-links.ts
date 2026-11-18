export interface RelatedLinkItem {
  label: string;
  href: string;
  description?: string;
}

export function RelatedLinks(
  title: string,
  links: RelatedLinkItem[],
): string {
  if (links.length === 0) return "";

  const items = links
    .map(
      (link) => `
      <li>
        <a href="${link.href}" class="text-sm font-medium text-emerald-400 underline hover:text-emerald-300">${link.label}</a>
        ${link.description ? `<p class="mt-1 text-xs text-slate-400">${link.description}</p>` : ""}
      </li>`,
    )
    .join("");

  return `
    <section class="rounded-xl border border-slate-800 bg-slate-900/50 p-6">
      <h2 class="text-sm font-semibold text-slate-200">${title}</h2>
      <ul class="mt-4 space-y-3">
        ${items}
      </ul>
    </section>
  `;
}
