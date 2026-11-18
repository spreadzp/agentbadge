// EPIC-140 (SLICE-140-20): scanner report client-side script (part 2 — assertions, report, runtime).
export const SCANNER_SCRIPT_REPORT = `            function renderAssertionList(report) {
              if (!report.assertions || report.assertions.length === 0) return '';
              var html = '<div class="rounded-lg border border-slate-700 overflow-hidden">';
              html += '<div class="bg-slate-800 px-4 py-2 text-sm font-semibold text-slate-300">All Checks (' + report.assertions.length + ')</div>';
              html += '<div class="divide-y divide-slate-800">';
              for (var i = 0; i < report.assertions.length; i++) {
                var a = report.assertions[i];
                var status = a.status || 'unknown';
                var name = a.name || a.rule_id || 'unknown';
                var ruleId = a.rule_id || '';
                var reviewLevel = a.review_level || '';
                var isGap = status === 'GAP';
                var isCritical = (a.severity || '').toLowerCase() === 'critical';
                // GAP issues show display_question as title; critical gets BLOCKER prefix
                var displayTitle = name;
                if (isGap && a.display_question) {
                  displayTitle = isCritical ? '🚫 ' + a.display_question : a.display_question;
                } else if (isCritical) {
                  displayTitle = '🚫 ' + name;
                }
                var statusColor = status === 'VERIFIED' || status === 'INFERRED' ? 'text-emerald-400' : status === 'GAP' ? 'text-rose-400' : status === 'CONFLICT' ? 'text-amber-400' : 'text-slate-400';
                var drawerId = 'drawer-' + i;
                html += '<div class="px-4 py-3' + (isCritical && isGap ? ' bg-rose-900/10' : '') + '">';
                html += '<div class="flex items-center justify-between cursor-pointer" onclick="var d=document.getElementById(\\'' + drawerId + '\\'); if(d){d.classList.toggle(\\'hidden\\');}">';
                html += '<div class="flex items-center gap-2">';
                html += '<span class="text-xs font-mono text-slate-600">' + ruleId + '</span>';
                html += '<span class="text-sm text-slate-300">' + displayTitle + '</span>';
                html += '</div>';
                html += '<div class="flex items-center gap-2">';
                if (isCritical) {
                  html += '<span class="text-xs px-1.5 py-0.5 rounded bg-rose-900 text-rose-300 font-mono">BLOCKER</span>';
                }
                if (reviewLevel === 'assisted') {
                  html += '<span class="text-xs px-1.5 py-0.5 rounded bg-amber-900 text-amber-300">assisted</span>';
                } else if (reviewLevel === 'automatic') {
                  html += '<span class="text-xs px-1.5 py-0.5 rounded bg-emerald-900 text-emerald-300">automatic</span>';
                }
                html += '<span class="text-xs font-semibold ' + statusColor + '">' + status + '</span>';
                html += '</div>';
                html += '</div>';
                html += '<div id="' + drawerId + '">';
                html += renderEvidenceDrawer(a);
                html += '</div>';
                html += '</div>';
              }
              html += '</div></div>';
              return html;
            }
            function renderReport(container, report) {
              var html = '<div class="space-y-6">';

              // Total score block
              html += '<div class="flex items-center gap-6">';
              html += '<div class="text-5xl font-bold ' + scoreColorClass(report.score) + '">' + report.score + '</div>';
              html += '<div>';
              html += '<div class="text-2xl font-semibold text-white">Grade: ' + report.grade + '</div>';
              html += '<div class="text-slate-400 text-sm">' + report.summary + '</div>';
              html += '</div></div>';

              // Floor warning
              if (report.floorTriggered) {
                html += '<div class="rounded-lg border border-rose-800 bg-rose-900/20 px-4 py-3">';
                html += '<div class="flex items-center gap-2">';
                html += '<span class="text-rose-400 text-sm font-semibold">⚠ Floor Cap Active</span>';
                html += '</div>';
                html += '<div class="text-xs text-rose-300 mt-1">' + (report.floorReason || 'Score capped due to critical missing rules.') + '</div>';
                html += '</div>';
              }

              // Four Pillars block (graceful degradation)
              if (report.pillars && report.pillars.length > 0) {
                html += '<div class="rounded-lg border border-slate-700 overflow-hidden">';
                html += '<div class="bg-slate-800 px-4 py-2 text-sm font-semibold text-slate-300">YOUR AGENT READINESS — Four Pillars</div>';
                html += '<div class="divide-y divide-slate-800">';
                for (var p = 0; p < report.pillars.length; p++) {
                  html += renderPillarRow(report.pillars[p]);
                }
                html += '</div></div>';
              }

              // Gap Engine block (EPIC-96)
              var gapHtml = renderGapBlock(report);
              if (gapHtml) {
                html += gapHtml;
              }

              // Category Breakdown (legacy, always shown)
              html += '<div class="rounded-lg border border-slate-700 overflow-hidden">';
              html += '<div class="bg-slate-800 px-4 py-2 text-sm font-semibold text-slate-300">Category Breakdown</div>';
              html += '<div class="divide-y divide-slate-800">';
              for (var i = 0; i < report.categories.length; i++) {
                var cat = report.categories[i];
                var pct = cat.completeness_pct;
                html += '<div class="px-4 py-3 flex items-center gap-4">';
                html += '<span class="text-lg">' + cat.icon + '</span>';
                html += '<div class="flex-1">';
                html += '<div class="text-sm text-slate-300">' + cat.name + '</div>';
                html += '<div class="mt-1 h-1.5 w-full rounded-full bg-slate-800">';
                html += '<div class="h-1.5 rounded-full ' + barColorClass(pct) + '" style="width:' + pct + '%"></div>';
                html += '</div></div>';
                html += '<div class="text-xs text-slate-500">' + cat.verified + '/' + cat.total + '</div>';
                html += '</div>';
              }
              html += '</div></div>';

              // Prioritized Issues (with buckets) or legacy Top Issues
              var issueHtml = renderIssueBuckets(report);
              if (issueHtml) {
                html += issueHtml;
              } else if (report.top_missing && report.top_missing.length > 0) {
                html += '<div class="rounded-lg border border-slate-700 overflow-hidden">';
                html += '<div class="bg-slate-800 px-4 py-2 text-sm font-semibold text-slate-300">Top Issues to Fix</div>';
                html += '<div class="divide-y divide-slate-800">';
                for (var j = 0; j < report.top_missing.length; j++) {
                  var rule = report.top_missing[j];
                  html += '<div class="px-4 py-3">';
                  html += '<div class="flex items-center justify-between">';
                  html += '<span class="text-sm text-slate-300">' + rule.title + '</span>';
                  html += '<span class="text-xs text-slate-500">' + rule.estimated_cost + '</span>';
                  html += '</div>';
                  html += '<div class="text-xs text-slate-500 mt-1">' + rule.hint + '</div>';
                  html += '</div>';
                }
                html += '</div></div>';
              }

              // All Checks with evidence drawers (V2 assertions)
              var assertionHtml = renderAssertionList(report);
              if (assertionHtml) {
                html += assertionHtml;
              }

              // Runtime section (SLICE-98-8)
              var runtimeHtml = renderRuntimeSection(report);
              if (runtimeHtml) {
                html += runtimeHtml;
              }

              html += '</div>';
              container.innerHTML = html;
            }

            function renderRuntimeSection(report) {
              if (!report.runtime) {
                // Empty state — runtime not run
                return '<div class="rounded-lg border border-slate-700 overflow-hidden">' +
                  '<div class="bg-slate-800 px-4 py-2 text-sm font-semibold text-slate-300">Runtime Test</div>' +
                  '<div class="px-4 py-6 text-center">' +
                  '<div class="text-slate-500 text-sm">Runtime test not run — opt in from CLI or MCP</div>' +
                  '<div class="text-slate-600 text-xs mt-1">agentbadge runtime &lt;url&gt; — see --help for flags</div>' +
                  '</div></div>';
              }

              var rt = report.runtime;
              var asr = rt.asr;
              var pct = (asr.asr * 100).toFixed(1);
              var html = '<div class="rounded-lg border border-slate-700 overflow-hidden">';

              // ASR headline
              html += '<div class="bg-slate-800 px-4 py-2 text-sm font-semibold text-slate-300">Runtime Test — Agent Success Rate</div>';
              html += '<div class="px-4 py-4">';
              html += '<div class="flex items-center gap-4">';
              html += '<div class="text-4xl font-bold text-emerald-400">' + pct + '%</div>';
              html += '<div>';
              html += '<div class="text-sm text-slate-300">' + asr.successful + '/' + asr.total + ' tasks successful</div>';
              html += '<div class="text-xs text-slate-500">Partial: ' + asr.partial + ' · Failed: ' + asr.failed + '</div>';
              html += '</div></div>';

              // Per-category mini-bars
              html += '<div class="mt-4 space-y-1.5">';
              var cats = asr.per_category || {};
              for (var cat in cats) {
                if (!cats.hasOwnProperty(cat)) continue;
                var c = cats[cat];
                var cPct = (c.asr * 100).toFixed(0);
                html += '<div class="flex items-center gap-2">';
                html += '<span class="text-xs text-slate-400 w-20 capitalize">' + cat + '</span>';
                html += '<div class="flex-1 h-1.5 rounded-full bg-slate-700 overflow-hidden">';
                html += '<div class="h-1.5 rounded-full ' + barColorClass(cPct) + '" style="width:' + cPct + '%"></div>';
                html += '</div>';
                html += '<span class="text-xs text-slate-500 w-8">' + c.successful + '/' + c.total + '</span>';
                html += '</div>';
              }
              html += '</div>';
              html += '</div>';

              // Task table — sorted failed→partial→success
              var order = { failed: 0, partial: 1, success: 2 };
              var sorted = (rt.traces || []).slice().sort(function(a, b) {
                return (order[a.outcome] || 3) - (order[b.outcome] || 3);
              });

              html += '<div class="divide-y divide-slate-800">';
              for (var i = 0; i < sorted.length; i++) {
                var trace = sorted[i];
                var chipColor = trace.outcome === 'success' ? 'bg-emerald-900/40 text-emerald-400' :
                  trace.outcome === 'partial' ? 'bg-amber-900/40 text-amber-400' :
                  'bg-rose-900/40 text-rose-400';
                var okSteps = trace.steps.filter(function(s) { return s.outcome === 'ok'; }).length;

                html += '<div class="px-4 py-3">';
                html += '<div class="flex items-center justify-between">';
                html += '<div class="flex items-center gap-2">';
                html += '<span class="text-sm font-mono text-slate-300">' + trace.task_id + '</span>';
                html += '<span class="text-xs rounded px-1.5 py-0.5 ' + chipColor + '">' + trace.outcome + '</span>';
                html += '</div>';
                html += '<div class="text-xs text-slate-500">' + okSteps + '/' + trace.steps.length + ' steps · ' + trace.stop_reason + '</div>';
                html += '</div>';

                // Expandable trace viewer
                html += '<details class="mt-2">';
                html += '<summary class="text-xs text-slate-500 cursor-pointer hover:text-slate-300">View trace</summary>';
                html += '<div class="mt-2 space-y-1">';
                for (var j = 0; j < trace.steps.length; j++) {
                  var step = trace.steps[j];
                  var stepHighlight = (step.outcome === 'stopped' || step.outcome === 'error') ?
                    'border-l-2 border-rose-500 pl-2 bg-rose-900/10' : 'border-l-2 border-slate-700 pl-2';
                  html += '<div class="' + stepHighlight + ' py-1">';
                  html += '<div class="flex items-center gap-2">';
                  html += '<span class="text-xs text-slate-600 font-mono">' + step.seq + '</span>';
                  html += '<span class="text-xs text-slate-400">' + step.phase + '</span>';
                  html += '<span class="text-xs text-slate-300">' + step.action + '</span>';
                  html += '<span class="text-xs text-slate-500">' + step.outcome + '</span>';
                  html += '</div>';
                  if (step.notes) {
                    html += '<div class="text-xs text-rose-400 ml-6">' + step.notes + '</div>';
                  }
                  html += '</div>';
                }
                html += '</div></details>';
                html += '</div>';
              }
              html += '</div>';

              // Conflict cards
              if (rt.conflicts && rt.conflicts.length > 0) {
                html += '<div class="bg-slate-800 px-4 py-2 text-sm font-semibold text-amber-400">Declared vs Observed — CONFLICTs</div>';
                html += '<div class="divide-y divide-slate-800">';
                for (var k = 0; k < rt.conflicts.length; k++) {
                  var conflict = rt.conflicts[k];
                  html += '<div class="px-4 py-3">';
                  html += '<div class="flex items-center gap-2">';
                  html += '<span class="text-xs rounded px-1.5 py-0.5 bg-amber-900/40 text-amber-400">' + conflict.status + '</span>';
                  html += '<span class="text-xs text-slate-500">' + conflict.rule_id + '</span>';
                  html += '</div>';
                  html += '<div class="text-xs text-slate-400 mt-1">' + conflict.reason + '</div>';
                  html += '</div>';
                }
                html += '</div>';
              }

              html += '</div>';
              return html;
            }
          })();
`;
