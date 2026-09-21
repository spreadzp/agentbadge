/**
 * Detect content type of resultBody and render accordingly:
 * - HTML (starts with <!DOCTYPE or <html) → render as raw HTML in an iframe container
 * - JSON (starts with { or [) → formatted <pre> block
 * - Text/Markdown → <pre> block with whitespace preserved
 */
export function renderResultBody(body: string): string {
  const trimmed = body.trim();

  // HTML detection
  if (
    trimmed.startsWith("<!DOCTYPE") ||
    trimmed.startsWith("<html") ||
    (trimmed.startsWith("<") && trimmed.includes("<body"))
  ) {
    return `<div class="mt-2 rounded-lg border border-slate-700 bg-white overflow-hidden">
      <iframe srcdoc="${body.replace(/"/g, "&quot;")}" class="w-full h-[600px] border-0" sandbox="allow-same-origin" title="Delivery Result (HTML)"></iframe>
    </div>`;
  }

  // JSON detection
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    try {
      const parsed = JSON.parse(trimmed);
      return `<pre class="mt-2 overflow-x-auto rounded bg-slate-950 p-3 text-xs text-slate-300"><code>${JSON.stringify(parsed, null, 2)}</code></pre>`;
    } catch {
      // Not valid JSON, fall through to text
    }
  }

  // Plain text / Markdown
  return `<pre class="mt-2 overflow-x-auto rounded bg-slate-950 p-3 text-xs text-slate-300 whitespace-pre-wrap">${body}</pre>`;
}
