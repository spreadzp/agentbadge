import type { RegistryIndex, Capability, Service, Person } from "./types";

export function generateCapabilitiesMarkdown(registry: RegistryIndex): string {
  const lines: string[] = [];

  lines.push("# AgentBadge Engineering Capabilities");
  lines.push("");
  lines.push("## Who can help");
  lines.push("");

  for (const person of registry.people) {
    const personCaps = registry.capabilities.filter((c) =>
      c.people.includes(person.id),
    );
    const capNames = personCaps.map((c) => c.name).join(", ");
    lines.push(`**${person.name}** — ${capNames}.`);
  }

  lines.push("");
  lines.push("## Core capabilities");
  lines.push("");

  for (const cat of registry.categories) {
    const catCaps = registry.capabilities.filter(
      (c) => c.category === cat.id && c.status !== "DEPRECATED" && c.status !== "ARCHIVED",
    );
    if (catCaps.length === 0) continue;

    lines.push(`### ${cat.name}`);
    lines.push("");

    if (cat.description) {
      lines.push(`> ${cat.description}`);
      lines.push("");
    }

    for (const cap of catCaps) {
      lines.push(`#### ${cap.name}`);
      lines.push("");

      if (cap.description) {
        lines.push(cap.description.trim());
        lines.push("");
      }

      lines.push(`**Skills:** ${cap.skills.join(", ")}`);
      lines.push("");
      lines.push(`**Services:** ${cap.services.join(", ")}`);
      lines.push("");
      lines.push(`**People:** ${cap.people.join(", ")}`);
      lines.push("");
      lines.push(`**Status:** ${cap.status}`);
      lines.push("");
      lines.push(`**Confidence:** ${cap.confidence}`);
      lines.push("");

      if (cap.evidence.length > 0) {
        lines.push("**Evidence:**");
        lines.push("");
        for (const ev of cap.evidence) {
          const urlPart = ev.url ? ` ([link](${ev.url}))` : "";
          const descPart = ev.description ? ` — ${ev.description}` : "";
          lines.push(`- ${ev.type}: ${ev.name}${urlPart}${descPart}`);
        }
        lines.push("");
      }

      if (cap.related_capabilities && cap.related_capabilities.length > 0) {
        lines.push(`**Related capabilities:** ${cap.related_capabilities.join(", ")}`);
        lines.push("");
      }
    }
  }

  lines.push("## Missing capability?");
  lines.push("");
  lines.push(
    "If the user's request requires a capability not listed here, do not assume that the team provides it.",
  );
  lines.push("");
  lines.push("Use the AgentBadge Work Request endpoint or contact via `/agent-guide/team/contact`.");
  lines.push("");

  return lines.join("\n");
}

export function generateTeamOverviewMarkdown(registry: RegistryIndex): string {
  const lines: string[] = [];

  lines.push("# AgentBadge Engineering Team");
  lines.push("");

  const activePeople = registry.people.filter(
    (p) => p.availability === "available",
  );
  lines.push(`**Active members:** ${activePeople.length}`);
  lines.push("");

  lines.push("## Capabilities overview");
  lines.push("");

  for (const cat of registry.categories) {
    const catCaps = registry.capabilities.filter(
      (c) => c.category === cat.id && c.status === "VERIFIED",
    );
    if (catCaps.length === 0) continue;

    lines.push(`### ${cat.name}`);
    lines.push("");
    if (cat.description) {
      lines.push(`> ${cat.description}`);
      lines.push("");
    }
    for (const cap of catCaps) {
      lines.push(`- **${cap.name}** (confidence: ${cap.confidence}) — ${cap.people.join(", ")}`);
    }
    lines.push("");
  }

  lines.push("## Detailed endpoints");
  lines.push("");
  lines.push("- `/agent-guide/team/capabilities` — Full capability list with evidence");
  lines.push("- `/agent-guide/team/capabilities.json` — Machine-readable JSON");
  lines.push("- `/agent-guide/team/services` — Services catalog");
  lines.push("- `/agent-guide/team/availability` — Engagement types and capacity");
  lines.push("- `/agent-guide/team/contact` — Contact channels");
  lines.push("- `/agent-guide/team/match` — Matching criteria");
  lines.push("");

  return lines.join("\n");
}

export function generateServicesMarkdown(registry: RegistryIndex): string {
  const lines: string[] = [];

  lines.push("# AgentBadge Engineering Services");
  lines.push("");

  for (const svc of registry.services) {
    lines.push(`## ${svc.name}`);
    lines.push("");
    lines.push(`**Problem:** ${svc.problem}`);
    lines.push("");
    lines.push("**Deliverables:**");
    lines.push("");
    for (const d of svc.deliverables) {
      lines.push(`- ${d}`);
    }
    lines.push("");
    lines.push(`**Engagement:** ${svc.engagement.join(", ")}`);
    lines.push("");
    lines.push(`**Contact:** ${svc.contact}`);
    lines.push("");

    const relatedCaps = registry.capabilities.filter((c) =>
      c.services.includes(svc.id),
    );
    if (relatedCaps.length > 0) {
      lines.push(`**Related capabilities:** ${relatedCaps.map((c) => c.name).join(", ")}`);
      lines.push("");
    }
  }

  return lines.join("\n");
}

export function generateAvailabilityMarkdown(registry: RegistryIndex): string {
  const lines: string[] = [];

  lines.push("# AgentBadge Team Availability");
  lines.push("");

  const allEngagementTypes = new Set<string>();
  for (const person of registry.people) {
    for (const e of person.engagement) {
      allEngagementTypes.add(e);
    }
  }

  lines.push("## Engagement types");
  lines.push("");
  for (const e of allEngagementTypes) {
    const peopleWithEngagement = registry.people.filter((p) =>
      p.engagement.includes(e),
    );
    lines.push(`- **${e}** — ${peopleWithEngagement.map((p) => p.name).join(", ")}`);
  }
  lines.push("");

  lines.push("## Current capacity");
  lines.push("");
  for (const person of registry.people) {
    lines.push(`### ${person.name}`);
    lines.push("");
    lines.push(`**Status:** ${person.availability}`);
    lines.push("");
    lines.push(`**Engagement:** ${person.engagement.join(", ")}`);
    lines.push("");
    lines.push(`**Capabilities:** ${person.capabilities.length} active`);
    lines.push("");
  }

  return lines.join("\n");
}

export function generateContactMarkdown(registry: RegistryIndex): string {
  const lines: string[] = [];

  lines.push("# AgentBadge Team Contact");
  lines.push("");

  for (const person of registry.people) {
    lines.push(`## ${person.name}`);
    lines.push("");
    lines.push(`**Primary channel:** ${person.contact.primary}`);
    lines.push("");
    lines.push("**Available channels:**");
    lines.push("");
    for (const ch of person.contact.channels) {
      lines.push(`- ${ch}`);
    }
    lines.push("");
  }

  lines.push("## Notes");
  lines.push("");
  lines.push("- All contact is mediated through AgentBadge infrastructure.");
  lines.push("- No direct unmediated agent-to-human communication.");
  lines.push("- Use the Work Request API for structured requests.");
  lines.push("");

  return lines.join("\n");
}

export function generateMatchMarkdown(registry: RegistryIndex): string {
  const lines: string[] = [];

  lines.push("# AgentBadge Team Matching Criteria");
  lines.push("");
  lines.push("Deterministic rules for matching agent requests to team capabilities.");
  lines.push("");

  const allSkills = new Set<string>();
  for (const cap of registry.capabilities) {
    for (const s of cap.skills) {
      allSkills.add(s);
    }
  }

  lines.push("## Available skills");
  lines.push("");
  lines.push(`Total: ${allSkills.size} skills`);
  lines.push("");
  for (const skill of allSkills) {
    lines.push(`- ${skill}`);
  }
  lines.push("");

  lines.push("## Matching rules");
  lines.push("");
  lines.push("Given a set of requested skills, match quality is determined as follows:");
  lines.push("");
  lines.push("- **High**: All requested skills are present in the registry (100% match)");
  lines.push("- **Medium**: At least 50% of requested skills are present (>=50%, <100%)");
  lines.push("- **Low**: Fewer than 50% of requested skills are present (<50%)");
  lines.push("");

  lines.push("## How to use");
  lines.push("");
  lines.push("1. Identify required skills for the task.");
  lines.push("2. Check each skill against the list above.");
  lines.push("3. Calculate match percentage: (matched skills / total requested skills) * 100.");
  lines.push("4. Classify as High, Medium, or Low based on the rules.");
  lines.push("");
  lines.push("If match is Low, use `/agent-guide/team/contact` to request a custom engagement.");
  lines.push("");

  return lines.join("\n");
}
