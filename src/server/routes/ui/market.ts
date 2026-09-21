// EPIC-140 (SLICE-140-15): marketplace task board + medical demo — extracted from routes/ui.ts.
import { Hono } from "hono";
import { html } from "hono/html";
import { MedicalDemoPage } from "../../../views/medical-demo-page";
import { MarketplaceTaskBoardFragment, TaskDetailsFragment, TaskMessagesFragment, EscrowPanel } from "../../../views/marketplace-fragment";
import { normalizeTask, normalizeTasks } from "../../lib/market-task.js";
import { PageTitles } from "../../lib/page-titles";
import { PageMeta as PageMetaRegistry } from "../../lib/page-meta";
import { jobPostingLd, defaultCoreSchemas } from "../../lib/json-ld";
import { getAcceptedFormat } from "../../lib/content-negotiation";
import { isValidA2ADid, prepareA2ATopicMessage, signTransactionBytes, submitSignedTopicMessage } from "@agentbadge/hedera-core";
import { getConversation as getA2AConversation, a2aUpsert as a2aCacheUpsert, listTasks as marketListTasks } from "@agentbadge/passport";
import { marketGet } from "@agentbadge/passport";
import { wrapFragment } from "./helpers";

export const marketUiRoutes = new Hono();

marketUiRoutes.get("/ui/medical-demo", (c) => {
  return c.html(MedicalDemoPage().toString());
});

marketUiRoutes.get("/ui/medical-demo/:taskId", (c) => {
  const taskId = c.req.param("taskId");
  const task = marketGet(taskId);
  if (!task) {
    return c.html(
      MedicalDemoPage().toString(),
    );
  }
  return c.html(MedicalDemoPage(task).toString());
});

marketUiRoutes.get("/ui/market/tasks", (c) => {
  const offset = parseInt(c.req.query("offset") ?? "0", 10) || 0;
  const capability = c.req.query("capability") || undefined;
  const result = marketListTasks({ offset, limit: 100, capability });

  if (getAcceptedFormat(c) === "json") {
    return c.json({ tasks: result.tasks, count: result.tasks.length, total: result.total, limit: 100, offset });
  }

  const fragment = MarketplaceTaskBoardFragment(normalizeTasks(result.tasks));
  return c.html(wrapFragment(c, fragment.toString(), PageTitles["/ui/market/tasks"], PageMetaRegistry["/ui/market/tasks"]));
});

marketUiRoutes.get("/ui/market/tasks/:id", (c) => {
  const taskId = c.req.param("id");
  const task = marketGet(taskId);
  if (!task) {
    return c.html(
      wrapFragment(
        c,
        html`<div class="rounded-lg border border-slate-800 bg-slate-900 p-6 text-center text-slate-400">
          <p>Task not found.</p>
        </div>`.toString(),
      ),
      404,
    );
  }
  const viewerDid = c.req.query("did") ?? "";
  const otherDid = viewerDid === task.posterDid
    ? (task.claimerDid ?? task.posterDid)
    : task.posterDid;
  const messages = viewerDid ? getA2AConversation(viewerDid, otherDid) : [];
  const fragment = TaskDetailsFragment(normalizeTask(task), viewerDid || undefined, messages);
  const pollUrl = `/ui/market/tasks/${taskId}/fragment${viewerDid ? `?did=${encodeURIComponent(viewerDid)}` : ""}`;
  const wrapped = html`<div class="htmx-poll-wrapper" hx-get="${pollUrl}" hx-trigger="every 10s" hx-swap="outerHTML">
    ${fragment}
  </div>`;
  const entitySchemas = [...defaultCoreSchemas(), jobPostingLd(task)];
  return c.html(wrapFragment(c, wrapped.toString(), "Task Details", undefined, entitySchemas));
});

marketUiRoutes.get("/ui/market/tasks/:id/fragment", (c) => {
  const taskId = c.req.param("id");
  const task = marketGet(taskId);
  if (!task) {
    return c.html('<div class="rounded-lg border border-slate-800 bg-slate-900 p-6 text-center text-slate-400"><p>Task not found.</p></div>');
  }
  const viewerDid = c.req.query("did") ?? "";
  const otherDid = viewerDid === task.posterDid
    ? (task.claimerDid ?? task.posterDid)
    : task.posterDid;
  const messages = viewerDid ? getA2AConversation(viewerDid, otherDid) : [];
  const fragment = TaskDetailsFragment(normalizeTask(task), viewerDid || undefined, messages);
  const pollUrl = `/ui/market/tasks/${taskId}/fragment${viewerDid ? `?did=${encodeURIComponent(viewerDid)}` : ""}`;
  return c.html(html`<div class="htmx-poll-wrapper" hx-get="${pollUrl}" hx-trigger="every 10s" hx-swap="outerHTML">
    ${fragment}
  </div>`.toString());
});

marketUiRoutes.get("/ui/market/tasks/:id/escrow-fragment", (c) => {
  const taskId = c.req.param("id");
  const task = marketGet(taskId);
  if (!task) {
    return c.html('<div class="rounded-lg border border-slate-800 bg-slate-900 p-4 text-center text-slate-400"><p>Task not found.</p></div>');
  }
  const viewerDid = c.req.query("did") ?? "";
  return c.html(EscrowPanel(normalizeTask(task), viewerDid || undefined).toString());
});

marketUiRoutes.get("/ui/market/tasks/:id/result", (c) => {
  const taskId = c.req.param("id");
  const task = marketGet(taskId);
  if (!task) {
    return c.text("Task not found", 404);
  }
  if (!task.resultBody) {
    return c.text("No delivery result available", 404);
  }
  const trimmed = task.resultBody.trim();
  if (
    trimmed.startsWith("<!DOCTYPE") ||
    trimmed.startsWith("<html") ||
    (trimmed.startsWith("<") && trimmed.includes("<body"))
  ) {
    return c.html(task.resultBody);
  }
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    return c.json(JSON.parse(trimmed));
  }
  return c.text(task.resultBody);
});

marketUiRoutes.post("/ui/market/tasks/:id/send-message", async (c) => {
  const taskId = c.req.param("id");
  const task = marketGet(taskId);
  if (!task) {
    return c.html(
      html`<div class="rounded-lg border border-red-800 bg-red-900 p-4 text-sm text-red-200">
        Task not found.
      </div>`.toString(),
      404,
    );
  }

  const formData = await c.req.formData();
  const from = (formData.get("from") as string) ?? "";
  const to = (formData.get("to") as string) ?? "";
  const body = (formData.get("body") as string) ?? "";
  const fromAccountId = (formData.get("fromAccountId") as string) ?? "";
  const privateKey = (formData.get("privateKey") as string) ?? "";

  if (!from || !to || !body) {
    return c.html(
      html`<div id="task-messages" class="space-y-3">
        <div class="rounded-lg border border-red-800 bg-red-900 p-3 text-sm text-red-200">
          Missing from, to, or body.
        </div>
      </div>`.toString(),
    );
  }

  if (!fromAccountId || !privateKey) {
    return c.html(
      html`<div id="task-messages" class="space-y-3">
        <div class="rounded-lg border border-red-800 bg-red-900 p-3 text-sm text-red-200">
          Missing fromAccountId or privateKey for signed submission.
        </div>
      </div>`.toString(),
    );
  }

  if (!isValidA2ADid(from) || !isValidA2ADid(to)) {
    return c.html(
      html`<div id="task-messages" class="space-y-3">
        <div class="rounded-lg border border-red-800 bg-red-900 p-3 text-sm text-red-200">
          Invalid DID format.
        </div>
      </div>`.toString(),
    );
  }

  try {
    const timestamp = Math.floor(Date.now() / 1000);
    const message = {
      type: "a2a_message" as const,
      from,
      to,
      body,
      contentType: "text/plain",
      timestamp,
    };
    const { txBytes } = await prepareA2ATopicMessage(fromAccountId, message);
    const { signature, publicKey } = signTransactionBytes(txBytes, privateKey);
    const sigB64Array = JSON.parse(signature) as string[];
    const signatureBytes = sigB64Array.map((s) => new Uint8Array(Buffer.from(s, "base64")));
    const txId = await submitSignedTopicMessage(txBytes, publicKey, signatureBytes);
    const consensusTimestamp = `pending-consensus:${txId}`;
    a2aCacheUpsert({ ...message, txId, consensusTimestamp });
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : "HCS submission failed";
    return c.html(
      html`<div id="task-messages" class="space-y-3">
        <div class="rounded-lg border border-red-800 bg-red-900 p-3 text-sm text-red-200">
          Failed to send: ${errMsg}
        </div>
      </div>`.toString(),
    );
  }

  const messages = getA2AConversation(from, task.posterDid);
  const fragment = TaskMessagesFragment(normalizeTask(task), messages, from);
  return c.html(fragment.toString());
});
