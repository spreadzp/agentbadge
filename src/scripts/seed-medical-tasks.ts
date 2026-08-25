/**
 * Seed medical tasks to the marketplace for demo.
 * Creates 3 tasks: Pima Diabetes, Heart Disease, Breast Cancer.
 *
 * Usage: bun run src/scripts/seed-medical-tasks.ts
 *
 * Required env vars:
 *   POSTER_DID           — DID of the poster (did:hcs:tokenId:serial)
 *   POSTER_PRIVATE_KEY   — Poster's private key (DER hex)
 *
 * Optional env vars:
 *   MARKETPLACE_URL      — Base URL of the server (default: http://localhost:3001)
 *   HFS_FILE_ID_PIMA     — HFS file ID for Pima dataset
 *   HFS_FILE_ID_HEART    — HFS file ID for Heart Disease dataset
 *   HFS_FILE_ID_CANCER   — HFS file ID for Breast Cancer dataset
 *   TASK_PRICE_HBAR      — Price per task in HBAR (default: 5)
 */

interface SeedTaskConfig {
  title: string;
  description: string;
  datasetUrn: string;
  analysisType: string;
  hfsFileId?: string;
}

const DATASETS: SeedTaskConfig[] = [
  {
    title: "Medical Analysis: Pima Diabetes Dataset",
    description:
      "Analyze Pima Indians Diabetes dataset. Run descriptive, correlation, and risk factor analysis. Generate HTML+JSON report with glossary terms.",
    datasetUrn: "urn:li:dataset:(urn:li:dataPlatform:kaggle,pima-diabetes,PROD)",
    analysisType: "descriptive",
    hfsFileId: process.env.HFS_FILE_ID_PIMA,
  },
  {
    title: "Medical Analysis: Heart Disease Dataset",
    description:
      "Analyze UCI Heart Disease dataset. Run descriptive statistics, correlation analysis, and risk stratification. Generate HTML+JSON report with glossary terms.",
    datasetUrn: "urn:li:dataset:(urn:li:dataPlatform:kaggle,heart-disease,PROD)",
    analysisType: "descriptive",
    hfsFileId: process.env.HFS_FILE_ID_HEART,
  },
  {
    title: "Medical Analysis: Breast Cancer Dataset",
    description:
      "Analyze Breast Cancer Wisconsin dataset. Run descriptive statistics, feature correlation, and diagnostic accuracy analysis. Generate HTML+JSON report with glossary terms.",
    datasetUrn: "urn:li:dataset:(urn:li:dataPlatform:kaggle,breast-cancer,PROD)",
    analysisType: "descriptive",
    hfsFileId: process.env.HFS_FILE_ID_CANCER,
  },
];

export interface SeedResult {
  taskId: string;
  title: string;
  priceHbar: number;
  status: string;
}

export async function seedMedicalTasks(
  posterDid: string,
  posterPrivateKey: string,
  marketplaceUrl: string,
  priceHbar: number,
): Promise<SeedResult[]> {
  const { signedFetch } = await import("../../scripts/lib/did-sign");
  const results: SeedResult[] = [];

  for (const dataset of DATASETS) {
    const timestamp = Math.floor(Date.now() / 1000);
    const taskId = `task-medical-${timestamp}-${Math.random().toString(36).slice(2, 6)}`;

    const body = {
      posterDid,
      posterPrivateKey,
      title: dataset.title,
      description: dataset.description,
      priceHbar,
      capabilities: ["medical-analysis"],
    };

    const bodyStr = JSON.stringify(body);
    const res = await signedFetch(`${marketplaceUrl}/market/tasks`, {
      method: "POST",
      body: bodyStr,
      did: posterDid,
      privateKey: posterPrivateKey,
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Failed to create task "${dataset.title}": ${res.status} ${text}`);
    }

    const json = (await res.json()) as { taskId?: string; txId?: string };
    const result: SeedResult = {
      taskId: json.taskId ?? taskId,
      title: dataset.title,
      priceHbar,
      status: "posted",
    };
    results.push(result);

    console.log(`[Seed] Task ${results.length}: ${dataset.title.split(": ")[1]} → ${result.taskId} (${priceHbar} HBAR)`);
  }

  return results;
}

export async function main(): Promise<number> {
  const posterDid = process.env.POSTER_DID;
  const posterPrivateKey = process.env.POSTER_PRIVATE_KEY;
  const marketplaceUrl = process.env.MARKETPLACE_URL ?? "http://localhost:3001";
  const priceHbar = Number(process.env.TASK_PRICE_HBAR ?? "5");

  if (!posterDid) {
    console.error("[Seed] Error: POSTER_DID environment variable is required");
    return 1;
  }
  if (!posterPrivateKey) {
    console.error("[Seed] Error: POSTER_PRIVATE_KEY environment variable is required");
    return 1;
  }

  console.log(`[Seed] Creating ${DATASETS.length} medical tasks...`);

  try {
    const results = await seedMedicalTasks(posterDid, posterPrivateKey, marketplaceUrl, priceHbar);
    console.log(`[Seed] Done. ${results.length} tasks posted to marketplace.`);
    for (const r of results) {
      console.log(`  ${r.taskId} — ${r.title} (${r.priceHbar} HBAR)`);
    }
    return 0;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[Seed] Failed: ${msg}`);
    return 1;
  }
}

// Run if executed directly
if (import.meta.main) {
  main().then((code) => process.exit(code));
}
