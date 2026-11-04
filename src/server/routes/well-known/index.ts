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
import { taskReceiptSchemaRoutes } from "./task-receipt-schema";
import { gecClientRoutes, gecCallbackRoutes } from "./gec-client";
import { machineDescriptorRoutes } from "./machine-descriptor";

// buildAgentCard moved to lib/agent-discovery (SLICE-178-2) —
// re-exported for the old import path; new signature takes DiscoverySources
// and returns a JSON string.
export { buildAgentCard } from "../../lib/agent-discovery";
export { buildAiSitemap, buildSitemap } from "./sitemaps";

import { srcAttribution } from "../../middleware/src-attribution";

export const wellKnownRoutes = new Hono();

// SLICE-206-12: ?src= attribution on every well-known/skill entry point.
wellKnownRoutes.use(srcAttribution());

wellKnownRoutes.route("/", agentCardRoutes);
wellKnownRoutes.route("/", sitemapRoutes);
wellKnownRoutes.route("/", discoveryRoutes);
wellKnownRoutes.route("/", identityRoutes);
wellKnownRoutes.route("/", policyRoutes);
wellKnownRoutes.route("/", agentDocsRoutes);
wellKnownRoutes.route("/", taskReceiptSchemaRoutes);
wellKnownRoutes.route("/", verificationDocsRoutes);
wellKnownRoutes.route("/", gecClientRoutes); // EPIC-205: /.well-known/gec-client.json CIMD
wellKnownRoutes.route("/", gecCallbackRoutes); // EPIC-205: /api/gec/callback OAuth stub
wellKnownRoutes.route("/", machineDescriptorRoutes); // EPIC-206: /.well-known/agentbadge-machine.json
