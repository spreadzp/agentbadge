/**
 * SLICE-153-6: client-rating card on the job detail page.
 *
 * Rendered only for completed jobs. Unrated → 5-star form + comment that
 * POSTs /api/venue/jobs/:id/rate, broadcasts giveFeedback from the client
 * wallet, then attaches the tx via phase "rated". Rated → stars + comment
 * + tx link. The client-wallet gate runs client-side (data-client check)
 * AND server-side (onchain job.client must equal the signer).
 */
import { html, raw } from "hono/html";
import type { VenueJob } from "../server/lib/venue/store";
import type { VenueNetwork } from "../server/lib/venue/chain";
import { CARD, WALLET_JS } from "./venue-ui";

const RATE_SCRIPT = `
(function () {
  var card = document.getElementById("rate-card");
  if (!card || !card.dataset.job) return; // rated already or not completed
  var JOB = card.dataset.job, CLIENT = card.dataset.client;
  var score = 0, status = document.getElementById("rate-status");
  var stars = Array.prototype.slice.call(card.querySelectorAll(".rate-star"));
  var paint = function () {
    stars.forEach(function (s, i) {
      s.classList.toggle("text-amber-300", i < score);
      s.classList.toggle("text-slate-600", i >= score);
    });
  };
  stars.forEach(function (s) {
    s.onclick = function () { score = Number(s.dataset.star); paint(); };
  });
  document.getElementById("rate-submit").onclick = async function () {
    try {
      if (!score) { status.textContent = "pick a score 1-5"; return; }
      if (!window.ethereum) { status.textContent = "connect a wallet first"; return; }
      var acc = await venueConnect(CHAIN_ID_HEX);
      if (acc.toLowerCase() !== CLIENT.toLowerCase()) {
        status.textContent = "only the job client can rate this job"; return;
      }
      status.textContent = "signing…";
      var path = "/api/venue/jobs/" + JOB + "/rate";
      var hdr = await venueSign(acc, "POST", path);
      hdr["content-type"] = "application/json";
      var res = await fetch(path, { method: "POST", headers: hdr,
        body: JSON.stringify({ score: score,
          comment: document.getElementById("rate-comment").value || undefined }) });
      var out = await res.json();
      if (!res.ok) {
        status.textContent = (out.error && out.error.message) || "rate failed " + res.status;
        return;
      }
      status.textContent = "broadcast giveFeedback…";
      var txHash = await ethereum.request({ method: "eth_sendTransaction",
        params: [{ from: acc, to: out.tx.to, data: out.tx.data }] });
      status.textContent = "attaching tx " + txHash.slice(0, 10) + "…";
      await fetch("/api/venue/jobs/" + JOB + "/tx", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ hash: txHash, phase: "rated" }) });
      location.reload();
    } catch (e) {
      status.textContent = "error: " + (e && e.message ? e.message : e);
    }
  };
  paint();
})();
`;

export function venueRateCard(job: VenueJob, net: VenueNetwork): string {
  if (job.status !== "completed") return "";
  const chainIdHex = `0x${net.chain.chainId.toString(16)}`;
  if (job.rating) {
    const stars = "★".repeat(job.rating.score) +
      "☆".repeat(5 - job.rating.score);
    return String(html`<div class="${CARD} mt-4" id="rate-card">
      <h2 class="text-sm font-semibold text-slate-300">Client rating</h2>
      <p class="mt-2 text-lg text-amber-300">${stars}
        <span class="ml-2 text-sm text-slate-400">${job.rating.score}/5 rated ✓</span></p>
      ${job.rating.comment
        ? html`<p class="mt-1 text-sm text-slate-300">“${job.rating.comment}”</p>` : ""}
      ${job.rating.txHash
        ? html`<a class="mt-2 inline-block text-xs text-sky-400 hover:underline"
            href="${net.explorerTx(job.rating.txHash)}" target="_blank" rel="noopener">giveFeedback tx ⧉</a>` : ""}
    </div>`);
  }
  return String(html`<div class="${CARD} mt-4" id="rate-card"
    data-client="${job.client}" data-job="${job.jobId}">
    <h2 class="text-sm font-semibold text-slate-300">Rate this provider</h2>
    <p class="mt-1 text-xs text-slate-500">Subjective 1–5 score — written to ERC-8004 from your client wallet.</p>
    <div class="mt-3 flex items-center gap-1" id="rate-stars">
      ${raw([1, 2, 3, 4, 5].map((i) =>
    `<button type="button" data-star="${i}" class="rate-star text-2xl text-slate-600 hover:text-amber-300">★</button>`,
  ).join(""))}
    </div>
    <textarea id="rate-comment" rows="2" maxlength="500" placeholder="Comment (optional)"
      class="mt-3 w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-100 placeholder-slate-600 focus:border-emerald-500 focus:outline-none"></textarea>
    <div class="mt-3 flex items-center gap-3">
      <button id="rate-submit" class="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-500">Submit rating</button>
      <span id="rate-status" class="text-xs text-slate-500"></span>
    </div>
  </div>
  <script>${raw(WALLET_JS)}
    var CHAIN_ID_HEX = "${chainIdHex}";
    ${raw(RATE_SCRIPT)}
  </script>`);
}
