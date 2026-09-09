import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/e2e/**/*.test.ts"],
    environment: "node",
    setupFiles: ["./vitest.setup.ts"],
    testTimeout: 120000,
    server: {
      deps: {
        inline: ["@agentbadge/passport", "@agentbadge/evm-core", "@agentbadge/keeperhub", "@agentbadge/webmcp", "@agentbadge/hedera-core"],
      },
    },
  },
});
