/**
 * SLICE-129-15: MCP tool `circle_pay` — inbound payment helper (D5).
 *
 * Two modes:
 * - Requirements: {url} → fetch the URL, decode its 402 PAYMENT-REQUIRED,
 *   return accepts[] (optionally filtered by scheme/network) so the caller
 *   knows what to sign.
 * - Verify: {url, payment} → decode the caller's base64 payment-signature
 *   payload, match it against the URL's accepts, run router.verify.
 *
 * Inbound only — the tool never executes outbound payments and never
 * settles; it only reads requirements and verifies submitted payloads.
 * Registered only when CIRCLE_PAYMENTS_ENABLED=true (setCirclePayToolConfig).
 */

import { z } from "zod";
import {
  type ToolResult,
  type NamespaceRegistry,
  getNamespace,
} from "@agentbadge/mcp";
import type {
  PaymentPayload,
  PaymentRequirements,
  PaymentRouter,
} from "@agentbadge/circle-payments";

export interface CirclePayToolConfig {
  /** Router from the circle payments runtime (verify path) */
  router: PaymentRouter;
  /** Injectable fetch (tests) */
  fetchFn?: typeof fetch;
}

let config: CirclePayToolConfig | null = null;

export function setCirclePayToolConfig(
  cfg: CirclePayToolConfig | null,
): void {
  config = cfg;
}

function getRegistry(ns?: NamespaceRegistry) {
  return ns ?? getNamespace("all")!;
}

function ok(data: unknown): ToolResult {
  return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
}

function err(msg: string): ToolResult {
  return { content: [{ type: "text", text: msg }], isError: true };
}

function b64decode<T>(s: string): T | undefined {
  try {
    return JSON.parse(Buffer.from(s, "base64").toString("utf-8")) as T;
  } catch {
    return undefined;
  }
}

interface PaymentRequiredBody {
  x402Version: number;
  resource?: { url?: string; description?: string; mimeType?: string };
  accepts: PaymentRequirements[];
  extensions?: Record<string, unknown>;
}

export async function circlePayHandler(
  args: Record<string, unknown>,
): Promise<ToolResult> {
  if (!config) {
    return err(
      "circle_pay is disabled — CIRCLE_PAYMENTS_ENABLED is not set on this server",
    );
  }
  const url = args.url as string;
  const scheme = args.scheme as string | undefined;
  const network = args.network as string | undefined;
  const payment = args.payment as string | undefined;

  const fetchFn = config.fetchFn ?? fetch;
  let resp: Response;
  try {
    resp = await fetchFn(url);
  } catch (e) {
    return err(`Failed to fetch ${url}: ${e instanceof Error ? e.message : e}`);
  }
  if (resp.status !== 402) {
    return err(
      `URL is not payment-gated (HTTP ${resp.status}) — no payment required`,
    );
  }
  const header = resp.headers.get("PAYMENT-REQUIRED");
  if (!header) {
    return err("402 response missing PAYMENT-REQUIRED header");
  }
  const body = b64decode<PaymentRequiredBody>(header);
  if (!body?.accepts?.length) {
    return err("PAYMENT-REQUIRED header has no accepts[]");
  }

  const accepts = body.accepts.filter(
    (a) =>
      (!scheme || a.scheme === scheme) && (!network || a.network === network),
  );

  // Mode A — requirements only
  if (!payment) {
    return ok({
      x402Version: body.x402Version,
      resource: body.resource,
      accepts,
      ...(body.extensions ? { extensions: body.extensions } : {}),
    });
  }

  // Mode B — verify submitted payload
  const payload = b64decode<PaymentPayload>(payment);
  if (!payload?.accepted) {
    return err("Invalid payment payload — expected base64 JSON with `accepted`");
  }
  const accepted = payload.accepted;
  const requirement = accepts.find(
    (a) =>
      a.scheme === accepted.scheme &&
      a.network === accepted.network &&
      a.asset === accepted.asset,
  );
  if (!requirement) {
    return err(
      `Payment payload accepted scheme/network/asset does not match any advertised accepts (got ${accepted.scheme} on ${accepted.network})`,
    );
  }
  try {
    const result = await config.router.verify(payload, requirement);
    return ok(result);
  } catch (e) {
    return err(
      `Verification failed: ${e instanceof Error ? e.message : String(e)}`,
    );
  }
}

export function registerCirclePayTools(ns?: NamespaceRegistry): void {
  const r = getRegistry(ns);
  r.registerTool(
    "circle_pay",
    "Circle nanopayments helper (inbound only). Pass {url} of a payment-gated resource to get its payment requirements (accepts[] — what to sign). Optionally filter by scheme/network. Pass {url, payment} with a base64 payment-signature payload to verify it against the resource requirements before submitting. Never executes outbound payments or settles.",
    {
      url: z
        .string()
        .describe("URL of the payment-gated resource (must return HTTP 402)"),
      scheme: z
        .string()
        .optional()
        .describe(
          "Filter accepts by scheme: exact | gateway | eip3009-client-broadcast",
        ),
      network: z
        .string()
        .optional()
        .describe("Filter accepts by CAIP-2 network (e.g. eip155:84532)"),
      payment: z
        .string()
        .optional()
        .describe(
          "Base64-encoded payment-signature payload to verify against the resource requirements",
        ),
    },
    circlePayHandler,
  );
}
