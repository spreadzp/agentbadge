// EPIC-140 (SLICE-140-20): scanner report client-side script (part 1 — helpers, pillar/gap/issue renderers).
// Injected via raw() into the scanner CTA <script> block; kept verbatim for byte-identical output.
export const SCANNER_SCRIPT_CORE = `
          (function() {
            var form = document.getElementById('total-scan-form');
            var result = document.getElementById('total-scan-result');
            var submitBtn = document.getElementById('total-scan-submit');
            if (!form) return;

            form.addEventListener('submit', async function(e) {
              e.preventDefault();
              var url = document.getElementById('total-scan-url').value.trim();
              if (!url) return;

              submitBtn.disabled = true;
              submitBtn.textContent = 'Scanning...';
              submitBtn.classList.add('snake-scanning');
              result.classList.remove('hidden');
              result.innerHTML = '<div class="text-slate-400 text-sm">Starting scan for ' + url + '...</div>';

              try {
                var response = await fetch('/api/total-scan', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ url: url })
                });

                var reader = response.body.getReader();
                var decoder = new TextDecoder();
                var buffer = '';

                while (true) {
                  var chunk = await reader.read();
                  if (chunk.done) break;
                  buffer += decoder.decode(chunk.value, { stream: true });

                  var lines = buffer.split('\\n');
                  buffer = lines.pop() || '';

                  for (var i = 0; i < lines.length; i++) {
                    var line = lines[i];
                    if (line.startsWith('data: ')) {
                      var data = JSON.parse(line.slice(6));
                      if (data.phase === 'fetching') {
                        var pct = data.total > 0 ? Math.round((data.completed / data.total) * 100) : 0;
                        result.innerHTML = '<div class="space-y-2">'
                          + '<div class="flex items-center justify-between text-sm">'
                          + '<span class="text-slate-300">Fetching resources</span>'
                          + '<span class="text-slate-500">' + pct + '%</span>'
                          + '</div>'
                          + '<div class="h-2 w-full rounded-full bg-slate-800">'
                          + '<div class="h-2 rounded-full bg-indigo-500 transition-all duration-300" style="width:' + pct + '%"></div>'
                          + '</div>'
                          + '<div class="text-xs text-slate-500">Fetching: ' + data.resource + '</div>'
                          + '</div>';
                      } else if (data.phase === 'evaluating') {
                        var pct = data.total > 0 ? Math.round((data.completed / data.total) * 100) : 0;
                        result.innerHTML = '<div class="space-y-2">'
                          + '<div class="flex items-center justify-between text-sm">'
                          + '<span class="text-slate-300">Evaluating rules</span>'
                          + '<span class="text-slate-500">' + pct + '%</span>'
                          + '</div>'
                          + '<div class="h-2 w-full rounded-full bg-slate-800">'
                          + '<div class="h-2 rounded-full bg-emerald-500 transition-all duration-300" style="width:' + pct + '%"></div>'
                          + '</div>'
                          + '</div>';
                      } else if (data.score !== undefined) {
                        renderReport(result, data);
                      }
                    }
                  }
                }
              } catch (err) {
                result.innerHTML = '<div class="text-rose-300 text-sm">Error: ' + err.message + '</div>';
              } finally {
                submitBtn.disabled = false;
                submitBtn.textContent = 'Start Full Scan';
                submitBtn.classList.remove('snake-scanning');
              }
            });

            function scoreColorClass(score) {
              return score >= 80 ? 'text-emerald-400' : score >= 50 ? 'text-amber-400' : 'text-rose-400';
            }
            function barColorClass(pct) {
              return pct >= 80 ? 'bg-emerald-500' : pct >= 50 ? 'bg-amber-500' : 'bg-rose-500';
            }
            function renderPillarRow(pillar) {
              var scaled = Math.round(pillar.score * pillar.weight / 100);
              var pct = pillar.weight > 0 ? Math.round(pillar.score) : 0;
              var barW = pillar.weight > 0 ? Math.round(pillar.score) : 0;
              var html = '<div class="px-4 py-3">';
              html += '<div class="flex items-center justify-between cursor-pointer" onclick="this.parentElement.querySelector(\\'.pillar-categories\\').classList.toggle(\\'hidden\\')">';
              html += '<div>';
              html += '<div class="text-sm font-semibold text-slate-200">' + pillar.label + '</div>';
              html += '<div class="text-xs text-slate-500" title="' + pillar.question + '">' + pillar.question + '</div>';
              html += '</div>';
              html += '<div class="flex items-center gap-3">';
              if (pillar.floorTriggered) {
                html += '<span class="text-xs px-1.5 py-0.5 rounded bg-rose-900 text-rose-300">FLOOR</span>';
              }
              html += '<span class="text-sm ' + scoreColorClass(pct) + '">' + scaled + '/' + pillar.weight + '</span>';
              html += '</div>';
              html += '</div>';
              html += '<div class="mt-1.5 h-1.5 w-full rounded-full bg-slate-800">';
              html += '<div class="h-1.5 rounded-full ' + barColorClass(pct) + '" style="width:' + barW + '%"></div>';
              html += '</div>';
              html += '<div class="pillar-categories hidden mt-2 space-y-1">';
              if (pillar.categories && pillar.categories.length > 0) {
                for (var k = 0; k < pillar.categories.length; k++) {
                  html += '<div class="text-xs text-slate-500">• ' + pillar.categories[k] + '</div>';
                }
              }
              html += '</div>';
              html += '</div>';
              return html;
            }
            function renderGapBlock(report) {
              if (!report.gaps || report.gaps.length === 0) {
                return '<div class="rounded-lg border border-emerald-700/50 bg-emerald-900/10 px-4 py-3 text-sm text-emerald-300">No gaps — your service answers every agent question we check</div>';
              }
              var gs = report.gap_summary || { total: report.gaps.length, by_priority: {}, by_type: {} };
              var prioLabels = { CRITICAL: 'CRITICAL', HIGH: 'HIGH', MEDIUM: 'MEDIUM', LOW: 'LOW' };
              var prioColors = { CRITICAL: 'bg-rose-900 text-rose-300', HIGH: 'bg-amber-900 text-amber-300', MEDIUM: 'bg-yellow-900 text-yellow-300', LOW: 'bg-slate-700 text-slate-300' };
              var typeLabels = { documentation: 'Documentation', semantic: 'Semantic', capability: 'Capability', evidence: 'Evidence' };
              var hintLabels = { deterministic: 'Auto-fixable', assisted: 'Assisted', manual: 'Manual' };
              var hintColors = { deterministic: 'text-emerald-400', assisted: 'text-amber-400', manual: 'text-rose-400' };

              var html = '<div class="rounded-lg border border-slate-700 overflow-hidden">';
              html += '<div class="bg-slate-800 px-4 py-2">';
              html += '<div class="text-sm font-semibold text-slate-300">What your agent is missing</div>';
              // Summary chips
              html += '<div class="mt-2 flex flex-wrap gap-2">';
              var prios = ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'];
              for (var pi = 0; pi < prios.length; pi++) {
                var p = prios[pi];
                var cnt = gs.by_priority[p] || 0;
                if (cnt > 0) {
                  html += '<span class="text-xs px-2 py-0.5 rounded ' + prioColors[p] + '">' + cnt + ' ' + prioLabels[p] + '</span>';
                }
              }
              html += '<span class="text-xs text-slate-500 ml-2">';
              var typeParts = [];
              var types = ['documentation', 'semantic', 'capability', 'evidence'];
              for (var ti = 0; ti < types.length; ti++) {
                var tc = gs.by_type[types[ti]] || 0;
                if (tc > 0) typeParts.push(tc + ' ' + typeLabels[types[ti]]);
              }
              html += typeParts.join(' · ');
              html += '</span>';
              html += '</div>';
              html += '</div>';

              // Gap rows
              html += '<div class="divide-y divide-slate-800">';
              for (var i = 0; i < report.gaps.length; i++) {
                var gap = report.gaps[i];
                var isBlocker = gap.priority === 'CRITICAL';
                var rowClass = isBlocker ? 'px-4 py-3 bg-rose-900/10 border-l-4 border-rose-500' : 'px-4 py-3';
                html += '<div class="' + rowClass + '">';
                // Header row: priority badge + title + type chip
                html += '<div class="flex items-center justify-between gap-2">';
                html += '<div class="flex items-center gap-2">';
                html += '<span class="text-xs px-1.5 py-0.5 rounded ' + prioColors[gap.priority] + '">' + gap.priority + '</span>';
                html += '<span class="text-sm text-slate-200">' + gap.title + '</span>';
                html += '</div>';
                html += '<span class="text-xs px-1.5 py-0.5 rounded bg-slate-700 text-slate-400">' + (typeLabels[gap.type] || gap.type) + '</span>';
                html += '</div>';
                // Description
                if (gap.description) {
                  html += '<div class="text-xs text-slate-500 mt-1">' + gap.description + '</div>';
                }
                // Related rules (fold-out)
                if (gap.related_rules && gap.related_rules.length > 0) {
                  html += '<div class="mt-1">';
                  html += '<button class="text-xs text-indigo-400 hover:text-indigo-300" onclick="this.nextElementSibling.classList.toggle(\'hidden\')">Related rules (' + gap.related_rules.length + ')</button>';
                  html += '<div class="hidden mt-1 space-y-0.5">';
                  for (var r = 0; r < gap.related_rules.length; r++) {
                    html += '<div class="text-xs text-slate-500 font-mono">' + gap.related_rules[r] + '</div>';
                  }
                  html += '</div>';
                  html += '</div>';
                }
                // Fix hint + artifacts
                html += '<div class="mt-1 flex items-center gap-3">';
                html += '<span class="text-xs ' + hintColors[gap.fix_hint] + '">' + (hintLabels[gap.fix_hint] || gap.fix_hint) + '</span>';
                if (gap.fix_artifacts && gap.fix_artifacts.length > 0) {
                  html += '<span class="text-xs text-slate-600">artifacts: ' + gap.fix_artifacts.join(', ') + '</span>';
                }
                html += '</div>';
                // Priority reason (expandable)
                if (gap.priority_reason) {
                  html += '<div class="mt-1">';
                  html += '<button class="text-xs text-slate-600 hover:text-slate-400" onclick="this.nextElementSibling.classList.toggle(\'hidden\')">why?</button>';
                  html += '<div class="hidden mt-1 text-xs text-slate-600 font-mono">' + gap.priority_reason + '</div>';
                  html += '</div>';
                }
                html += '</div>';
              }
              html += '</div></div>';
              return html;
            }
            function renderIssueBuckets(report) {
              if (!report.top_missing || report.top_missing.length === 0) return '';
              var blockers = [];
              var otherBuckets = { HIGH: [], MEDIUM: [], LOW: [] };
              for (var i = 0; i < report.top_missing.length; i++) {
                var rule = report.top_missing[i];
                var sev = (rule.severity || 'medium').toUpperCase();
                if (sev === 'CRITICAL') {
                  blockers.push(rule);
                } else if (otherBuckets[sev]) {
                  otherBuckets[sev].push(rule);
                } else {
                  otherBuckets.MEDIUM.push(rule);
                }
              }
              var html = '<div class="rounded-lg border border-slate-700 overflow-hidden">';
              html += '<div class="bg-slate-800 px-4 py-2 text-sm font-semibold text-slate-300">Prioritized Issues</div>';
              html += '<div class="divide-y divide-slate-800">';

              // BLOCKER bucket (critical severity) — pinned at top
              if (blockers.length > 0) {
                html += '<div class="px-4 py-2 bg-rose-900/30 border-l-4 border-rose-500">';
                html += '<div class="text-xs font-semibold text-rose-300">🚫 BLOCKER (' + blockers.length + ')</div>';
                html += '</div>';
                for (var j = 0; j < blockers.length; j++) {
                  var b = blockers[j];
                  var bTitle = b.display_question || b.title;
                  html += '<div class="px-4 py-3 bg-rose-900/10">';
                  html += '<div class="flex items-center justify-between">';
                  html += '<span class="text-sm text-rose-200">' + bTitle + '</span>';
                  html += '<span class="text-xs text-rose-400 font-mono">BLOCKER</span>';
                  html += '</div>';
                  html += '<div class="text-xs text-slate-500 mt-1">' + b.hint + '</div>';
                  html += '</div>';
                }
              }

              var order = ['HIGH', 'MEDIUM', 'LOW'];
              var colors = { HIGH: 'text-amber-400', MEDIUM: 'text-yellow-400', LOW: 'text-slate-400' };
              for (var b = 0; b < order.length; b++) {
                var bucket = order[b];
                var items = otherBuckets[bucket];
                if (items.length === 0) continue;
                html += '<div class="px-4 py-2 bg-slate-900/30">';
                html += '<div class="text-xs font-semibold ' + colors[bucket] + '">' + bucket + ' (' + items.length + ')</div>';
                html += '</div>';
                for (var j = 0; j < items.length; j++) {
                  var r = items[j];
                  var rTitle = r.display_question || r.title;
                  html += '<div class="px-4 py-3">';
                  html += '<div class="flex items-center justify-between">';
                  html += '<span class="text-sm text-slate-300">' + rTitle + '</span>';
                  html += '<span class="text-xs text-slate-500">' + r.estimated_cost + '</span>';
                  html += '</div>';
                  html += '<div class="text-xs text-slate-500 mt-1">' + r.hint + '</div>';
                  html += '</div>';
                }
              }
              html += '</div></div>';
              return html;
            }
            function formatVerifiedAt(verifiedAt) {
              if (!verifiedAt) return '—';
              try {
                var d = new Date(verifiedAt);
                var now = new Date();
                var diffMs = now.getTime() - d.getTime();
                var diffDays = Math.floor(diffMs / 86400000);
                var dateStr = d.toISOString().replace('T', ' ').slice(0, 16) + ' UTC';
                if (diffDays === 0) return dateStr + ' (today)';
                if (diffDays === 1) return dateStr + ' (1 day ago)';
                if (diffDays < 30) return dateStr + ' (' + diffDays + ' days ago)';
                return dateStr;
              } catch(e) {
                return verifiedAt || '—';
              }
            }
            function renderEvidenceDrawer(a) {
              var claim = a.claim || a.name || 'unknown';
              var status = a.status || 'unknown';
              var confidence = a.confidence !== undefined ? Math.round(a.confidence * 100) : 0;
              var reviewLevel = a.review_level || '';
              var verifiedAt = a.verified_at || '';
              var sourceLabel = a.source_label || '';
              var stale = a.stale || false;
              var evidence = a.evidence || [];
              var isGap = status === 'GAP';

              var html = '<div class="evidence-drawer hidden mt-2 pl-4 border-l-2 border-slate-700 space-y-2 text-xs">';

              // Claim
              html += '<blockquote class="border-l-2 border-indigo-500 pl-3 text-slate-300 italic">' + claim + '</blockquote>';

              // Status + source_label badge
              html += '<div class="flex items-center gap-2">';
              html += '<span class="text-slate-400">STATUS</span>';
              html += '<span class="font-semibold ' + (isGap ? 'text-rose-400' : 'text-emerald-400') + '">' + status + '</span>';
              if (status === 'INFERRED' || a.semantic_outcome === 'partial') {
                html += '<span class="px-1.5 py-0.5 rounded bg-amber-900 text-amber-300 text-xs">partial</span>';
              }
              if (sourceLabel) {
                html += '<span class="text-slate-500">via ' + sourceLabel + '</span>';
              }
              html += '</div>';

              // GAP narrative
              if (isGap) {
                html += '<div class="text-rose-300">No evidence found in any source — information gap, agents cannot answer this question about your service.</div>';
              }

              // Confidence + review level
              html += '<div class="flex items-center gap-2">';
              html += '<span class="text-slate-400">CONFIDENCE</span>';
              html += '<span class="text-slate-300">' + confidence + '%</span>';
              if (reviewLevel === 'automatic') {
                html += '<span class="px-1.5 py-0.5 rounded bg-emerald-900 text-emerald-300">automatic</span>';
              } else if (reviewLevel === 'assisted') {
                html += '<span class="px-1.5 py-0.5 rounded bg-amber-900 text-amber-300">assisted review</span>';
              }
              html += '</div>';

              // Verified at + stale marker
              html += '<div class="flex items-center gap-2">';
              html += '<span class="text-slate-400">VERIFIED</span>';
              html += '<span class="text-slate-300">' + formatVerifiedAt(verifiedAt) + '</span>';
              if (stale) {
                html += '<span class="text-amber-400">⚠ stale evidence</span>';
              }
              html += '</div>';

              // Evidence summaries
              if (evidence.length > 0) {
                html += '<div class="space-y-1">';
                html += '<div class="text-slate-400">EVIDENCE</div>';
                for (var i = 0; i < evidence.length; i++) {
                  var ev = evidence[i];
                  var capturedAt = ev.captured_at ? formatVerifiedAt(ev.captured_at) : '';
                  html += '<div class="text-slate-500">';
                  html += ev.summary || '';
                  if (capturedAt) html += ' (captured ' + capturedAt + ')';
                  html += '</div>';
                }
                html += '</div>';
              }

              html += '</div>';
              return html;
            }
`;
