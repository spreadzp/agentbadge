// EPIC-140 (SLICE-140-13): well-known routes split into domain modules.
// wellKnownRoutes mounts each sub-app at "/" — paths are distinct, order is
// behavior-neutral. Public builder functions re-exported for old import path.
import { Hono } from "hono";
import { agentCardRoutes } from "./agent-card";
import { sitemapRoutes } from "./sitemaps";
import { discoveryRoutes } from "./discovery";
import { identityRoutes } from "./identity";
import { policyRoutes } from "./policy";
import { agentDocsRoutes } from "./agent-docs";
import { verificationDocsRoutes } from "./verification-docs";

export { buildAgentCard } from "./agent-card";
export { buildAiSitemap, buildSitemap } from "./sitemaps";

export const wellKnownRoutes = new Hono();

wellKnownRoutes.route("/", agentCardRoutes);
wellKnownRoutes.route("/", sitemapRoutes);
wellKnownRoutes.route("/", discoveryRoutes);
wellKnownRoutes.route("/", identityRoutes);
wellKnownRoutes.route("/", policyRoutes);
wellKnownRoutes.route("/", agentDocsRoutes);
wellKnownRoutes.route("/", verificationDocsRoutes);
