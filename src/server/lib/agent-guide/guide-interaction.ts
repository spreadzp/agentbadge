/**
 * EPIC-233 (SLICE-233-7): marketplace-guide part for the Agent
 * Interaction Protocol — thin wrapper over the shared section builder
 * (lib/agent-interaction/guide-section.ts renders from the registry).
 */
import { agentInteractionGuideSection } from "../agent-interaction/guide-section";

export function guideInteractionPart(args: { baseUrl: string }): string {
  return agentInteractionGuideSection(args.baseUrl);
}
