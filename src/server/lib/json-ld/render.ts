export function renderJsonLd(schemas: object[]): string {
  const json = JSON.stringify(schemas).replace(/</g, "\\u003c");
  return `<script type="application/ld+json">${json}</script>`;
}
