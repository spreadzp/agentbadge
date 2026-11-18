// EPIC-140 (SLICE-140-21): embedded runFullDemo client script — verbatim.
export const DEMO_SCRIPT = `<script>
      async function runFullDemo() {
        const status = document.getElementById('demo-status');
        const result = document.getElementById('demo-task-result');
        const btn = document.getElementById('demo-full');
        btn.disabled = true;
        btn.textContent = 'Running...';
        status.innerHTML = '<p class="text-sm text-slate-400">Step 1/5: Registering consumer agent...</p>';

        try {
          // Step 1: Register consumer
          await fetch('/api/demo/consumer/register', { method: 'POST' });
          status.innerHTML = '<p class="text-sm text-slate-400">Step 2/5: Registering provider agent...</p>';

          // Step 2: Register provider
          await fetch('/api/demo/provider/register', { method: 'POST' });
          status.innerHTML = '<p class="text-sm text-slate-400">Step 3/5: Posting task to marketplace...</p>';

          // Step 3: Seed task
          const seedRes = await fetch('/api/demo/marketplace/seed', { method: 'POST' });
          const seedData = await seedRes.json();
          const taskId = seedData.taskId;
          status.innerHTML = '<p class="text-sm text-emerald-400">Step 3: Task created: ' + taskId + '</p><p class="text-sm text-slate-400">Step 4/5: Provider claiming, analyzing, delivering...</p>';

          // Step 4: Provider runs full workflow
          const provRes = await fetch('/api/demo/provider/run-workflow/' + taskId, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: '{}'
          });
          const provData = await provRes.json();
          if (!provRes.ok) {
            throw new Error(provData.error?.message || provData.message || 'Provider workflow failed (' + provRes.status + ')');
          }
          status.innerHTML = '<p class="text-sm text-emerald-400">Step 4: Provider delivered! Risk: ' + provData.analysis.riskLevel + ', Report: ' + provData.reportLength + 'b</p><p class="text-sm text-slate-400">Step 5/5: Settling payment...</p>';

          // Step 5: Settle payment
          await fetch('/api/demo/consumer/settle-payment/' + taskId, { method: 'POST' });

          // Final: Show task link + result
          status.innerHTML = '<p class="text-sm text-emerald-400">✅ Workflow complete! Task: ' + taskId + '</p>';
          result.innerHTML = '<div class="rounded-lg border border-emerald-500/30 bg-emerald-500/5 p-4">'
            + '<h3 class="text-sm font-semibold text-white">Task Created & Completed</h3>'
            + '<div class="mt-2 flex flex-wrap gap-3">'
            + '<a href="/ui/market/tasks/' + taskId + '" class="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-500">📋 View Task Details</a>'
            + '<a href="/ui/medical-demo/' + taskId + '" class="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-500">🏥 Medical Demo</a>'
            + '<a href="/ui/market/tasks/' + taskId + '/result" target="_blank" class="inline-flex items-center gap-1.5 rounded-lg bg-purple-600 px-4 py-2 text-sm font-medium text-white hover:bg-purple-500">📄 Open Report</a>'
            + '</div></div>';
        } catch (err) {
          status.innerHTML = '<p class="text-sm text-red-400">Error: ' + err.message + '</p>';
        } finally {
          btn.disabled = false;
          btn.innerHTML = '<svg class="h-4 w-4" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z" /></svg> Run Full Workflow (1 click)';
        }
      }
    </script>`;
