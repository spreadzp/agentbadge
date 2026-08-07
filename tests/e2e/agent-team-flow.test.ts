import { describe, it, expect, beforeEach } from "vitest";
import { makeTestApp, setupMockEnv } from "./helpers";
import { workRequestStore } from "../../src/server/services/work-request-store";
import { resetRateLimits } from "../../src/server/routes/api/work-requests";

setupMockEnv();
const app = makeTestApp();

describe("SLICE-46-14: E2E — Agent → Team Flow", () => {
  beforeEach(() => {
    workRequestStore.clear();
    resetRateLimits();
  });

  it("agent discovers capability → sends request → human responds → agent polls", async () => {
    // 1. Agent discovers capabilities via agent-guide
    const capsRes = await app.request("/agent-guide/team/capabilities");
    expect(capsRes.status).toBe(200);
    const capsMd = await capsRes.text();
    expect(capsMd).toContain("# AgentBadge Engineering Capabilities");

    // Agent also checks JSON format
    const capsJsonRes = await app.request("/agent-guide/team/capabilities.json");
    expect(capsJsonRes.status).toBe(200);
    const capsJson = await capsJsonRes.json();
    expect(capsJson.schema_version).toBe("1.0");
    expect(capsJson.capabilities.length).toBeGreaterThanOrEqual(1);

    // 2. Agent sends a work request
    const createRes = await app.request("/api/work-requests", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        request: {
          title: "E2E: Hedera smart contract review",
          summary: "We need a review of our HTS contract for mainnet deployment.",
          requirements: ["Hedera Native Development", "Smart Contract Security"],
        },
        preferred_contact: { channel: "email" },
      }),
    });
    expect(createRes.status).toBe(202);
    const created = await createRes.json();
    expect(created.request_id).toBeDefined();
    const requestId = created.request_id;
    expect(created.status_url).toBe(`/api/work-requests/${requestId}`);

    // 3. Human receives notification, reviews at UI page
    const uiRes = await app.request(`/work-requests/${requestId}`);
    expect(uiRes.status).toBe(200);
    const html = await uiRes.text();
    expect(html).toContain("E2E: Hedera smart contract review");
    expect(html).toContain("noindex");

    // 4. Human accepts the request
    const acceptRes = await app.request(`/work-requests/${requestId}/accept`, {
      method: "POST",
    });
    expect(acceptRes.status).toBe(200);

    // 5. Agent polls API and sees accepted status
    const pollRes = await app.request(`/api/work-requests/${requestId}`);
    expect(pollRes.status).toBe(200);
    const finalRecord = await pollRes.json();
    expect(finalRecord.status).toBe("accepted");
    expect(finalRecord.id).toBe(requestId);
    expect(finalRecord.request.title).toBe("E2E: Hedera smart contract review");
  });

  it("agent discovers → sends → human asks for info → agent sees needs_information", async () => {
    // 1. Agent checks team overview
    const overviewRes = await app.request("/agent-guide/team");
    expect(overviewRes.status).toBe(200);

    // 2. Agent sends work request
    const createRes = await app.request("/api/work-requests", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        request: {
          title: "E2E: Need more details request",
          summary: "A request that will need more information.",
        },
      }),
    });
    const { request_id } = await createRes.json();

    // 3. Human asks for more info
    const askRes = await app.request(`/work-requests/${request_id}/ask`, {
      method: "POST",
    });
    expect(askRes.status).toBe(200);

    // 4. Agent polls
    const pollRes = await app.request(`/api/work-requests/${request_id}`);
    const record = await pollRes.json();
    expect(record.status).toBe("needs_information");
  });

  it("agent discovers → sends → human declines → agent sees declined", async () => {
    const createRes = await app.request("/api/work-requests", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        request: {
          title: "E2E: Declined request",
          summary: "A request that will be declined.",
        },
      }),
    });
    const { request_id } = await createRes.json();

    // Human declines
    await app.request(`/work-requests/${request_id}/decline`, { method: "POST" });

    // Agent polls
    const pollRes = await app.request(`/api/work-requests/${request_id}`);
    const record = await pollRes.json();
    expect(record.status).toBe("declined");
  });

  it("agent can access services and availability guides", async () => {
    const servicesRes = await app.request("/agent-guide/team/services");
    expect(servicesRes.status).toBe(200);

    const availRes = await app.request("/agent-guide/team/availability");
    expect(availRes.status).toBe(200);

    const contactRes = await app.request("/agent-guide/team/contact");
    expect(contactRes.status).toBe(200);

    const matchRes = await app.request("/agent-guide/team/match");
    expect(matchRes.status).toBe(200);
  });
});
