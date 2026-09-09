import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    exclude: [
      "tests/e2e/**",
      "tests/agent-readiness/e2e/**",
    ],
    environment: "node",
    setupFiles: ["./vitest.setup.ts"],
    server: {
      deps: {
        inline: ["@agentbadge/passport", "@agentbadge/hedera-core", "@agentbadge/webmcp", "@agentbadge/evm-core"],
      },
    },
    coverage: {
      provider: "v8",
      reporter: ["text", "text-summary", "json-summary"],
      include: [
        "src/server/lib/keeperhub-*.ts",
        "src/server/routes/keeperhub*.ts",
      ],
      thresholds: {
        lines: 80,
        functions: 80,
        branches: 70,
        statements: 80,
      },
    },
  },
});
