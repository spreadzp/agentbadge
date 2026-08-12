/**
 * Lighthouse CI configuration — SLICE-23-7
 *
 * Runs Lighthouse against local server and fails on regressions.
 * Usage: bun run lighthouse
 *
 * Prerequisites:
 * - build:css must be run first (bun run build:css)
 * - Server starts automatically via startServerCommand
 */
module.exports = {
  ci: {
    collect: {
      startServerCommand: "bun run dev",
      startServerReadyPattern: "Listening on",
      startServerReadyTimeout: 30_000,
      url: [
        "http://localhost:4021/",
        "http://localhost:4021/agent-guide",
        "http://localhost:4021/faq",
      ],
      numberOfRuns: 3,
      settings: {
        preset: "desktop",
      },
    },
    assert: {
      assertions: {
        "categories:performance": ["error", { minScore: 0.95 }],
        "categories:accessibility": ["error", { minScore: 1.0 }],
        "categories:best-practices": ["error", { minScore: 1.0 }],
        "categories:seo": ["error", { minScore: 1.0 }],
      },
    },
    upload: {
      target: "temporary-public-storage",
    },
  },
};
