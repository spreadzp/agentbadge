/**
 * SLICE-221-4 (EPIC-221, D-221-3): Checkout orchestrator.
 *
 * Flow: collect metadata form → POST /api/v1/payments → POST
 * /api/v1/payments/:id/attempts → Stripe redirect OR USDC instructions
 * (recipient + QR + amount + reference + expiry) → status polling
 * (GET /api/v1/payments/:id) → receipt view.
 */
(function () {
  "use strict";

  var POLL_INTERVAL_MS = 4000;
  var POLL_MAX_ATTEMPTS = 150; // ~10 min

  function $(id) {
    return document.getElementById(id);
  }

  function show(el) {
    if (el) el.classList.remove("hidden");
  }

  function hide(el) {
    if (el) el.classList.add("hidden");
  }

  function toast(msg, type) {
    if (window.Toast && window.Toast.show) {
      window.Toast.show(msg, { type: type || "info", duration: 6000 });
    }
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, function (ch) {
      return {
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;",
      }[ch];
    });
  }

  function api(path, opts) {
    return fetch(path, opts).then(function (res) {
      return res.json().then(function (body) {
        if (!res.ok) {
          throw new Error(
            (body && (body.message || body.error)) ||
              "Request failed (" + res.status + ")",
          );
        }
        return body;
      });
    });
  }

  /** string[] fields are comma-separated inputs → arrays. */
  function collectMetadata(form) {
    var metadata = {};
    form.querySelectorAll("input[name][data-field-type]").forEach(function (input) {
      var value = input.value.trim();
      if (!value) return;
      if (input.getAttribute("data-field-type") === "string[]") {
        metadata[input.name] = value
          .split(",")
          .map(function (s) { return s.trim(); })
          .filter(Boolean);
      } else {
        metadata[input.name] = value;
      }
    });
    return metadata;
  }

  function renderStatus(statusEl, text, tone) {
    statusEl.innerHTML =
      '<p class="' +
      (tone === "error" ? "text-red-400" : tone === "ok" ? "text-emerald-400" : "text-slate-300") +
      '">' + escapeHtml(text) + "</p>";
    show(statusEl);
  }

  function renderInstructions(box, inst) {
    var qrUrl = "/checkout/qr.svg?data=" + encodeURIComponent(inst.recipient);
    box.innerHTML =
      '<div class="rounded-lg border border-sky-800/50 bg-slate-950 p-5">' +
      '<h2 class="text-sm font-semibold text-white">Send USDC to complete payment</h2>' +
      '<div class="mt-4 flex justify-center"><img src="' + qrUrl + '" alt="USDC payment QR code" width="160" height="160" class="rounded-lg border border-slate-800 bg-white p-2" /></div>' +
      '<dl class="mt-4 space-y-2 text-sm">' +
      '<div class="flex justify-between gap-4"><dt class="text-slate-400">Amount</dt><dd class="font-mono text-emerald-400">' + escapeHtml(inst.amount) + " " + escapeHtml(inst.asset || "USDC") + "</dd></div>" +
      '<div class="flex justify-between gap-4"><dt class="text-slate-400">Network</dt><dd class="font-mono text-slate-200">' + escapeHtml(inst.network) + "</dd></div>" +
      '<div><dt class="text-slate-400">Recipient</dt><dd class="mt-1 break-all font-mono text-xs text-slate-200">' + escapeHtml(inst.recipient) + "</dd></div>" +
      (inst.tokenContract ? '<div><dt class="text-slate-400">Token contract</dt><dd class="mt-1 break-all font-mono text-xs text-slate-500">' + escapeHtml(inst.tokenContract) + "</dd></div>" : "") +
      '<div><dt class="text-slate-400">Reference (memo)</dt><dd class="mt-1 break-all font-mono text-xs text-sky-300">' + escapeHtml(inst.reference) + "</dd></div>" +
      (inst.expiresAt ? '<div class="flex justify-between gap-4"><dt class="text-slate-400">Expires</dt><dd class="text-xs text-slate-400">' + escapeHtml(new Date(inst.expiresAt).toLocaleString()) + "</dd></div>" : "") +
      "</dl>" +
      '<p class="mt-3 text-xs text-slate-500">Include the reference in your transfer memo/note so we can match your payment.</p>' +
      "</div>";
    show(box);
  }

  function renderReceipt(box, receipt) {
    var r = receipt || {};
    box.innerHTML =
      '<div class="rounded-lg border border-emerald-800/50 bg-emerald-950/30 p-5">' +
      '<h2 class="text-sm font-semibold text-emerald-300">Payment confirmed</h2>' +
      '<dl class="mt-3 space-y-1.5 text-sm">' +
      (r.reference ? '<div class="flex justify-between"><dt class="text-slate-400">Reference</dt><dd class="font-mono text-slate-200">' + escapeHtml(r.reference) + "</dd></div>" : "") +
      (r.amount ? '<div class="flex justify-between"><dt class="text-slate-400">Amount</dt><dd class="text-slate-200">$' + escapeHtml(r.amount) + "</dd></div>" : "") +
      (r.confirmedAt ? '<div class="flex justify-between"><dt class="text-slate-400">Confirmed</dt><dd class="text-slate-200">' + escapeHtml(new Date(r.confirmedAt).toLocaleString()) + "</dd></div>" : "") +
      "</dl>" +
      '<p class="mt-3 text-xs text-slate-400">Fulfillment is running — your entitlement activates automatically.</p>' +
      "</div>";
    show(box);
  }

  function pollStatus(paymentId, statusEl, receiptBox, done) {
    var attempts = 0;
    var timer = setInterval(function () {
      attempts += 1;
      if (attempts > POLL_MAX_ATTEMPTS) {
        clearInterval(timer);
        renderStatus(statusEl, "Still waiting for confirmation — the payment may take longer than expected. You can safely leave this page.", "error");
        return;
      }
      api("/api/v1/payments/" + encodeURIComponent(paymentId))
        .then(function (body) {
          var status = body.payment && body.payment.status;
          if (status === "CONFIRMED") {
            clearInterval(timer);
            api("/api/v1/payments/" + encodeURIComponent(paymentId) + "/receipt")
              .then(function (r) {
                renderStatus(statusEl, "Payment confirmed.", "ok");
                renderReceipt(receiptBox, r.receipt || r);
                if (done) done();
              })
              .catch(function () {
                renderStatus(statusEl, "Payment confirmed — receipt pending.", "ok");
                if (done) done();
              });
          } else if (status === "FAILED" || status === "EXPIRED") {
            clearInterval(timer);
            renderStatus(statusEl, "Payment " + status.toLowerCase() + ". You can start checkout again.", "error");
            if (done) done();
          } else {
            renderStatus(statusEl, "Waiting for payment confirmation… (" + status.toLowerCase() + ")", "info");
          }
        })
        .catch(function () {
          /* transient poll error — keep polling */
        });
    }, POLL_INTERVAL_MS);
  }

  document.addEventListener("DOMContentLoaded", function () {
    var form = $("checkout-form");
    if (!form) return;

    var methodSelect = $("f-method");
    var networkWrap = $("network-wrap");
    var submitBtn = $("checkout-submit");
    var instructionsBox = $("checkout-instructions");
    var statusEl = $("checkout-status");
    var receiptBox = $("checkout-receipt");

    function syncNetworkVisibility() {
      if (!methodSelect || !networkWrap) return;
      if (methodSelect.value === "usdc") show(networkWrap);
      else hide(networkWrap);
    }
    if (methodSelect) {
      methodSelect.addEventListener("change", syncNetworkVisibility);
      syncNetworkVisibility();
    }

    form.addEventListener("submit", function (e) {
      e.preventDefault();
      var productCode = form.getAttribute("data-product-code");
      if (!productCode) return;

      if (typeof form.reportValidity === "function" && !form.reportValidity()) {
        return;
      }

      var metadata = collectMetadata(form);
      var method = methodSelect ? methodSelect.value : "card";
      var networkSelect = $("f-network");
      var provider = method === "usdc" ? "DIRECT_USDC" : "STRIPE";

      submitBtn.disabled = true;
      submitBtn.textContent = "Creating payment…";

      api("/api/v1/payments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          productCode: productCode,
          metadata: Object.keys(metadata).length ? metadata : undefined,
        }),
      })
        .then(function (body) {
          var paymentId = body.payment && body.payment.id;
          if (!paymentId) throw new Error("No payment id returned");
          submitBtn.textContent = "Attaching payment rail…";
          var attemptBody = { provider: provider };
          if (provider === "DIRECT_USDC" && networkSelect) {
            attemptBody.network = networkSelect.value;
          }
          return api(
            "/api/v1/payments/" + encodeURIComponent(paymentId) + "/attempts",
            {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(attemptBody),
            },
          ).then(function (attempt) {
            return { paymentId: paymentId, attempt: attempt };
          });
        })
        .then(function (ctx) {
          var attempt = ctx.attempt;
          if (attempt.redirectUrl) {
            submitBtn.textContent = "Redirecting…";
            window.location.href = attempt.redirectUrl;
            return;
          }
          if (attempt.paymentInstructions) {
            hide(form);
            renderInstructions(instructionsBox, attempt.paymentInstructions);
            renderStatus(statusEl, "Waiting for payment confirmation…", "info");
            pollStatus(ctx.paymentId, statusEl, receiptBox);
            return;
          }
          throw new Error("No payment instructions returned");
        })
        .catch(function (err) {
          submitBtn.disabled = false;
          submitBtn.textContent = "Continue to payment";
          toast("Checkout error: " + err.message, "error");
        });
    });
  });
})();
