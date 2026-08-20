/**
 * SLICE-67-7: Client-side Stripe Checkout handler.
 *
 * Attaches to elements with class "stripe-pay-btn" and data-product-id attribute.
 * On click, calls POST /api/payment/checkout and redirects to the Stripe URL.
 */
(function () {
  "use strict";

  document.addEventListener("DOMContentLoaded", function () {
    // Network dropdown toggle
    var dropdowns = document.querySelectorAll("[data-network-dropdown]");
    dropdowns.forEach(function (dd) {
      var btn = dd.querySelector("[data-network-button]");
      var panel = dd.querySelector("[data-network-options]");
      var hidden = dd.querySelector("[data-stripe-network]");
      var label = dd.querySelector("[data-network-label]");
      if (!btn || !panel) return;

      btn.addEventListener("click", function (e) {
        e.preventDefault();
        panel.classList.toggle("hidden");
      });

      panel.querySelectorAll("[data-network]").forEach(function (opt) {
        opt.addEventListener("click", function () {
          if (opt.disabled) return;
          var net = opt.getAttribute("data-network");
          hidden.value = net;
          label.textContent = opt.textContent.trim();
          // Copy icon SVG from option to button
          var btnIcon = btn.querySelector("svg:first-child");
          var optIcon = opt.querySelector("svg");
          if (btnIcon && optIcon) {
            btnIcon.replaceWith(optIcon.cloneNode(true));
          }
          panel.classList.add("hidden");
        });
      });
    });

    // Close dropdowns when clicking outside
    document.addEventListener("click", function (e) {
      dropdowns.forEach(function (dd) {
        if (!dd.contains(e.target)) {
          var panel = dd.querySelector("[data-network-options]");
          if (panel) panel.classList.add("hidden");
        }
      });
    });

    var buttons = document.querySelectorAll(".stripe-pay-btn");
    if (!buttons.length) return;

    buttons.forEach(function (btn) {
      btn.addEventListener("click", function () {
        var productId = btn.getAttribute("data-product-id");
        if (!productId) return;

        // Scope lookups to the tier card (parent <article>)
        var card = btn.closest("article");

        // Collect metadata from data attributes on the button
        var metadata = {};
        for (var i = 0; i < btn.attributes.length; i++) {
          var attr = btn.attributes[i];
          if (attr.name.startsWith("data-meta-")) {
            var key = attr.name.replace("data-meta-", "");
            metadata[key] = attr.value;
          }
        }

        // Collect network, accountId and agentName from inputs in the same card
        var networkSelect = card ? card.querySelector("[data-stripe-network]") : null;
        var network = networkSelect ? networkSelect.value : "hedera";
        var accountIdInput = card ? card.querySelector("[data-stripe-account-id]") : null;
        var accountId = accountIdInput ? accountIdInput.value.trim() : "";
        var agentNameInput = card ? card.querySelector("[data-stripe-agent-name]") : null;
        var agentName = agentNameInput ? agentNameInput.value.trim() : "";

        // For passport products, accountId is required for NFT minting
        if (productId.indexOf("passport-") === 0) {
          if (!accountId) {
            Toast.show("Please enter your Hedera Account ID (e.g. 0.0.1234) to mint the passport NFT.", { type: "warning" });
            accountIdInput && accountIdInput.focus();
            return;
          }
          // Validate Hedera Account ID format: shard.realm.num (e.g. 0.0.1234)
          if (network === "hedera" && !/^\d+\.\d+\.\d+$/.test(accountId)) {
            Toast.show("Invalid Hedera Account ID format. Expected shard.realm.num (e.g. 0.0.1234).", { type: "error", duration: 6000 });
            accountIdInput && accountIdInput.focus();
            return;
          }
        }

        if (accountId) metadata.accountId = accountId;
        if (agentName) metadata.name = agentName;
        if (network !== "hedera") metadata.network = network;

        // Collect email if available (global or card-scoped)
        var emailInput = (card ? card.querySelector("[data-stripe-email]") : null) || document.querySelector("[data-stripe-email]");
        var email = emailInput ? emailInput.value.trim() : undefined;

        btn.disabled = true;
        btn.textContent = "Redirecting to Stripe...";

        fetch("/api/payment/checkout", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            productId: productId,
            email: email,
            metadata: Object.keys(metadata).length > 0 ? metadata : undefined,
          }),
        })
          .then(function (res) {
            if (!res.ok) {
              return res.json().then(function (err) {
                throw new Error(err.error || "Checkout failed");
              });
            }
            return res.json();
          })
          .then(function (data) {
            if (data.url) {
              window.location.href = data.url;
            } else {
              throw new Error("No checkout URL returned");
            }
          })
          .catch(function (err) {
            btn.disabled = false;
            btn.textContent = "Pay with Card";
            Toast.show("Payment error: " + err.message, { type: "error", duration: 6000 });
          });
      });
    });
  });
})();
