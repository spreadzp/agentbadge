// EPIC-140 (SLICE-140-15): ui routes split into page-group modules.
// uiRoutes mounts each sub-app at "/" — paths are distinct, order is behavior-neutral.
import { Hono } from "hono";
import { dashboardRoutes } from "./dashboard";
import { agentsRoutes } from "./agents";
import { fragmentRoutes } from "./fragments";
import { a2aRoutes } from "./a2a";
import { marketUiRoutes } from "./market";

export const uiRoutes = new Hono();

uiRoutes.route("/", dashboardRoutes);
uiRoutes.route("/", agentsRoutes);
uiRoutes.route("/", fragmentRoutes);
uiRoutes.route("/", a2aRoutes);
uiRoutes.route("/", marketUiRoutes);
