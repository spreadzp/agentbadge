/**
 * SLICE-26-2: Agent Orchestrator
 * Full lifecycle: claim → download → analyze → generate → upload → deliver → verify → retry/complete
 */

import type {
  MedicalAgentConfig,
  TypedDataset,
  AnalysisReport,
  ReportBundle,
  ValidationResult,
  AssertionTemplate,
} from "./types";

export type AgentState =
  | "IDLE"
  | "CLAIMING"
  | "DOWNLOADING"
  | "ANALYZING"
  | "GENERATING"
  | "UPLOADING"
  | "DELIVERING"
  | "VERIFYING"
  | "COMPLETED"
  | "ABORTED";

export interface AgentLogEntry {
  state: AgentState;
  timestamp: string;
  message: string;
  attempt?: number;
}

export interface AgentRunResult {
  completed: boolean;
  attempts: number;
  error?: string;
  logs: AgentLogEntry[];
  ipfsCid?: string;
}

export interface AgentDependencies {
  claimTask: (taskId: string) => Promise<boolean>;
  downloadDataset: (fileId: string) => Promise<string>;
  parseCsv: (csv: string) => Promise<TypedDataset>;
  analyze: (dataset: TypedDataset) => Promise<AnalysisReport>;
  generateReport: (report: AnalysisReport) => Promise<ReportBundle>;
  uploadToIPFS: (bundle: ReportBundle) => Promise<string>;
  deliverResult: (taskId: string, ipfsCid: string) => Promise<boolean>;
  verifyResult: (taskId: string, report: AnalysisReport, template?: AssertionTemplate) => Promise<ValidationResult>;
  completeTask: (taskId: string) => Promise<boolean>;
  correctAnalysis: (failedChecks: string[], report: AnalysisReport) => AnalysisReport;
}

const MAX_VERIFY_ATTEMPTS = 3;

export class MedicalAgent {
  private state: AgentState = "IDLE";
  private logs: AgentLogEntry[] = [];

  constructor(
    private readonly config: MedicalAgentConfig,
    private readonly deps: AgentDependencies,
  ) {}

  getState(): AgentState {
    return this.state;
  }

  getLogs(): AgentLogEntry[] {
    return [...this.logs];
  }

  private log(message: string, attempt?: number): void {
    const entry: AgentLogEntry = {
      state: this.state,
      timestamp: new Date().toISOString(),
      message,
      attempt,
    };
    this.logs.push(entry);
  }

  private setState(newState: AgentState, message: string, attempt?: number): void {
    this.state = newState;
    this.log(message, attempt);
  }

  /**
   * Run the full agent lifecycle for a task.
   */
  async run(taskId: string): Promise<AgentRunResult> {
    this.logs = [];
    let attempts = 0;
    let ipfsCid: string | undefined;

    try {
      // 1. Claim
      this.setState("CLAIMING", `Claiming task ${taskId}`);
      await this.deps.claimTask(taskId);

      // 2. Download
      this.setState("DOWNLOADING", "Downloading dataset from HFS");
      const csvData = await this.deps.downloadDataset(this.config.hfsFileId ?? "0.0.0");

      // 3. Parse
      const dataset = await this.deps.parseCsv(csvData);

      // 4. Analyze
      this.setState("ANALYZING", "Running analysis pipeline");
      let report = await this.deps.analyze(dataset);

      // 5. Generate report
      this.setState("GENERATING", "Generating HTML+JSON report");
      let bundle = await this.deps.generateReport(report);

      // 6. Upload to IPFS
      this.setState("UPLOADING", "Uploading report bundle to IPFS");
      ipfsCid = await this.deps.uploadToIPFS(bundle);

      // 7. Deliver + 8. Verify (with retry loop)
      for (let attempt = 1; attempt <= MAX_VERIFY_ATTEMPTS; attempt++) {
        attempts = attempt;

        // Deliver
        this.setState("DELIVERING", `Delivering result (attempt ${attempt})`, attempt);
        await this.deps.deliverResult(taskId, ipfsCid);

        // Verify
        this.setState("VERIFYING", `Verifying result (attempt ${attempt})`, attempt);
        const verification = await this.deps.verifyResult(taskId, report);

        if (verification.passed) {
          // Complete
          this.setState("COMPLETED", `Task completed on attempt ${attempt}`, attempt);
          await this.deps.completeTask(taskId);
          this.setState("IDLE", "Agent idle");
          return { completed: true, attempts, logs: this.logs, ipfsCid };
        }

        // Failed — correct and retry
        if (attempt < MAX_VERIFY_ATTEMPTS) {
          report = this.deps.correctAnalysis(verification.failedChecks, report);
          // Regenerate report bundle with corrected analysis
          bundle = await this.deps.generateReport(report);
          // Re-upload corrected bundle
          ipfsCid = await this.deps.uploadToIPFS(bundle);
        }
      }

      // All attempts failed
      this.setState("ABORTED", `Task aborted after ${MAX_VERIFY_ATTEMPTS} verification attempts`);
      this.setState("IDLE", "Agent idle");
      return { completed: false, attempts, logs: this.logs, ipfsCid };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.setState("ABORTED", `Task aborted: ${msg}`);
      this.setState("IDLE", "Agent idle");
      return { completed: false, attempts, error: msg, logs: this.logs, ipfsCid };
    }
  }
}
