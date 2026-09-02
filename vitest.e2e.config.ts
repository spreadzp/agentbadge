import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/e2e/**/*.test.ts"],
    environment: "node",
    setupFiles: ["./vitest.setup.ts"],
    testTimeout: 120000,
    server: {
      deps: {
        inline: ["@agentbadge/passport"],
      },
    },
  },
});
