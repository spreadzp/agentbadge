module.exports = {
  ci: {
    collect: {
      startServerCommand: "bun run dev",
      startServerReadyPattern: "Server running on",
      url: [
        "http://localhost:4021/",
        "http://localhost:4021/agent-guide",
        "http://localhost:4021/market-guide",
        "http://localhost:4021/medical-guide",
        "http://localhost:4021/faq",
        "http://localhost:4021/use-cases",
        "http://localhost:4021/changelog",
        "http://localhost:4021/terms",
        "http://localhost:4021/privacy",
        "http://localhost:4021/dashboard",
        "http://localhost:4021/ui/agents",
        "http://localhost:4021/ui/market/tasks",
        "http://localhost:4021/ui/catalog",
        "http://localhost:4021/ui/help",
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
