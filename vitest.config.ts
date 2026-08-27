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
        inline: ["@agentgate-hedera/passport", "@agentgate-hedera/hedera-core"],
      },
    },
  },
});
