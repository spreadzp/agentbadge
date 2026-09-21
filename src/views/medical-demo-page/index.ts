import { html, raw } from "hono/html";
import { Layout } from "../layout";
import { PageHeader } from "../page-header";
import { PageMeta } from "../../server/lib/page-meta";
import type { CachedMarketTask } from "@agentbadge/hedera-core";
import { TaskBanner } from "./task-banner";
import { WorkflowSection, AgentsSection, LiveDemoSection, QuickGenerateSection, PimaSection } from "./demo-sections";
import { DataFormatsSection, ReportStructureSection, ApiEndpointsSection, PassportSection, CliSection } from "./info-sections";
import { DEMO_SCRIPT } from "./demo-script";

/**
 * Medical Data Skills demo page — shows the full agent-to-agent medical data
 * processing workflow: consumer generates data → posts task → provider claims →
 * processes → delivers HTML report → consumer receives & settles payment.
 *
 * When `task` is provided, shows live task data and status.
 * Includes interactive demo buttons (HTMX) and data format reference.
 */
export function MedicalDemoPage(task?: CachedMarketTask) {
  const content = html`${raw(
    PageHeader({
      badge: "Medical Data Marketplace",
      title: "Medical Data Skills",
      description:
        "Agent-to-agent medical data processing workflow. A consumer agent generates patient data, posts a marketplace task, and a provider agent analyzes it — returning a professional HTML medical report.",
    }).toString(),
  )}

    ${task ? raw(TaskBanner(task).toString()) : ""}

    ${WorkflowSection()}

    ${AgentsSection()}

    ${LiveDemoSection()}

    ${QuickGenerateSection()}

    ${PimaSection()}

    ${DataFormatsSection()}

    ${ReportStructureSection()}

    ${ApiEndpointsSection()}

    ${PassportSection()}

    ${CliSection()}

    ${raw(DEMO_SCRIPT)}`;

  return Layout(content.toString(), "Medical Data Demo", PageMeta["/ui/medical-demo"], undefined, true);
}
