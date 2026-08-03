import { Hono } from "hono";
import { generateRandomMedicalData, getMedicalDataById, getAllSamples, type MedicalData } from "../services/medical-data.service";
import { analyzeMedicalData, type AnalysisResult } from "../services/medical-processor.service";
import { generateHtmlReport } from "../services/html-report.service";
import { MedicalDataProviderAgent } from "../services/provider-agent.service";
import { MedicalDataConsumerAgent } from "../services/consumer-agent.service";
import { marketUpsert as upsert, listTasks, marketGet as getTask } from "@agentgate-hedera/passport";
import { submitTaskMessage } from "@agentgate-hedera/hedera-core";
import type { CachedMarketTask } from "@agentgate-hedera/hedera-core";
import { ErrorCodes } from "../lib/error-codes";
import { errorResponse } from "../lib/error-response";

const demo = new Hono();

const DEMO_CONSUMER_DID = "did:hcs:0.0.0:3";

const MEDICAL_TASK_TEMPLATE = {
  title: "Medical Data Analysis Service",
  description:
    "Professional medical data analysis with vital signs and lab results review. Returns detailed report with risk assessment and clinical recommendations.",
  priceHbar: 100,
  capabilities: ["medical-analysis"],
};

demo.get("/medical-data/generate", (c) => {
  const data = generateRandomMedicalData();
  return c.json(data);
});

demo.get("/medical-data/samples", (c) => {
  return c.json(getAllSamples());
});

demo.get("/medical-data/samples/:id", (c) => {
  const id = c.req.param("id");
  const sample = getMedicalDataById(id);
  if (!sample) {
    return errorResponse(c, 404, ErrorCodes.TASK_NOT_FOUND, "Sample not found");
  }
  return c.json(sample);
});

demo.post("/medical-data/process", async (c) => {
  const data = await c.req.json<MedicalData>();
  if (!data.patientId || !data.vitalSigns || !data.labResults) {
    return errorResponse(c, 400, ErrorCodes.MISSING_FIELDS, "Invalid medical data: patientId, vitalSigns, and labResults are required");
  }
  const result = analyzeMedicalData(data);
  return c.json(result);
});

demo.post("/medical-data/generate-and-process", async (c) => {
  const mode = c.req.query("mode") ?? "agent";
  const data = generateRandomMedicalData();
  const result = analyzeMedicalData(data);

  if (mode === "demo") {
    return c.json({ data, analysis: result, mode: "demo" });
  }

  // Agent mode: create marketplace task with enriched metadata
  const timestamp = Math.floor(Date.now() / 1000);
  const taskId = `task-medical-${timestamp}`;
  const datasetUrn = "urn:li:dataset:(urn:li:dataPlatform:kaggle,pima-diabetes,PROD)";

  const message = {
    type: "task_posted" as const,
    taskId,
    posterDid: DEMO_CONSUMER_DID,
    title: MEDICAL_TASK_TEMPLATE.title,
    description: `Analyze medical data for patient ${data.patientName} (ID: ${data.patientId}). ${MEDICAL_TASK_TEMPLATE.description}`,
    priceHbar: MEDICAL_TASK_TEMPLATE.priceHbar,
    capabilities: MEDICAL_TASK_TEMPLATE.capabilities,
    timestamp,
  };

  let txId: string;
  try {
    txId = await submitTaskMessage(message);
  } catch {
    txId = `0.0.5266613@${timestamp}.000000000`;
  }

  const task: CachedMarketTask = {
    taskId,
    posterDid: DEMO_CONSUMER_DID,
    title: MEDICAL_TASK_TEMPLATE.title,
    description: message.description,
    priceHbar: MEDICAL_TASK_TEMPLATE.priceHbar,
    capabilities: MEDICAL_TASK_TEMPLATE.capabilities,
    status: "posted",
    txId,
    consensusTimestamp: new Date(timestamp * 1000).toISOString(),
    createdAt: timestamp,
    verifierType: "datahub",
  };

  upsert(task);

  return c.json({
    taskId,
    mode: "agent",
    status: "posted",
    data,
    analysis: result,
    hashscanUrl: `https://hashscan.io/testnet/transaction/${txId}`,
    datahubLinks: {
      dataset: `${process.env.DATAHUB_UI_URL ?? "http://localhost:9002"}/dataset/${encodeURIComponent(datasetUrn)}`,
      lineage: `${process.env.DATAHUB_UI_URL ?? "http://localhost:9002"}/lineage/${encodeURIComponent(datasetUrn)}`,
    },
    message: "Task created in marketplace. Agent will process via CLI or workflow.",
  });
});

// ─── SLICE-11-3: HTML Report Generator ───────────────────────────

demo.post("/medical-data/report", async (c) => {
  const body = await c.req.json<{ data?: MedicalData; analysis?: AnalysisResult }>();
  if (!body.data || !body.analysis) {
    return errorResponse(c, 400, ErrorCodes.MISSING_FIELDS, "Missing required fields: data, analysis");
  }
  if (!body.data.patientId || !body.data.vitalSigns || !body.data.labResults) {
    return errorResponse(c, 400, ErrorCodes.MISSING_FIELDS, "Invalid medical data: missing required fields");
  }
  const html = generateHtmlReport(body.data, body.analysis);
  return c.html(html);
});

demo.post("/medical-data/generate-and-report", async (c) => {
  const mode = c.req.query("mode") ?? "agent";
  const data = generateRandomMedicalData();
  const analysis = analyzeMedicalData(data);
  const html = generateHtmlReport(data, analysis);

  if (mode === "demo") {
    return c.html(html);
  }

  // Agent mode: create task, return enriched JSON response
  const timestamp = Math.floor(Date.now() / 1000);
  const taskId = `task-medical-${timestamp}`;
  const datasetUrn = "urn:li:dataset:(urn:li:dataPlatform:kaggle,pima-diabetes,PROD)";

  const message = {
    type: "task_posted" as const,
    taskId,
    posterDid: DEMO_CONSUMER_DID,
    title: MEDICAL_TASK_TEMPLATE.title,
    description: `Analyze medical data for patient ${data.patientName} (ID: ${data.patientId}). ${MEDICAL_TASK_TEMPLATE.description}`,
    priceHbar: MEDICAL_TASK_TEMPLATE.priceHbar,
    capabilities: MEDICAL_TASK_TEMPLATE.capabilities,
    timestamp,
  };

  let txId: string;
  try {
    txId = await submitTaskMessage(message);
  } catch {
    txId = `0.0.5266613@${timestamp}.000000000`;
  }

  const task: CachedMarketTask = {
    taskId,
    posterDid: DEMO_CONSUMER_DID,
    title: MEDICAL_TASK_TEMPLATE.title,
    description: message.description,
    priceHbar: MEDICAL_TASK_TEMPLATE.priceHbar,
    capabilities: MEDICAL_TASK_TEMPLATE.capabilities,
    status: "posted",
    txId,
    consensusTimestamp: new Date(timestamp * 1000).toISOString(),
    createdAt: timestamp,
    verifierType: "datahub",
  };

  upsert(task);

  return c.json({
    taskId,
    mode: "agent",
    status: "posted",
    htmlReport: html,
    hashscanUrl: `https://hashscan.io/testnet/transaction/${txId}`,
    datahubLinks: {
      dataset: `${process.env.DATAHUB_UI_URL ?? "http://localhost:9002"}/dataset/${encodeURIComponent(datasetUrn)}`,
      lineage: `${process.env.DATAHUB_UI_URL ?? "http://localhost:9002"}/lineage/${encodeURIComponent(datasetUrn)}`,
      glossary: `${process.env.DATAHUB_UI_URL ?? "http://localhost:9002"}/glossary`,
      assertions: `${process.env.DATAHUB_UI_URL ?? "http://localhost:9002"}/assertions`,
    },
    message: "Task created in marketplace with DataHub verification enabled.",
  });
});

// ─── SLICE-11-4: Marketplace Task Setup ──────────────────────────

demo.post("/marketplace/seed", async (c) => {
  const timestamp = Math.floor(Date.now() / 1000);
  const taskId = `task-medical-${timestamp}`;

  const message = {
    type: "task_posted" as const,
    taskId,
    posterDid: DEMO_CONSUMER_DID,
    title: MEDICAL_TASK_TEMPLATE.title,
    description: MEDICAL_TASK_TEMPLATE.description,
    priceHbar: MEDICAL_TASK_TEMPLATE.priceHbar,
    capabilities: MEDICAL_TASK_TEMPLATE.capabilities,
    timestamp,
  };

  let txId: string;
  try {
    txId = await submitTaskMessage(message);
  } catch {
    txId = `0.0.5266613@${timestamp}.000000000`;
  }

  const task: CachedMarketTask = {
    taskId,
    posterDid: DEMO_CONSUMER_DID,
    title: MEDICAL_TASK_TEMPLATE.title,
    description: MEDICAL_TASK_TEMPLATE.description,
    priceHbar: MEDICAL_TASK_TEMPLATE.priceHbar,
    capabilities: MEDICAL_TASK_TEMPLATE.capabilities,
    status: "posted",
    txId,
    consensusTimestamp: new Date(timestamp * 1000).toISOString(),
    createdAt: timestamp,
  };

  upsert(task);

  return c.json({ taskId, task, message: "Medical analysis task seeded in marketplace" });
});

demo.post("/marketplace/task-with-patient/:patientId", async (c) => {
  const patientId = c.req.param("patientId");
  const priceHbar = Number(c.req.query("price") ?? "5");
  const mode = c.req.query("mode") ?? "agent";
  const medicalData = getMedicalDataById(patientId);

  if (!medicalData) {
    return errorResponse(c, 404, ErrorCodes.TASK_NOT_FOUND, `Patient ${patientId} not found. Use /api/demo/medical-data/samples to see available patients.`);
  }

  const timestamp = Math.floor(Date.now() / 1000);
  const taskId = `task-medical-${timestamp}`;
  const datasetUrn = mode === "agent"
    ? "urn:li:dataset:(urn:li:dataPlatform:kaggle,pima-diabetes,PROD)"
    : undefined;

  const message = {
    type: "task_posted" as const,
    taskId,
    posterDid: DEMO_CONSUMER_DID,
    title: MEDICAL_TASK_TEMPLATE.title,
    description: `Analyze medical data for patient ${medicalData.patientName} (ID: ${patientId}, Age: ${medicalData.age}). ${MEDICAL_TASK_TEMPLATE.description}`,
    priceHbar,
    capabilities: MEDICAL_TASK_TEMPLATE.capabilities,
    timestamp,
  };

  let txId: string;
  try {
    txId = await submitTaskMessage(message);
  } catch {
    txId = `0.0.5266613@${timestamp}.000000000`;
  }

  const task: CachedMarketTask = {
    taskId,
    posterDid: DEMO_CONSUMER_DID,
    title: MEDICAL_TASK_TEMPLATE.title,
    description: `Analyze medical data for patient ${medicalData.patientName} (ID: ${patientId}, Age: ${medicalData.age}). ${MEDICAL_TASK_TEMPLATE.description}`,
    priceHbar,
    capabilities: MEDICAL_TASK_TEMPLATE.capabilities,
    status: "posted",
    txId,
    consensusTimestamp: new Date(timestamp * 1000).toISOString(),
    createdAt: timestamp,
    ...(mode === "agent" ? { verifierType: "datahub" } : {}),
  };

  upsert(task);

  if (mode === "demo") {
    return c.json({ taskId, task, medicalData, mode: "demo", message: `Task created for patient ${patientId} at ${priceHbar} HBAR` });
  }

  // Agent mode: enriched response with DataHub links and HashScan
  const datahubUrl = process.env.DATAHUB_UI_URL ?? "http://localhost:9002";
  return c.json({
    taskId,
    task,
    medicalData,
    mode: "agent",
    hashscanUrl: `https://hashscan.io/testnet/transaction/${txId}`,
    datahubLinks: datasetUrn
      ? {
        dataset: `${datahubUrl}/dataset/${encodeURIComponent(datasetUrn)}`,
        lineage: `${datahubUrl}/lineage/${encodeURIComponent(datasetUrn)}`,
        glossary: `${datahubUrl}/glossary`,
        assertions: `${datahubUrl}/assertions`,
      }
      : undefined,
    message: `Task created for patient ${patientId} at ${priceHbar} HBAR (agent mode with DataHub verification)`,
  });
});

demo.get("/marketplace/tasks", (c) => {
  const capability = c.req.query("capability") || undefined;
  const { tasks, total } = listTasks({ capability, limit: 100 });
  const medicalTasks = tasks.filter((t) => t.capabilities.includes("medical-analysis"));
  return c.json({ tasks: medicalTasks, total: medicalTasks.length });
});

demo.get("/marketplace/tasks/:taskId", (c) => {
  const taskId = c.req.param("taskId");
  const task = getTask(taskId);
  if (!task) {
    return errorResponse(c, 404, ErrorCodes.TASK_NOT_FOUND, "Task not found");
  }
  return c.json(task);
});

// ─── SLICE-11-5: Provider Agent Workflow ────────────────────────

const providerAgent = new MedicalDataProviderAgent();

demo.post("/provider/register", (c) => {
  const result = providerAgent.register();
  return c.json({ message: "Provider agent registered", ...result });
});

demo.get("/provider/tasks", (c) => {
  if (!providerAgent.isRegistered) {
    return errorResponse(c, 400, ErrorCodes.MISSING_FIELDS, "Provider not registered");
  }
  const tasks = providerAgent.listenForTasks();
  return c.json({ tasks, count: tasks.length });
});

demo.post("/provider/claim/:taskId", async (c) => {
  const taskId = c.req.param("taskId");
  try {
    const task = await providerAgent.claimTask(taskId);
    return c.json({ message: "Task claimed", task });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Claim failed";
    const status = msg.includes("not found") ? 404 : msg.includes("cannot claim") ? 409 : 400;
    return errorResponse(c, status as 400 | 404 | 409, status === 404 ? ErrorCodes.TASK_NOT_FOUND : status === 409 ? ErrorCodes.TASK_ALREADY_CLAIMED : ErrorCodes.MISSING_FIELDS, msg);
  }
});

demo.post("/provider/process/:taskId", async (c) => {
  const taskId = c.req.param("taskId");
  const body = await c.req.json<{ medicalData?: MedicalData }>().catch(() => ({ medicalData: undefined }));
  const medicalData = body.medicalData ?? generateRandomMedicalData();
  try {
    const result = providerAgent.processTask(taskId, medicalData);
    return c.json({
      taskId: result.taskId,
      status: result.status,
      analysis: result.analysis,
      reportLength: result.htmlReport.length,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Processing failed";
    const status = msg.includes("not found") ? 404 : msg.includes("must be claimed") ? 409 : 400;
    return errorResponse(c, status as 400 | 404 | 409, status === 404 ? ErrorCodes.TASK_NOT_FOUND : status === 409 ? ErrorCodes.TASK_ALREADY_CLAIMED : ErrorCodes.MISSING_FIELDS, msg);
  }
});

demo.post("/provider/deliver/:taskId", async (c) => {
  const taskId = c.req.param("taskId");
  const body = await c.req.json<{ htmlReport?: string; medicalData?: MedicalData }>().catch(() => ({ htmlReport: undefined, medicalData: undefined }));
  try {
    let htmlReport = body.htmlReport;
    if (!htmlReport) {
      const medicalData = body.medicalData ?? generateRandomMedicalData();
      const processed = providerAgent.processTask(taskId, medicalData);
      htmlReport = processed.htmlReport;
    }
    const task = await providerAgent.deliverResult(taskId, htmlReport);
    return c.json({ message: "Result delivered", task, reportLength: htmlReport.length });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Delivery failed";
    const status = msg.includes("not found") ? 404 : msg.includes("must be claimed") ? 409 : 400;
    return errorResponse(c, status as 400 | 404 | 409, status === 404 ? ErrorCodes.TASK_NOT_FOUND : status === 409 ? ErrorCodes.TASK_ALREADY_CLAIMED : ErrorCodes.MISSING_FIELDS, msg);
  }
});

demo.get("/provider/payment/:taskId", (c) => {
  const taskId = c.req.param("taskId");
  try {
    const status = providerAgent.checkPaymentStatus(taskId);
    return c.json({ taskId, paymentStatus: status });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Check failed";
    return errorResponse(c, 404, ErrorCodes.TASK_NOT_FOUND, msg);
  }
});

demo.post("/provider/run-workflow/:taskId", async (c) => {
  const taskId = c.req.param("taskId");
  const body = await c.req.json<{ medicalData?: MedicalData }>().catch(() => ({ medicalData: undefined }));
  try {
    const result = await providerAgent.runFullWorkflow(taskId, body.medicalData);
    return c.json({
      taskId: result.taskId,
      claimedTask: result.claimedTask,
      deliveredTask: result.deliveredTask,
      analysis: result.analysis,
      paymentStatus: result.paymentStatus,
      reportLength: result.htmlReport.length,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Workflow failed";
    const status = msg.includes("not found") ? 404 : msg.includes("cannot claim") ? 409 : 400;
    return errorResponse(c, status as 400 | 404 | 409, status === 404 ? ErrorCodes.TASK_NOT_FOUND : status === 409 ? ErrorCodes.TASK_ALREADY_CLAIMED : ErrorCodes.MISSING_FIELDS, msg);
  }
});

// ─── SLICE-11-6: Consumer Agent Workflow ────────────────────────

const consumerAgent = new MedicalDataConsumerAgent();

demo.post("/consumer/register", (c) => {
  const result = consumerAgent.register();
  return c.json({ message: "Consumer agent registered", ...result });
});

demo.post("/consumer/post-task", async (c) => {
  const body = await c.req.json<{ medicalData?: MedicalData; priceHbar?: number }>().catch(() => ({ medicalData: undefined, priceHbar: undefined }));
  try {
    const result = await consumerAgent.postTask(body.medicalData, body.priceHbar);
    return c.json({ message: "Task posted", taskId: result.taskId, task: result.task, patientId: result.medicalData.patientId });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Post task failed";
    return errorResponse(c, 400, ErrorCodes.INTERNAL_ERROR, msg, { retryable: true });
  }
});

demo.get("/consumer/task/:taskId", (c) => {
  const taskId = c.req.param("taskId");
  try {
    const { status, task } = consumerAgent.getTaskStatus(taskId);
    return c.json({ taskId, status, task });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Status check failed";
    return errorResponse(c, 404, ErrorCodes.TASK_NOT_FOUND, msg);
  }
});

demo.get("/consumer/report/:taskId", (c) => {
  const taskId = c.req.param("taskId");
  try {
    const report = consumerAgent.receiveReport(taskId);
    if (report.htmlReport) {
      return c.html(report.htmlReport);
    }
    return c.json({ taskId, status: report.status, resultIpfs: report.resultIpfs, message: "Report available via IPFS" });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Report retrieval failed";
    const status = msg.includes("not yet delivered") ? 202 : msg.includes("not found") ? 404 : 400;
    return errorResponse(c, (status === 404 ? 404 : status === 202 ? 400 : 400) as 400 | 404, status === 404 ? ErrorCodes.TASK_NOT_FOUND : ErrorCodes.MISSING_FIELDS, msg);
  }
});

demo.post("/consumer/settle-payment/:taskId", async (c) => {
  const taskId = c.req.param("taskId");
  try {
    const result = await consumerAgent.settlePayment(taskId);
    return c.json({ message: "Payment settled", ...result });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Payment settlement failed";
    const status = msg.includes("not found") ? 404 : msg.includes("must be delivered") ? 409 : 400;
    return errorResponse(c, status as 400 | 404 | 409, status === 404 ? ErrorCodes.TASK_NOT_FOUND : status === 409 ? ErrorCodes.TASK_ALREADY_CLAIMED : ErrorCodes.MISSING_FIELDS, msg);
  }
});

demo.post("/consumer/run-workflow", async (c) => {
  const body = await c.req.json<{ medicalData?: MedicalData; priceHbar?: number }>().catch(() => ({ medicalData: undefined, priceHbar: undefined }));
  try {
    const result = await consumerAgent.runFullWorkflow(body.medicalData, body.priceHbar);
    return c.json({
      taskId: result.posted.taskId,
      postedTask: result.posted.task,
      message: "Task posted. Provider must claim, process, deliver, then consumer settles payment.",
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Workflow failed";
    return errorResponse(c, 400, ErrorCodes.INTERNAL_ERROR, msg, { retryable: true });
  }
});

// ─── SLICE-26-8: Pima Dataset Analysis Pipeline ──────────────────────────

import { generatePimaDataset, generatePimaSample } from "../../agents/analysis/pima-dataset";
import { generateAnalysisReport, runAnalysisPipeline, buildDatasetMetadata, generateJsonReportFromDataset } from "../../agents/analysis/pipeline";
import { uploadReportBundle } from "../../agents/ipfs-uploader";
import { runSelfCorrectingLoop, correctAnalysis } from "../../agents/self-correcting-loop";

demo.get("/analysis/dataset", (c) => {
  const rows = parseInt(c.req.query("rows") || "100", 10);
  const dataset = generatePimaDataset(Math.min(Math.max(rows, 10), 1000));
  return c.json({
    columns: dataset.columns,
    types: dataset.types,
    rowCount: dataset.rows.length,
    rows: dataset.rows.slice(0, 20),
    totalRows: dataset.rows.length,
  });
});

demo.get("/analysis/sample", (c) => {
  const dataset = generatePimaSample();
  return c.json({
    columns: dataset.columns,
    types: dataset.types,
    rowCount: dataset.rows.length,
    rows: dataset.rows,
  });
});

demo.post("/analysis/generate-report", (c) => {
  const rows = parseInt(c.req.query("rows") || "100", 10);
  const dataset = generatePimaDataset(Math.min(Math.max(rows, 10), 1000));
  const html = generateAnalysisReport(dataset, "Pima Indians Diabetes", "pima");
  return c.html(html);
});

demo.post("/analysis/sample-report", (c) => {
  const dataset = generatePimaSample();
  const html = generateAnalysisReport(dataset, "Pima Indians Diabetes (Sample)", "pima");
  return c.html(html);
});

demo.get("/analysis/report-json", (c) => {
  const rows = parseInt(c.req.query("rows") || "100", 10);
  const dataset = generatePimaDataset(Math.min(Math.max(rows, 10), 1000));
  const report = runAnalysisPipeline(dataset, "Pima Indians Diabetes", "pima");
  const metadata = buildDatasetMetadata(dataset, "Pima Indians Diabetes");
  return c.json({ report, metadata });
});

// SLICE-26-9: Structured JSON Report (for DataHub verifier consumption)
demo.get("/analysis/json-report", (c) => {
  const rows = parseInt(c.req.query("rows") || "100", 10);
  const taskId = c.req.query("taskId") || `task-demo-${Date.now()}`;
  const dataset = generatePimaDataset(Math.min(Math.max(rows, 10), 1000));
  const json = generateJsonReportFromDataset(dataset, "Pima Indians Diabetes", "pima", taskId);
  return c.json(JSON.parse(json));
});

demo.get("/analysis/json-report-sample", (c) => {
  const taskId = c.req.query("taskId") || `task-sample-${Date.now()}`;
  const dataset = generatePimaSample();
  const json = generateJsonReportFromDataset(dataset, "Pima Indians Diabetes (Sample)", "pima", taskId);
  return c.json(JSON.parse(json));
});

// SLICE-26-10: IPFS Upload — upload report bundle to Pinata
demo.post("/analysis/upload-ipfs", async (c) => {
  try {
    const taskId = c.req.query("taskId") || `task-ipfs-${Date.now()}`;
    const dataset = generatePimaSample();
    const html = generateAnalysisReport(dataset, "Pima Indians Diabetes (Sample)", "pima");
    const json = generateJsonReportFromDataset(dataset, "Pima Indians Diabetes (Sample)", "pima", taskId);
    const uri = await uploadReportBundle(html, json, {
      taskId,
      agentDid: "did:hcs:0.0.0:2",
      agentTier: "gold",
      analysisType: "descriptive",
      datasetUrn: "urn:li:dataset:(urn:li:dataPlatform:kaggle,pima-diabetes,PROD)",
      generatedAt: new Date().toISOString(),
    });
    return c.json({ success: true, ipfsUri: uri, taskId });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "IPFS upload failed";
    return c.json({ success: false, error: msg }, 500);
  }
});

// SLICE-26-11: Self-correcting loop demo
demo.post("/analysis/self-correct", async (c) => {
  const dataset = generatePimaSample();
  const report = runAnalysisPipeline(dataset, "Pima Indians Diabetes (Sample)", "pima");

  // Simulate: 1st attempt fails (no glossary terms), 2nd passes after correction
  let callCount = 0;
  const result = await runSelfCorrectingLoop({
    taskId: `task-demo-${Date.now()}`,
    report,
    template: {
      analysisType: "descriptive",
      description: "Pima demo assertions",
      requiredGlossaryTerms: ["urn:li:glossaryTerm:Glucose"],
      assertions: [
        { type: "schema", description: "All fields present" },
        { type: "freshness", description: "Has glossary terms", minGlossaryTerms: 1 },
      ],
    },
    verify: async (_taskId, _r, _template) => {
      callCount++;
      if (callCount === 1) {
        return {
          passed: false,
          checks: [{ description: "glossary", passed: false, message: "no glossary terms referenced" }],
          failedChecks: ["no glossary terms referenced"],
        };
      }
      return {
        passed: true,
        checks: [{ description: "glossary", passed: true, message: "ok" }],
        failedChecks: [],
      };
    },
    completeTask: async (taskId) => {
      return true;
    },
    maxAttempts: 3,
  });

  return c.json(result);
});

export default demo;
