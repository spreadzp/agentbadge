/**
 * /agency.json — Canonical machine-readable agency profile (SLICE-56-7)
 *
 * Source of truth for AI agents and integrators. Built from the Capability Registry.
 * Schema: A-minimal (v1) → C-proofs → B-extended (future: SLA, regions, pricing-hints).
 */

import { Hono } from "hono";
import { getRegistry } from "../registry/loader";
import { AGENCY_BRAND } from "../lib/agency-config";
import { BASE_URL } from "../lib/page-meta";
import { openApiConfig } from "../openapi";

export const agencyJsonRoutes = new Hono();

agencyJsonRoutes.get("/agency.json", async (c) => {
  try {
    const registry = await getRegistry();

    const services = registry.services.map((svc) => ({
      id: svc.id,
      name: svc.name,
      problem: svc.problem,
      deliverables: svc.deliverables,
      engagement: svc.engagement,
      contact: svc.contact,
    }));

    const capabilities = registry.capabilities.map((cap) => ({
      id: cap.id,
      name: cap.name,
      category: cap.category,
      description: cap.description ?? null,
      status: cap.status,
      confidence: cap.confidence,
      evidence: cap.evidence.map((e) => ({
        type: e.type,
        name: e.name,
        url: e.url ?? null,
        description: e.description ?? null,
      })),
      skills: cap.skills,
      services: cap.services,
    }));

    const people = registry.people.map((p) => ({
      id: p.id,
      name: p.name,
      roles: p.roles,
      capabilities: p.capabilities,
      engagement: p.engagement,
      availability: p.availability,
      contact: p.contact,
    }));

    const agency = {
      schema_version: "1.0.0",
      registry_version: registry.schema_version,
      name: AGENCY_BRAND.name,
      tagline: AGENCY_BRAND.tagline,
      description: AGENCY_BRAND.description,
      base_url: BASE_URL,
      endpoints: {
        agent_guide: `${BASE_URL}/agent-guide`,
        agent_guide_team: `${BASE_URL}/agent-guide/team`,
        agent_guide_json: `${BASE_URL}/agent-guide.json`,
        knowledge_map: `${BASE_URL}/agent-guide/knowledge-map.json`,
        openapi: `${BASE_URL}/api/specs`,
        agent_card: `${BASE_URL}/.well-known/agent-card.json`,
        mcp: `${BASE_URL}/.well-known/mcp.json`,
        llms_txt: `${BASE_URL}/llms.txt`,
        ai_sitemap: `${BASE_URL}/ai-sitemap.xml`,
        services: `${BASE_URL}/agent-guide/team/services`,
        capabilities: `${BASE_URL}/agent-guide/team/capabilities`,
        availability: `${BASE_URL}/agent-guide/team/availability`,
        contact: `${BASE_URL}/agent-guide/team/contact`,
        match: `${BASE_URL}/agent-guide/team/match`,
      },
      api_version: openApiConfig.info.version,
      services,
      capabilities,
      people,
      generated_at: new Date().toISOString(),
    };

    return c.json(agency, 200, {
      "Cache-Control": "public, max-age=300",
    });
  } catch (err) {
    return c.json(
      {
        error: "Registry not available",
        detail: String(err),
      },
      503,
    );
  }
});
