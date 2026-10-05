// SLICE-176-10: owner-console JS appended to /wallets — pending approvals
// list + approve/reject + suspend/resume toggle + alert palette.
// All mutations go through venueSign (WALLET_JS) → wallet-sig headers,
// same convention as saveCaps/loadAudit. The decide/suspend endpoints
// are ownerGate'd: only registrant or venue admin signatures pass.
// Buttons carry data-id/data-act — no string args inside onclick attrs.

export const WALLETS_OWNER_JS = `
async function loadApprovals() {
  const box = $("appr");
  if (!box) return;
  const addr = wallet || $("addr").value.trim();
  const path = "/api/wallets/" + addr + "/approvals";
  try {
    const sig = await venueSign(addr, "GET", "/api/wallets/" + addr + "/approvals");
    const r = await fetch(path + "?state=pending", { headers: sig });
    if (!r.ok) { box.innerHTML = ""; return; }
    const j = await r.json();
    box.innerHTML = approvalsHtml(j.approvals || []);
  } catch { box.innerHTML = ""; }
}

function approvalsHtml(list) {
  if (!list.length) {
    return '<div class="mt-5 border-t border-slate-800 pt-4"><h3 class="text-sm font-semibold text-slate-300 mb-2">Pending approvals</h3>' +
      '<div class="text-xs text-slate-500">None — all intents settle instantly.</div></div>';
  }
  const rows = list.map(function (a) {
    const exp = Math.max(0, Math.ceil((a.expiresAt - Date.now()) / 60000));
    return '<div class="flex items-center justify-between gap-3 rounded-lg border border-slate-800 bg-slate-950 px-3 py-2">' +
      '<div class="text-sm"><b class="font-mono text-emerald-300">$' + fmt(a.amountUsd) + "</b>" +
      ' <span class="text-slate-400">' + a.kind + "</span>" +
      (a.refId ? ' <span class="text-xs font-mono text-slate-500">' + a.refId + "</span>" : "") +
      ' <span class="text-xs text-amber-400">expires in ~' + exp + "m</span></div>" +
      '<div class="flex gap-2">' +
      '<button class="rounded bg-emerald-600/80 px-2.5 py-1 text-xs font-semibold text-white hover:bg-emerald-500" data-id="' + a.id + '" data-act="/approve" onclick="decideApproval(this)">Approve</button>' +
      '<button class="rounded bg-red-600/70 px-2.5 py-1 text-xs font-semibold text-white hover:bg-red-500" data-id="' + a.id + '" data-act="/reject" onclick="decideApproval(this)">Reject</button>' +
      "</div></div>";
  }).join("");
  return '<div class="mt-5 border-t border-slate-800 pt-4"><h3 class="text-sm font-semibold text-slate-300 mb-2">Pending approvals</h3>' +
    '<div class="flex flex-col gap-2">' + rows + "</div></div>";
}

async function decideApproval(btn) {
  const id = btn.dataset.id;
  const action = btn.dataset.act; // "/approve" | "/reject"
  const addr = wallet || $("addr").value.trim();
  const body = {};
  if (action === "/reject") {
    const reason = prompt("Reject reason (optional)");
    if (reason === null) return;
    if (reason) body.reason = reason;
  }
  const path = "/api/wallets/" + addr + "/approvals/" + id + action;
  try {
    const sig = await venueSign(addr, "POST", path);
    const r = await fetch(path, {
      method: "POST",
      headers: { ...sig, "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || j.code || "decide failed");
    load();
  } catch (e) { $("err").textContent = String(e.message || e); }
}

async function toggleSuspend(btn) {
  const action = btn.dataset.act; // "/suspend" | "/resume"
  const addr = wallet || $("addr").value.trim();
  if (!confirm((action === "/suspend" ? "Suspend" : "Resume") + " wallet " + addr + "?")) return;
  const path = "/api/wallets/" + addr + action;
  try {
    const sig = await venueSign(addr, "POST", path);
    const r = await fetch(path, { method: "POST", headers: sig });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || j.code || "killswitch failed");
    load();
  } catch (e) { $("err").textContent = String(e.message || e); }
}

function alertColor(t) {
  if (t === "spend.cap_denied" || t === "spend.velocity_denied" ||
      t === "spend.kind_denied" || t === "wallet.suspended_deny") return "text-red-400";
  if (t === "approval.requested" || t === "approval.expired" ||
      t === "wallet.suspended" || t === "wallet.low_balance") return "text-amber-400";
  if (t === "approval.decided" || t === "approval.consumed" ||
      t === "wallet.resumed") return "text-emerald-400";
  return "text-orange-400";
}

// Auto-refresh the pending list while a wallet card is on screen.
setInterval(function () { if (document.getElementById("appr")) loadApprovals(); }, 15000);
`;
