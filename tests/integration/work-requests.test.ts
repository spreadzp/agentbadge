import { describe, it, expect, beforeEach } from "vitest";
import { makeTestApp, setupMockEnv } from "../e2e/helpers";
import { workRequestStore } from "../../src/server/services/work-request-store";
import { resetRateLimits } from "../../src/server/routes/api/work-requests";

setupMockEnv();
const app = makeTestApp();

describe("SLICE-46-14: Integration — Work Request Lifecycle", () => {
  beforeEach(() => {
    workRequestStore.clear();
    resetRateLimits();
  });

  it("create → received → human review → accepted", async () => {
    // 1. Create work request
    const createRes = await app.request("/api/work-requests", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        request: {
          title: "Need Hedera smart contract audit",
          summary: "We need a security audit for our HTS contract.",
          requirements: ["Solidity expertise", "Hedera familiarity"],
        },
      }),
    });
    expect(createRes.status).toBe(202);
    const created = await createRes.json();
    expect(created.request_id).toBeDefined();
    const requestId = created.request_id;

    // 2. Verify status is "received" via API
    const getRes = await app.request(`/api/work-requests/${requestId}`);
    expect(getRes.status).toBe(200);
    const record = await getRes.json();
    expect(record.status).toBe("received");
    expect(record.request.title).toBe("Need Hedera smart contract audit");

    // 3. Human reviews via UI page
    const uiRes = await app.request(`/work-requests/${requestId}`);
    expect(uiRes.status).toBe(200);
    const html = await uiRes.text();
    expect(html).toContain("Need Hedera smart contract audit");

    // 4. Human accepts
    const acceptRes = await app.request(`/work-requests/${requestId}/accept`, {
      method: "POST",
    });
    expect(acceptRes.status).toBe(200);

    // 5. Agent polls and sees "accepted"
    const pollRes = await app.request(`/api/work-requests/${requestId}`);
    expect(pollRes.status).toBe(200);
    const finalRecord = await pollRes.json();
    expect(finalRecord.status).toBe("accepted");
  });

  it("create → human declines → agent sees declined", async () => {
    const createRes = await app.request("/api/work-requests", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        request: {
          title: "Build a DeFi dashboard",
          summary: "Need a React dashboard for DeFi pools.",
        },
      }),
    });
    const { request_id } = await createRes.json();

    // Human declines
    const declineRes = await app.request(`/work-requests/${request_id}/decline`, {
      method: "POST",
    });
    expect(declineRes.status).toBe(200);

    // Agent polls
    const pollRes = await app.request(`/api/work-requests/${request_id}`);
    const record = await pollRes.json();
    expect(record.status).toBe("declined");
  });

  it("create → human asks for info → agent sees needs_information", async () => {
    const createRes = await app.request("/api/work-requests", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        request: {
          title: "Integrate Hedera Consensus Service",
          summary: "Need HCS topic integration for messaging.",
        },
      }),
    });
    const { request_id } = await createRes.json();

    // Human asks for more info
    const askRes = await app.request(`/work-requests/${request_id}/ask`, {
      method: "POST",
    });
    expect(askRes.status).toBe(200);

    // Agent polls
    const pollRes = await app.request(`/api/work-requests/${request_id}`);
    const record = await pollRes.json();
    expect(record.status).toBe("needs_information");
  });

  it("created_at and updated_at are set correctly", async () => {
    const createRes = await app.request("/api/work-requests", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        request: {
          title: "Timestamp test",
          summary: "Verify timestamps.",
        },
      }),
    });
    const { request_id } = await createRes.json();

    const getRes = await app.request(`/api/work-requests/${request_id}`);
    const record = await getRes.json();
    expect(record.created_at).toBeDefined();
    expect(record.updated_at).toBeDefined();
    expect(record.created_at).toBe(record.updated_at);

    // Update status
    await app.request(`/work-requests/${request_id}/accept`, { method: "POST" });

    const pollRes = await app.request(`/api/work-requests/${request_id}`);
    const updated = await pollRes.json();
    expect(updated.updated_at).not.toBe(updated.created_at);
  });

  it("preferred_contact is preserved through lifecycle", async () => {
    const createRes = await app.request("/api/work-requests", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        request: {
          title: "Contact test",
          summary: "Verify contact preservation.",
        },
        preferred_contact: { channel: "email" },
      }),
    });
    const { request_id } = await createRes.json();

    const getRes = await app.request(`/api/work-requests/${request_id}`);
    const record = await getRes.json();
    expect(record.preferred_contact).toEqual({ channel: "email" });
  });

  it("non-existent request returns 404", async () => {
    const res = await app.request("/api/work-requests/non-existent-id");
    expect(res.status).toBe(404);
  });
});
