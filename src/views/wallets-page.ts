// SLICE-155-3: /wallets — agent wallet console.
// Connect wallet → GET /api/wallets/:a (record+balance) + /limits +
// /envelope. Shows envelope caps with usage bars, Circle policy mirror
// (read-only; "mainnet-only"/"unavailable" states), and a verbatim
// `circle wallet limit set` command card — OTP NEVER touches the
// platform (security: no OTP input anywhere on this page).
// PATCH envelope goes through venueSign (wallet-sig).

import { html, raw } from "hono/html";
import { Layout } from "./layout";
import { WALLET_JS } from "./venue-ui";

const CARD =
  "rounded-2xl border border-slate-800 bg-slate-900/60 p-5 shadow-lg";
const BTN =
  "rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-500 transition-colors disabled:opacity-50";
const INPUT =
  "w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-100 placeholder-slate-500 focus:border-emerald-500 focus:outline-none";

export function walletsPage(chainIdHex: string, chain: string): string {
  const js = `
const CHAIN_ID = "${chainIdHex}";
const CHAIN = "${chain}";
let wallet = null;
const $ = (id) => document.getElementById(id);
const fmt = (n) => (n === undefined || n === null) ? "—" : Number(n).toLocaleString();
const win = { perTx: "perTxUsd", daily: "dailyUsd", weekly: "weeklyUsd", monthly: "monthlyUsd" };

async function load() {
  const addr = wallet || $("addr").value.trim();
  if (!/^0x[0-9a-fA-F]{40}$/.test(addr)) { $("err").textContent = "Enter a 0x address or connect your wallet"; return; }
  $("err").textContent = "";
  $("card").innerHTML = '<div class="p-4 text-slate-400 text-sm">Loading…</div>';
  try {
    const [recRes, limRes] = await Promise.all([
      fetch("/api/wallets/" + addr),
      fetch("/api/wallets/" + addr + "/limits"),
    ]);
    if (recRes.status === 404 || limRes.status === 404) {
      $("card").innerHTML = '<div class="p-4 text-slate-400 text-sm">Wallet not registered — <a class="text-emerald-300 underline" href="/docs/agent-access">register via POST /api/wallets</a></div>';
      return;
    }
    const rec = await recRes.json();
    const lim = await limRes.json();
    render(rec, lim);
  } catch (e) { $("err").textContent = String(e.message || e); }
}

function bar(used, cap) {
  if (cap === undefined) return "";
  const pct = cap > 0 ? Math.min(100, Math.round((used / cap) * 100)) : 0;
  const color = pct >= 90 ? "bg-red-500" : pct >= 60 ? "bg-amber-500" : "bg-emerald-500";
  return '<div class="h-2 rounded bg-slate-800"><div class="h-2 rounded ' + color + '" style="width:' + pct + '%"></div></div>' +
    '<div class="text-xs text-slate-500 mt-1">$' + fmt(used) + ' / $' + fmt(cap) + ' (' + pct + '%)</div>';
}

function circleNum(circle, k) {
  if (!circle || typeof circle !== "object") return undefined;
  const v = circle[k === "perTxUsd" ? "perTx" : k.replace("Usd", "")];
  const n = Number(v); return Number.isFinite(n) ? n : undefined;
}

function eff(capEnv, circle, k) {
  const a = capEnv[k]; const b = circleNum(circle, k);
  if (a === undefined && b === undefined) return "—";
  if (a === undefined) return "$" + fmt(b) + " <span class=\\"text-slate-500\\">(circle)</span>";
  if (b === undefined) return "$" + fmt(a) + " <span class=\\"text-slate-500\\">(envelope)</span>";
  const m = Math.min(a, b);
  return "$" + fmt(m) + " <span class=\\"text-slate-500\\">(" + (a <= b ? "envelope" : "circle") + ")</span>";
}

function render(rec, lim) {
  const caps = lim.envelope.caps || {};
  const usage = lim.envelope.usage || {};
  const circle = lim.circle;
  let circleHtml;
  if (circle === "mainnet-only") {
    circleHtml = '<div class="text-sm text-slate-400">Circle policy limits live on <b>Arc mainnet</b> — this chain (' + CHAIN + ') uses platform envelope only.</div>';
  } else if (circle === "unavailable") {
    circleHtml = '<div class="text-sm text-slate-400">Circle CLI unavailable on this node — policy mirror offline. Platform envelope below still applies.</div>';
  } else {
    const c = circle || {};
    circleHtml = '<table class="w-full text-sm"><tbody>' +
      [["Per-tx", c.perTx], ["Daily", c.daily], ["Weekly", c.weekly], ["Monthly", c.monthly]]
        .map(([l, v]) => '<tr><td class="py-1 text-slate-400">' + l + '</td><td class="py-1 text-right font-mono">$' + (v ?? "—") + '</td></tr>').join("") +
      '</tbody></table>' +
      '<button class="mt-3 ' + '${BTN}'.replace(/'/g, "") + '" onclick="genCmd()">Set Circle limits →</button>';
  }
  const rows = Object.keys(win).map((w) => {
    const k = win[w]; const u = usage[w] || { used: 0 };
    return '<tr><td class="py-2 text-slate-400">' + w +
      '<input data-k="' + k + '" value="' + (caps[k] ?? "") + '" placeholder="∞" class="ml-2 w-20 rounded border border-slate-700 bg-slate-900 px-2 py-0.5 text-sm text-right font-mono"/>' +
      '</td><td class="py-2 px-3">' + bar(u.used, u.cap) +
      '</td><td class="py-2 text-right font-mono text-sm">' + eff(caps, circle === "mainnet-only" || circle === "unavailable" ? null : circle, k) + '</td></tr>';
  }).join("");
  $("card").innerHTML =
    '<div class="flex items-center justify-between"><div><div class="font-mono text-emerald-300">' + rec.address + '</div>' +
    '<div class="text-xs text-slate-500">' + (rec.label || "") + ' · ' + (rec.kind || "") + (rec.balance !== undefined ? ' · balance ' + fmt(rec.balance) : "") + '</div></div>' +
    '<button class="${BTN}" onclick="saveCaps()">Save platform caps</button></div>' +
    '<table class="w-full mt-4"><thead><tr class="text-left text-xs uppercase text-slate-500"><th class="py-1">Cap (USD)</th><th class="py-1 px-3">Window usage</th><th class="py-1 text-right">Effective</th></tr></thead><tbody>' + rows + '</tbody></table>' +
    '<div class="mt-5 border-t border-slate-800 pt-4"><h3 class="text-sm font-semibold text-slate-300 mb-2">Circle policy mirror</h3>' + circleHtml + '<div id="cmd"></div></div>';
}

async function genCmd() {
  const addr = wallet || $("addr").value.trim();
  const body = {};
  document.querySelectorAll("#card input[data-k]").forEach((i) => { if (i.value.trim()) body[i.dataset.k] = Number(i.value); });
  const r = await fetch("/api/wallets/" + addr + "/limits/command", {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
  });
  const j = await r.json();
  if (!r.ok) { $("cmd").innerHTML = '<div class="mt-3 text-sm text-red-400">' + (j.message || j.error || "failed") + '</div>'; return; }
  $("cmd").innerHTML = '<div class="mt-3 rounded-lg border border-slate-700 bg-slate-950 p-3">' +
    '<div class="text-xs text-slate-500 mb-1">Run in your own terminal — Circle emails the OTP to the owner. Never share it, never paste it here.</div>' +
    '<pre class="text-xs font-mono text-emerald-300 whitespace-pre-wrap">' + j.command + '</pre>' +
    '<button class="mt-2 ' + '${BTN}'.replace(/'/g, "") + '" onclick="navigator.clipboard.writeText(j_command)">Copy</button></div>';
  window.j_command = j.commandLine;
}

async function saveCaps() {
  const addr = wallet || $("addr").value.trim();
  const body = {};
  document.querySelectorAll("#card input[data-k]").forEach((i) => { if (i.value.trim()) body[i.dataset.k] = Number(i.value); });
  const path = "/api/wallets/" + addr + "/envelope";
  try {
    const sig = await venueSign(addr, "PATCH", path);
    const r = await fetch(path, { method: "PATCH", headers: { ...sig, "content-type": "application/json" }, body: JSON.stringify(body) });
    const j = await r.json();
    if (!r.ok) throw new Error(j.message || j.error || "save failed");
    load();
  } catch (e) { $("err").textContent = String(e.message || e); }
}

$("connect").onclick = async () => { try { wallet = await venueConnect(CHAIN_ID); $("addr").value = wallet; load(); } catch (e) { $("err").textContent = String(e.message || e); } };
$("load").onclick = load;
`;

  const body = html`<main class="mx-auto max-w-3xl px-4 py-10">
      <h1 class="text-2xl font-bold">Agent Wallets</h1>
      <p class="mt-1 text-sm text-slate-400">
        Platform spend envelope + Circle policy mirror (read-only).
        Circle limit changes always happen in <b>your</b> terminal —
        this page never asks for an OTP.
      </p>
      <div class="${CARD} mt-6">
        <div class="flex flex-wrap items-end gap-3">
          <input id="addr" class="${INPUT} flex-1 min-w-64" placeholder="0x… agent wallet address" />
          <button id="connect" class="${BTN}">Connect</button>
          <button id="load" class="${BTN}">Load</button>
        </div>
        <div id="err" class="mt-2 text-sm text-red-400"></div>
      </div>
      <div id="card" class="${CARD} mt-4">
        <div class="p-4 text-sm text-slate-400">
          Enter an address or connect your wallet to view caps, usage,
          and the Circle policy mirror.
        </div>
      </div>
      <script>${raw(WALLET_JS)}${raw(js)}</script>
    </main>`;
  return Layout(
    body as unknown as string,
    undefined,
    {
      title: "Agent Wallets",
      description:
        "Agent wallet spend envelope + Circle policy mirror (read-only OTP-free console)",
      path: "/wallets",
    },
    undefined,
    true,
  ).toString();
}
