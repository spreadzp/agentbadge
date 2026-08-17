/**
 * SLICE-67-7: Client-side Stripe Checkout handler.
 *
 * Attaches to elements with class "stripe-pay-btn" and data-product-id attribute.
 * On click, calls POST /api/payment/checkout and redirects to the Stripe URL.
 */
(function () {
  "use strict";

  document.addEventListener("DOMContentLoaded", function () {
    var buttons = document.querySelectorAll(".stripe-pay-btn");
    if (!buttons.length) return;

    buttons.forEach(function (btn) {
      btn.addEventListener("click", function () {
        var productId = btn.getAttribute("data-product-id");
        if (!productId) return;

        // Collect metadata from data attributes
        var metadata = {};
        for (var i = 0; i < btn.attributes.length; i++) {
          var attr = btn.attributes[i];
          if (attr.name.startsWith("data-meta-")) {
            var key = attr.name.replace("data-meta-", "");
            metadata[key] = attr.value;
          }
        }

        // Collect email if available
        var emailInput = document.querySelector("[data-stripe-email]");
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
            alert("Payment error: " + err.message);
          });
      });
    });
  });
})();
