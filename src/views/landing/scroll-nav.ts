import { html } from "hono/html";

/**
 * Floating scroll-nav buttons — sticky on the right edge inside the page.
 *
 * State machine (scroll listener, no libs):
 * - page top:    only "scroll to bottom"
 * - mid-scroll:  both up + down
 * - page bottom: only "scroll to top"
 * - page shorter than viewport: nav hidden entirely
 *
 * `hidden` on the up-button in the markup = correct pre-JS state (top of page).
 */
export function ScrollNavButtons(): ReturnType<typeof html> {
  const btnClass =
    "flex h-10 w-10 items-center justify-center rounded-full border border-slate-700 bg-slate-800/80 text-slate-300 shadow-lg backdrop-blur transition hover:border-emerald-500 hover:text-emerald-400";

  return html`
    <nav
      id="scroll-nav"
      aria-label="Page scroll navigation"
      class="fixed bottom-24 right-4 z-40 hidden flex-col gap-2 md:flex"
    >
      <button id="scroll-nav-up" type="button" aria-label="Scroll to top" title="Scroll to top" class="${btnClass} hidden">
        <svg class="h-5 w-5" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M5 10l7-7m0 0l7 7m-7-7v18" /></svg>
      </button>
      <button id="scroll-nav-down" type="button" aria-label="Scroll to bottom" title="Scroll to bottom" class="${btnClass}">
        <svg class="h-5 w-5" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M19 14l-7 7m0 0l-7-7m7 7V3" /></svg>
      </button>
    </nav>
    <script>
      (function () {
        var nav = document.getElementById("scroll-nav");
        var up = document.getElementById("scroll-nav-up");
        var down = document.getElementById("scroll-nav-down");
        if (!nav || !up || !down) return;
        up.addEventListener("click", function () {
          window.scrollTo({ top: 0, behavior: "smooth" });
        });
        down.addEventListener("click", function () {
          window.scrollTo({ top: document.documentElement.scrollHeight, behavior: "smooth" });
        });
        var EDGE = 8;
        function update() {
          var y = window.scrollY || window.pageYOffset;
          var max = document.documentElement.scrollHeight - window.innerHeight;
          var atTop = y <= EDGE;
          var atBottom = y >= max - EDGE;
          up.classList.toggle("hidden", atTop);
          down.classList.toggle("hidden", atBottom);
        }
        window.addEventListener("scroll", update, { passive: true });
        window.addEventListener("resize", update);
        update();
      })();
    </script>
  `;
}
