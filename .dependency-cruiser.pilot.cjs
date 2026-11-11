/** @type {import('dependency-cruiser').IConfiguration} */
// PILOT config: mirrors ARCHITECTURE.md §2 "May import" table.
// Not wired into gate yet — used by .windsurf/workflows/quality-gates.md Step 1.
module.exports = {
  forbidden: [
    {
      name: "views-no-logic-imports",
      comment: "Views may only import lib (data) + page-meta — never services/routes/wiring/mcp/agents",
      severity: "error",
      from: { path: "^src/views/" },
      to: {
        path: "^src/(server/(services|routes|wiring)|mcp|agents|verifiers|signer-service)/",
      },
    },
    {
      name: "routes-no-config-or-wiring",
      comment: "Routes import lib/services/views/packages — not config/env directly, not wiring",
      severity: "error",
      from: { path: "^src/server/routes/" },
      to: { path: "^src/(config/env|server/wiring)/" },
    },
    {
      name: "middleware-only-lib-config",
      comment: "Middleware may import lib, config only",
      severity: "error",
      from: { path: "^src/server/middleware/" },
      to: {
        path: "^src/(server/(routes|services|wiring)|views|mcp|agents|verifiers)/",
      },
    },
    {
      name: "config-env-is-leaf",
      comment: "config/env imports nothing outside itself",
      severity: "error",
      from: { path: "^src/config/env/" },
      to: { path: "^src/", pathNot: "^src/config/env/" },
    },
    {
      name: "mcp-no-routes-views",
      comment: "MCP tools import lib/packages — never routes/views",
      severity: "error",
      from: { path: "^src/mcp/" },
      to: { path: "^src/(server/routes|views)/" },
    },
    {
      name: "agent-readiness-no-server",
      comment: "agent-readiness imports packages/config — never routes/views",
      severity: "error",
      from: { path: "^src/agent-readiness/" },
      to: { path: "^src/(server/(routes|wiring|middleware)|views)/" },
    },
    {
      name: "agents-no-routes-views",
      comment: "agents import lib/packages — never routes/views",
      severity: "error",
      from: { path: "^src/agents/" },
      to: { path: "^src/(server/routes|views)/" },
    },
    {
      name: "verifiers-only-packages",
      comment: "verifiers import packages only (VerifierRegistry boundary)",
      severity: "error",
      from: { path: "^src/verifiers/" },
      to: {
        path: "^src/",
        pathNot: "^src/verifiers/",
      },
    },
  ],
  options: {
    doNotFollow: { path: "node_modules" },
    tsPreCompilationDeps: true,
    tsConfig: { fileName: "tsconfig.json" },
    enhancedResolveOptions: {
      exportsFields: ["exports"],
      conditionNames: ["import", "require", "node", "default"],
      extensions: [".ts", ".tsx", ".js", ".json"],
    },
    reporterOptions: {
      text: { highlightFocused: true },
    },
  },
};
