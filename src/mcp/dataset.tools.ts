/**
 * SLICE-26-15: MCP dataset tools — download_dataset + upload_result
 *
 * Two MCP tools for LLM agents to download datasets from HFS
 * and upload report bundles to IPFS.
 */

import { z } from "zod";
import { registerTool, type ToolResult } from "@agentgate-hedera/mcp";
import { uploadReportBundle, type ReportMetadata } from "../agents/ipfs-uploader";

const SERVER_URL = process.env.SERVER_URL ?? `http://localhost:${process.env.PORT ?? 4021}`;

function ok(data: unknown): ToolResult {
  return {
    content: [{ type: "text", text: JSON.stringify(data) }],
  };
}

function error(message: string): ToolResult {
  return {
    isError: true,
    content: [{ type: "text", text: message }],
  };
}

function validationError(message: string): ToolResult {
  return {
    isError: true,
    content: [{ type: "text", text: `Validation error: ${message}` }],
  };
}

/* ── download_dataset ────────────────────────────────────────── */

const downloadDatasetSchema = z.object({
  fileId: z.string().min(1).describe("Hedera File ID (e.g., 0.0.12345)"),
  operatorId: z
    .string()
    .optional()
    .describe("Hedera operator account ID (defaults to env OPERATOR_ID)"),
  operatorKey: z
    .string()
    .optional()
    .describe("Hedera operator private key (DER hex, defaults to env OPERATOR_KEY)"),
});

export async function downloadDatasetHandler(
  args: Record<string, unknown>,
): Promise<ToolResult> {
  const parsed = downloadDatasetSchema.safeParse(args);
  if (!parsed.success) {
    return validationError(parsed.error.issues.map((i) => i.message).join("; "));
  }

  const { fileId, operatorId, operatorKey } = parsed.data;
  const opId = operatorId ?? process.env.OPERATOR_ID;
  const opKey = operatorKey ?? process.env.OPERATOR_KEY;

  if (!opId || !opKey) {
    return error("Missing operator credentials: set OPERATOR_ID and OPERATOR_KEY or pass operatorId/operatorKey");
  }

  try {
    const res = await fetch(`${SERVER_URL}/api/hfs/${fileId}`, {
      headers: {
        "x-operator-id": opId,
        "x-operator-key": opKey,
      },
    });

    if (!res.ok) {
      const text = await res.text();
      return error(`HFS download failed: ${res.status} ${text}`);
    }

    const csv = await res.text();
    return ok({ fileId, content: csv, size: csv.length });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    return error(`HFS download error: ${msg}`);
  }
}

/* ── upload_result ───────────────────────────────────────────── */

const uploadResultSchema = z.object({
  html: z.string().min(1).describe("HTML report content"),
  json: z.string().min(1).describe("JSON report content"),
  taskId: z.string().min(1).describe("Task ID"),
  agentDid: z.string().min(1).describe("Agent DID"),
  agentTier: z
    .string()
    .optional()
    .describe("Agent passport tier (bronze/silver/gold/platinum)"),
  analysisType: z.string().optional().describe("Analysis type"),
  datasetUrn: z.string().optional().describe("DataHub dataset URN"),
  ipfsApiKey: z.string().optional().describe("Pinata API key (or use env IPFS_API_KEY)"),
  ipfsApiSecret: z.string().optional().describe("Pinata API secret (or use env IPFS_API_SECRET)"),
});

export async function uploadResultHandler(
  args: Record<string, unknown>,
): Promise<ToolResult> {
  const parsed = uploadResultSchema.safeParse(args);
  if (!parsed.success) {
    return validationError(parsed.error.issues.map((i) => i.message).join("; "));
  }

  const {
    html,
    json,
    taskId,
    agentDid,
    agentTier,
    analysisType,
    datasetUrn,
    ipfsApiKey,
    ipfsApiSecret,
  } = parsed.data;

  // Override env if keys provided in args
  if (ipfsApiKey) process.env.IPFS_API_KEY = ipfsApiKey;
  if (ipfsApiSecret) process.env.IPFS_API_SECRET = ipfsApiSecret;

  const metadata: ReportMetadata = {
    taskId,
    agentDid,
    agentTier: agentTier ?? process.env.AGENT_TIER ?? "bronze",
    analysisType: analysisType ?? "descriptive",
    datasetUrn: datasetUrn ?? "",
    generatedAt: new Date().toISOString(),
  };

  try {
    const uri = await uploadReportBundle(html, json, metadata);
    const cid = uri.replace("ipfs://", "");
    return ok({ cid, uri });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    return error(`IPFS upload error: ${msg}`);
  }
}

/* ── Registration ────────────────────────────────────────────── */

export function registerDatasetTools(): void {
  registerTool(
    "download_dataset",
    "Download a CSV dataset from Hedera File Service (HFS) by fileId. Returns the raw CSV content as a string.",
    {
      fileId: z.string().min(1).describe("Hedera File ID (e.g., 0.0.12345)"),
      operatorId: z
        .string()
        .optional()
        .describe("Hedera operator account ID (defaults to env OPERATOR_ID)"),
      operatorKey: z
        .string()
        .optional()
        .describe("Hedera operator private key (DER hex, defaults to env OPERATOR_KEY)"),
    },
    downloadDatasetHandler,
  );

  registerTool(
    "upload_result",
    "Upload an HTML+JSON report bundle to IPFS via Pinata. Returns { cid, uri } where uri = ipfs://{cid}.",
    {
      html: z.string().min(1).describe("HTML report content"),
      json: z.string().min(1).describe("JSON report content"),
      taskId: z.string().min(1).describe("Task ID"),
      agentDid: z.string().min(1).describe("Agent DID"),
      agentTier: z
        .string()
        .optional()
        .describe("Agent passport tier (bronze/silver/gold/platinum)"),
      analysisType: z.string().optional().describe("Analysis type"),
      datasetUrn: z.string().optional().describe("DataHub dataset URN"),
      ipfsApiKey: z.string().optional().describe("Pinata API key (or use env IPFS_API_KEY)"),
      ipfsApiSecret: z
        .string()
        .optional()
        .describe("Pinata API secret (or use env IPFS_API_SECRET)"),
    },
    uploadResultHandler,
  );
}
