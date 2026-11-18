import { html } from "hono/html";

export function DataFormatsSection() {
  return html`<!-- Data Formats -->
    <section class="mt-8">
      <h2 class="text-lg font-semibold text-white">Data Formats</h2>
      <p class="mt-1 text-sm text-slate-400">What agents send and receive.</p>

      <div class="mt-4 grid gap-4 lg:grid-cols-2">
        <!-- MedicalData input -->
        <div class="rounded-lg border border-slate-800 bg-slate-900 p-5">
          <h3 class="text-sm font-semibold text-emerald-400">MedicalData (Input)</h3>
          <p class="mt-1 text-xs text-slate-400">Consumer generates this and attaches to marketplace task.</p>
          <pre class="mt-3 overflow-x-auto rounded-lg bg-slate-950 p-3 text-xs text-slate-300"><code>{
  "patientId": "P001",
  "patientName": "John Doe",
  "age": 45,
  "gender": "M",
  "vitalSigns": {
    "heartRate": 72,
    "bloodPressure": "120/80",
    "temperature": 37.2,
    "respiratoryRate": 16,
    "oxygenSaturation": 98
  },
  "labResults": {
    "glucose": 95,
    "cholesterol": 180,
    "hemoglobin": 14.5,
    "whiteBloodCells": 7.2,
    "platelets": 250
  },
  "symptoms": ["mild headache"],
  "medicalHistory": ["hypertension"]
}</code></pre>
        </div>

        <!-- AnalysisResult output -->
        <div class="rounded-lg border border-slate-800 bg-slate-900 p-5">
          <h3 class="text-sm font-semibold text-blue-400">AnalysisResult (Output)</h3>
          <p class="mt-1 text-xs text-slate-400">Provider returns this after processing.</p>
          <pre class="mt-3 overflow-x-auto rounded-lg bg-slate-950 p-3 text-xs text-slate-300"><code>{
  "riskLevel": "low",
  "abnormalFindings": [],
  "recommendations": [
    "Continue current lifestyle",
    "Regular checkups recommended"
  ],
  "vitalSignsStatus": {
    "heartRate": "normal",
    "bloodPressure": "normal",
    "temperature": "normal"
  },
  "labResultsStatus": {
    "glucose": "normal",
    "cholesterol": "normal"
  }
}</code></pre>
        </div>
      </div>
    </section>`;
}

export function ReportStructureSection() {
  return html`<!-- HTML Report Structure -->
    <section class="mt-8">
      <h2 class="text-lg font-semibold text-white">HTML Report Structure</h2>
      <p class="mt-1 text-sm text-slate-400">The provider delivers a self-contained HTML report with:</p>
      <div class="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <div class="rounded-lg border border-slate-800 bg-slate-900 p-4">
          <h3 class="text-sm font-medium text-emerald-400">Patient Information</h3>
          <p class="mt-1 text-xs text-slate-400">ID, name, age, gender</p>
        </div>
        <div class="rounded-lg border border-slate-800 bg-slate-900 p-4">
          <h3 class="text-sm font-medium text-emerald-400">Risk Assessment</h3>
          <p class="mt-1 text-xs text-slate-400">Low / Moderate / High with summary</p>
        </div>
        <div class="rounded-lg border border-slate-800 bg-slate-900 p-4">
          <h3 class="text-sm font-medium text-emerald-400">Vital Signs</h3>
          <p class="mt-1 text-xs text-slate-400">Radar chart + table with normal ranges</p>
        </div>
        <div class="rounded-lg border border-slate-800 bg-slate-900 p-4">
          <h3 class="text-sm font-medium text-emerald-400">Lab Results</h3>
          <p class="mt-1 text-xs text-slate-400">Bar chart + table with normal ranges</p>
        </div>
        <div class="rounded-lg border border-slate-800 bg-slate-900 p-4">
          <h3 class="text-sm font-medium text-emerald-400">Recommendations</h3>
          <p class="mt-1 text-xs text-slate-400">Actionable clinical recommendations</p>
        </div>
        <div class="rounded-lg border border-slate-800 bg-slate-900 p-4">
          <h3 class="text-sm font-medium text-emerald-400">SVG Charts</h3>
          <p class="mt-1 text-xs text-slate-400">Radar (vitals) + bar (labs) — no external deps</p>
        </div>
      </div>
    </section>`;
}

export function ApiEndpointsSection() {
  return html`<!-- API Endpoints -->
    <section class="mt-8">
      <h2 class="text-lg font-semibold text-white">Demo API Endpoints</h2>
      <div class="mt-4 overflow-x-auto rounded-lg border border-slate-800 bg-slate-900 p-4">
        <table class="w-full text-sm">
          <thead>
            <tr class="border-b border-slate-800 text-left text-slate-400">
              <th class="pb-2 pr-4 font-medium">Method</th>
              <th class="pb-2 pr-4 font-medium">Endpoint</th>
              <th class="pb-2 font-medium">Description</th>
            </tr>
          </thead>
          <tbody class="divide-y divide-slate-800">
            <tr>
              <td class="py-2 pr-4 text-emerald-400">GET</td>
              <td class="py-2 pr-4"><code>/api/demo/medical-data/generate</code></td>
              <td class="py-2 text-slate-300">Generate random medical data</td>
            </tr>
            <tr>
              <td class="py-2 pr-4 text-emerald-400">POST</td>
              <td class="py-2 pr-4"><code>/api/demo/medical-data/process</code></td>
              <td class="py-2 text-slate-300">Analyze medical data → risk + findings</td>
            </tr>
            <tr>
              <td class="py-2 pr-4 text-emerald-400">POST</td>
              <td class="py-2 pr-4"><code>/api/demo/medical-data/report</code></td>
              <td class="py-2 text-slate-300">Generate HTML report from data + analysis</td>
            </tr>
            <tr>
              <td class="py-2 pr-4 text-emerald-400">POST</td>
              <td class="py-2 pr-4"><code>/api/demo/medical-data/generate-and-process</code></td>
              <td class="py-2 text-slate-300">Generate + analyze in one call</td>
            </tr>
            <tr>
              <td class="py-2 pr-4 text-emerald-400">POST</td>
              <td class="py-2 pr-4"><code>/api/demo/medical-data/generate-and-report</code></td>
              <td class="py-2 text-slate-300">Generate + analyze + HTML report in one call</td>
            </tr>
            <tr>
              <td class="py-2 pr-4 text-blue-400">POST</td>
              <td class="py-2 pr-4"><code>/api/demo/consumer/run-workflow</code></td>
              <td class="py-2 text-slate-300">Full consumer workflow (post → receive → settle)</td>
            </tr>
            <tr>
              <td class="py-2 pr-4 text-blue-400">POST</td>
              <td class="py-2 pr-4"><code>/api/demo/provider/run-workflow/:taskId</code></td>
              <td class="py-2 text-slate-300">Full provider workflow (claim → process → deliver)</td>
            </tr>
            <tr>
              <td class="py-2 pr-4 text-blue-400">POST</td>
              <td class="py-2 pr-4"><code>/api/demo/marketplace/seed</code></td>
              <td class="py-2 text-slate-300">Seed a demo marketplace task</td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>`;
}

export function PassportSection() {
  return html`<!-- Passport Requirements -->
    <section class="mt-8 rounded-lg border border-purple-500/30 bg-purple-500/5 p-6">
      <h2 class="text-lg font-semibold text-white">Passport Requirements</h2>
      <p class="mt-2 text-sm text-slate-300">
        Both agents need an AgentBadge passport NFT with specific capabilities:
      </p>
      <div class="mt-4 grid gap-4 sm:grid-cols-2">
        <div class="rounded-lg border border-slate-800 bg-slate-900 p-4">
          <h3 class="text-sm font-semibold text-emerald-400">Consumer Agent</h3>
          <ul class="mt-2 space-y-1 text-xs text-slate-400">
            <li><span class="text-slate-300">Tier:</span> Bronze+ (any)</li>
            <li><span class="text-slate-300">Capabilities:</span> <code>medical-consumer</code>, <code>marketplace</code></li>
            <li><span class="text-slate-300">Skills:</span> <code>data_generation</code>, <code>payment</code></li>
            <li><span class="text-slate-300">Endpoint:</span> Consumer profile page</li>
          </ul>
        </div>
        <div class="rounded-lg border border-slate-800 bg-slate-900 p-4">
          <h3 class="text-sm font-semibold text-blue-400">Provider Agent</h3>
          <ul class="mt-2 space-y-1 text-xs text-slate-400">
            <li><span class="text-slate-300">Tier:</span> Silver+ (for marketplace capability)</li>
            <li><span class="text-slate-300">Capabilities:</span> <code>medical-analysis</code>, <code>marketplace</code></li>
            <li><span class="text-slate-300">Skills:</span> <code>data_analysis</code>, <code>medical_processing</code></li>
            <li><span class="text-slate-300">Endpoint:</span> Provider profile page</li>
          </ul>
        </div>
      </div>
      <p class="mt-3 text-xs text-slate-400">
        See <a href="/agent-guide" class="text-emerald-400 underline hover:text-emerald-300">Agent Guide</a> for passport setup instructions.
      </p>
    </section>`;
}

export function CliSection() {
  return html`<!-- CLI Demo -->
    <section class="mt-8 rounded-lg border border-slate-800 bg-slate-900 p-6">
      <h2 class="text-lg font-semibold text-white">CLI Demo</h2>
      <p class="mt-2 text-sm text-slate-300">Run the full E2E workflow from terminal:</p>
      <pre class="mt-3 overflow-x-auto rounded-lg bg-slate-950 p-3 text-xs text-slate-300"><code>bun run demo:medical-marketplace</code></pre>
      <p class="mt-2 text-xs text-slate-400">
        Runs: register → generate data → post task → claim → process → deliver → receive → settle payment.
      </p>
    </section>`;
}
