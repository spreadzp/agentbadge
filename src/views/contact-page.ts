import { Layout } from "./layout";
import { raw } from "hono/html";
import { PageMeta } from "../server/lib/page-meta";

const DISCORD_ICON = `<svg class="h-5 w-5" fill="currentColor" viewBox="0 0 24 24"><path d="M20.317 4.37a19.79 19.79 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.872-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028c.462-.63.874-1.295 1.226-1.994a.076.076 0 0 0-.041-.106 13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128c.126-.094.252-.192.372-.291a.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.009c.12.099.246.198.373.292a.077.077 0 0 1-.006.127 12.3 12.3 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.946 2.418-2.157 2.418z"/></svg>`;

const TELEGRAM_ICON = `<svg class="h-5 w-5" fill="currentColor" viewBox="0 0 24 24"><path d="M11.944 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0a12 12 0 0 0-.056 0zm4.962 7.224c.1-.002.321.023.465.14a.506.506 0 0 1 .171.325c.016.093.036.306.02.472-.18 1.898-.962 6.502-1.36 8.627-.168.9-.499 1.201-.82 1.23-.696.065-1.225-.46-1.9-.902-1.056-.693-1.653-1.124-2.678-1.8-1.185-.78-.417-1.21.258-1.91.177-.184 3.247-2.977 3.307-3.23.007-.032.014-.15-.056-.212s-.174-.041-.249-.024c-.106.024-1.793 1.14-5.061 3.345-.48.33-.913.49-1.302.48-.428-.008-1.252-.241-1.865-.44-.752-.245-1.349-.374-1.297-.789.027-.216.325-.437.893-.663 3.498-1.524 5.83-2.531 6.998-3.02 3.332-1.387 4.025-1.627 4.476-1.635z"/></svg>`;

export function contactPage() {
  return Layout(
    raw(`
    <div class="mx-auto max-w-2xl">
      <h1 class="text-2xl font-bold text-white">Contact &amp; Feedback</h1>
      <p class="mt-2 text-sm text-slate-400">
        Send us a message via Discord or Telegram. We'll get back to you.
      </p>

      <form
        hx-post="/contact"
        hx-target="#contact-result"
        hx-swap="innerHTML"
        hx-encoding="multipart/form-data"
        hx-on::after-request="if(event.detail.failed && !event.detail.successful){document.getElementById('contact-result').innerHTML='<div class=\\'rounded-lg border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-300\\'><p class=\\'font-medium\\'>Failed to send feedback</p><p class=\\'mt-1 text-red-400/70\\'>Server error ('+event.detail.xhr.status+'). Try again later.</p></div>';}"
        class="mt-6 space-y-4"
        id="contact-form"
      >
        <div>
          <label class="block text-sm font-medium text-slate-300">Channel</label>
          <div class="mt-2 flex flex-col gap-3 sm:flex-row">
            <button type="button" data-channel="discord"
              class="channel-btn flex items-center justify-center gap-2 rounded-lg border border-slate-700 bg-slate-800 px-4 py-2.5 text-sm text-slate-300 transition-colors hover:border-emerald-500 hover:text-white">
              ${DISCORD_ICON}
              <span>Discord</span>
            </button>
            <button type="button" data-channel="telegram"
              class="channel-btn flex items-center justify-center gap-2 rounded-lg border border-slate-700 bg-slate-800 px-4 py-2.5 text-sm text-slate-300 transition-colors hover:border-emerald-500 hover:text-white">
              ${TELEGRAM_ICON}
              <span>Telegram</span>
            </button>
          </div>
          <input type="hidden" name="channel" id="channel-input" required />
        </div>

        <div>
          <label class="block text-sm font-medium text-slate-300">Message</label>
          <textarea name="message" required maxlength="4096" rows="6"
            class="mt-1 w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-white placeholder-slate-500 focus:border-emerald-500 focus:outline-none"
            placeholder="Your message..."></textarea>
          <p class="mt-1 text-xs text-slate-500"><span id="char-count">0</span> / 4096</p>
        </div>

        <div>
          <label class="block text-sm font-medium text-slate-300">Contact (optional)</label>
          <input type="text" name="contactInfo" maxlength="200"
            class="mt-1 w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-white placeholder-slate-500 focus:border-emerald-500 focus:outline-none"
            placeholder="Your Telegram/Discord nickname or email" />
        </div>

        <div>
          <label class="block text-sm font-medium text-slate-300">Attachment (optional, max 1MB)</label>
          <input type="file" name="file" id="file-input"
            class="mt-1 block w-full text-sm text-slate-400 file:mr-3 file:rounded-lg file:border-0 file:bg-slate-700 file:px-4 file:py-2 file:text-slate-300 hover:file:bg-slate-600" />
          <p id="file-name-display" class="mt-1 hidden text-xs text-emerald-400"></p>
        </div>

        <button type="submit"
          class="w-full rounded-lg bg-emerald-600 px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-50"
          id="submit-btn" disabled>
          Send Feedback
        </button>
      </form>

      <div id="contact-result" class="mt-4"></div>
    </div>

    <script>
      document.querySelectorAll('.channel-btn').forEach(function(btn) {
        btn.addEventListener('click', function() {
          document.querySelectorAll('.channel-btn').forEach(function(b) {
            b.classList.remove('border-emerald-500', 'text-white', 'bg-emerald-500/10');
          });
          btn.classList.add('border-emerald-500', 'text-white', 'bg-emerald-500/10');
          document.getElementById('channel-input').value = btn.dataset.channel;
          updateSubmitBtn();
        });
      });
      var textarea = document.querySelector('textarea[name="message"]');
      textarea.addEventListener('input', function() {
        document.getElementById('char-count').textContent = textarea.value.length;
        updateSubmitBtn();
      });
      var fileInput = document.getElementById('file-input');
      fileInput.addEventListener('change', function() {
        var display = document.getElementById('file-name-display');
        if (fileInput.files.length > 0) {
          var file = fileInput.files[0];
          var sizeKB = (file.size / 1024).toFixed(1);
          display.textContent = file.name + ' (' + sizeKB + ' KB)';
          display.classList.remove('hidden');
        } else {
          display.classList.add('hidden');
        }
      });
      function updateSubmitBtn() {
        var channel = document.getElementById('channel-input').value;
        var message = textarea.value.trim();
        document.getElementById('submit-btn').disabled = !channel || !message;
      }
    </script>
    `),
    "Contact & Feedback",
    PageMeta["/contact"],
  );
}

export function contactSuccessFragment(channel: string): string {
  return `<div class="rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-300">
    <p class="font-medium">Feedback sent via ${channel}!</p>
    <p class="mt-1 text-emerald-400/70">Thank you. We'll get back to you if you provided contact info.</p>
  </div>`;
}

export function contactErrorFragment(error: string): string {
  return `<div class="rounded-lg border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-300">
    <p class="font-medium">Failed to send feedback</p>
    <p class="mt-1 text-red-400/70">${error}</p>
  </div>`;
}
