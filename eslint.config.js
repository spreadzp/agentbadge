import tseslint from "@typescript-eslint/eslint-plugin";
import tsparser from "@typescript-eslint/parser";

export default [
  {
    files: ["src/**/*.ts", "tests/**/*.ts"],
    languageOptions: {
      parser: tsparser,
    },
    plugins: {
      "@typescript-eslint": tseslint,
    },
    rules: {
      ...tseslint.configs.recommended.rules,
      "@typescript-eslint/no-unused-vars": ["warn", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
      "@typescript-eslint/no-explicit-any": "warn",
    },
  },
  // FILE SIZE GUARD: hard 300-line cap on source files. New files/modules must
  // stay under the limit; see global_rules.md "FILE SIZE GUARD".
  {
    files: ["src/**/*.ts"],
    rules: {
      "max-lines": ["error", { max: 300 }],
    },
  },
  // Grandfathered files already >300 lines (EPIC-140 debt). The cap is disabled
  // for them so lint stays green; shrink below 300 and remove the entry.
  {
    files: [
      "src/agent-readiness/cli/formatters/html-output.ts",
      "src/agent-readiness/rule-bundles.ts",
      "src/agent-readiness/rule-engine/evidence-collector.ts",
      "src/agent-readiness/ruleset.ts",
      "src/agent-readiness/trust/abi/agent-passport-nft.ts",
      "src/agents/repl.ts",
      "src/agents/report/html-layout.ts",
      "src/mcp/parity-tools.ts",
      "src/server/lib/agent-guide/generator.ts",
      "src/server/lib/blog/articles/from-seo-to-geo-to-agent-readiness.ts",
      "src/server/lib/blog/articles/how-do-you-measure-agent-readiness.ts",
      "src/server/lib/blog/articles/web-becoming-agentic-api-discovery.ts",
      "src/server/lib/blog/articles/what-ai-agent-needs-to-understand-api.ts",
      "src/server/lib/blog/articles/what-is-agent-readiness.ts",
      "src/server/lib/market-handlers-lifecycle.ts",
      "src/server/lib/market-handlers-manage.ts",
      "src/server/lib/market-handlers-signed.ts",
      "src/server/lib/page-meta.ts",
      "src/server/middleware/agent-auth.ts",
      "src/server/middleware/did-auth.ts",
      "src/server/openapi.ts",
      "src/server/registry/markdown.ts",
      "src/server/routes/a2a.ts",
      "src/server/routes/agent-knowledge.ts",
      "src/server/routes/agents.ts",
      "src/server/routes/benchmark-pages.ts",
      "src/server/routes/catalog.ts",
      "src/server/routes/content-pages.ts",
      "src/server/routes/keeperhub-api.ts",
      "src/server/routes/market-guide.ts",
      "src/server/routes/market.ts",
      "src/server/routes/marketplace-api.ts",
      "src/server/routes/medical-guide.ts",
      "src/server/routes/monitoring.ts",
      "src/server/routes/trust.ts",
      "src/server/routes/ui/agents.ts",
      "src/server/routes/webmcp-api.ts",
      "src/server/routes/well-known/agent-docs.ts",
      "src/server/routes/well-known/discovery.ts",
      "src/server/routes/well-known/sitemaps.ts",
      "src/server/routes/well-known/verification-docs.ts",
      "src/server/services/html-report.service.ts",
      "src/views/landing/hackathon/ai-builders-hero.ts",
      "src/views/landing/hackathon/attestcoin-architecture.ts",
      "src/views/landing/hackathon/keeperhub-hero.ts",
      "src/views/landing/hackathon/shared.ts",
      "src/views/layout.ts",
      "src/views/marketplace-pages.ts",
      "src/views/rule-detail-page.ts",
      "src/views/service-page/scanner-script-core.ts",
    ],
    rules: {
      "max-lines": "off",
    },
  },
  // LAYER BOUNDARIES (EPIC-142, ARCHITECTURE.md §2). Views are pure
  // templates: they receive data and never import request-handling layers.
  {
    files: ["src/views/**/*.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: [
                "**/server/routes",
                "**/server/routes/**",
                "**/server/middleware",
                "**/server/middleware/**",
                "**/server/services",
                "**/server/services/**",
                "**/server/wiring",
                "**/server/wiring/**",
              ],
              message:
                "Views must not import routes/middleware/services/wiring — handlers live in server/routes, computation in server/lib.",
            },
          ],
        },
      ],
    },
  },
  // config/env is a leaf: siblings and @agentbadge/* packages only.
  {
    files: ["src/config/env/**/*.ts", "src/config/env.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: [
                "**/server/**",
                "**/views/**",
                "**/agent-readiness/**",
                "**/mcp/**",
                "**/agents/**",
                "**/verifiers/**",
              ],
              message:
                "config/env is a leaf — it must not import application layers.",
            },
          ],
        },
      ],
    },
  },
  {
    ignores: ["dist/", "node_modules/", "graphify-out/"],
  },
];
