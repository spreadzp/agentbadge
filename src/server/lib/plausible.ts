export function getPlausibleScript(): string {
  const enabled = process.env.PLAUSIBLE_ENABLED === "true";
  const domain = process.env.PLAUSIBLE_DOMAIN;
  if (!enabled || !domain) return "";
  return `<script defer data-domain="${domain}" src="https://plausible.io/js/script.js"></script>`;
}
