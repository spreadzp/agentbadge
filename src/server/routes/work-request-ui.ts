/**
 * Human UI routes for work request review.
 *
 * SLICE-46-11: GET /work-requests/{id} — private page to review and respond.
 * POST /work-requests/{id}/accept  — status → accepted
 * POST /work-requests/{id}/ask     — status → needs_information
 * POST /work-requests/{id}/decline — status → declined
 */

import { Hono } from "hono";
import { workRequestStore } from "../services/work-request-store";
import { WorkRequestDetailPage } from "../../views/work-request-detail-page";

export const workRequestUiRoutes = new Hono();

// GET /work-requests/:id — render detail page
workRequestUiRoutes.get("/work-requests/:id", (c) => {
  const id = c.req.param("id");
  const record = workRequestStore.get(id);

  if (!record) {
    return c.html(
      '<!DOCTYPE html><html><body><h1>404 — Work request not found</h1><p>The request may have expired or been removed.</p></body></html>',
      404,
    );
  }

  return c.html(WorkRequestDetailPage(record).toString());
});

// POST /work-requests/:id/accept
workRequestUiRoutes.post("/work-requests/:id/accept", async (c) => {
  const id = c.req.param("id");
  const record = workRequestStore.updateStatus(id, "accepted");

  if (!record) {
    return c.html("<h1>404 — Work request not found</h1>", 404);
  }

  return c.html(WorkRequestDetailPage(record).toString());
});

// POST /work-requests/:id/ask — needs_information
workRequestUiRoutes.post("/work-requests/:id/ask", async (c) => {
  const id = c.req.param("id");
  const record = workRequestStore.updateStatus(id, "needs_information");

  if (!record) {
    return c.html("<h1>404 — Work request not found</h1>", 404);
  }

  return c.html(WorkRequestDetailPage(record).toString());
});

// POST /work-requests/:id/decline
workRequestUiRoutes.post("/work-requests/:id/decline", async (c) => {
  const id = c.req.param("id");
  const record = workRequestStore.updateStatus(id, "declined");

  if (!record) {
    return c.html("<h1>404 — Work request not found</h1>", 404);
  }

  return c.html(WorkRequestDetailPage(record).toString());
});
