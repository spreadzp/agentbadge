/**
 * Lightweight toast notification system.
 * Replaces native alert() with styled, auto-dismissing toasts.
 *
 * Usage:
 *   Toast.show("Message here", { type: "error" });
 *   Toast.show("Message here", { type: "warning", duration: 4000 });
 */
(function () {
  "use strict";

  var containerId = "toast-container";

  function ensureContainer() {
    var existing = document.getElementById(containerId);
    if (existing) return existing;
    var container = document.createElement("div");
    container.id = containerId;
    container.style.cssText =
      "position:fixed;top:1rem;right:1rem;z-index:9999;display:flex;flex-direction:column;gap:0.5rem;pointer-events:none;max-width:24rem;";
    document.body.appendChild(container);
    return container;
  }

  function show(message, opts) {
    opts = opts || {};
    var type = opts.type || "info";
    var duration = opts.duration || 4000;

    var container = ensureContainer();

    var colors = {
      error: "bg-red-900/95 border-red-600 text-red-100",
      warning: "bg-amber-900/95 border-amber-600 text-amber-100",
      info: "bg-slate-800/95 border-slate-600 text-slate-100",
      success: "bg-emerald-900/95 border-emerald-600 text-emerald-100",
    };

    var icons = {
      error: "&#9888;",
      warning: "&#9888;",
      info: "&#8505;",
      success: "&#10003;",
    };

    var toast = document.createElement("div");
    toast.className =
      "pointer-events-auto flex items-start gap-3 rounded-lg border px-4 py-3 shadow-lg backdrop-blur-sm transition-all duration-300 opacity-0 translate-x-4 " +
      (colors[type] || colors.info);
    toast.style.cssText = "min-width:18rem;";

    toast.innerHTML =
      '<span class="text-lg leading-none flex-shrink-0">' +
      (icons[type] || icons.info) +
      "</span>" +
      '<p class="text-sm leading-snug flex-1">' +
      escapeHtml(message) +
      "</p>" +
      '<button type="button" class="flex-shrink-0 text-current opacity-60 hover:opacity-100 transition-opacity" aria-label="Dismiss">' +
      "&times;</button>";

    container.appendChild(toast);

    // Animate in
    requestAnimationFrame(function () {
      toast.classList.remove("opacity-0", "translate-x-4");
    });

    function dismiss() {
      toast.classList.add("opacity-0", "translate-x-4");
      setTimeout(function () {
        if (toast.parentNode) toast.parentNode.removeChild(toast);
      }, 300);
    }

    // Click to dismiss
    toast.querySelector("button").addEventListener("click", dismiss);
    toast.addEventListener("click", dismiss);

    // Auto-dismiss
    if (duration > 0) {
      setTimeout(dismiss, duration);
    }
  }

  function escapeHtml(str) {
    var div = document.createElement("div");
    div.textContent = str;
    return div.innerHTML;
  }

  // Expose globally
  window.Toast = { show: show };
})();
