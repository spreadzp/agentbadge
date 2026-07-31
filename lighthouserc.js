module.exports = {
  ci: {
    collect: {
      startServerCommand: "bun run dev",
      startServerReadyPattern: "Server running on",
      url: [
        "http://localhost:4021/",
        "http://localhost:4021/agent-guide",
        "http://localhost:4021/faq",
        "http://localhost:4021/llms.txt",
      ],
      numberOfRuns: 3,
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
