// src/ui/export.js
//
// Export panel (milestone 8): shows the standalone Strudel code for everything
// currently playing (see buildExportCode in pattern-builder.js), with copy-to-
// clipboard and download-as-.js buttons. The textarea auto-refreshes whenever the
// program changes (main calls refreshExport from rebuildAndPlay), so it always
// mirrors what you hear — paste it into strudel.cc and it sounds the same.

import { buildExportCode } from "../lib/pattern-builder.js";

let textarea = null;

export function initExport() {
  const container = document.getElementById("export");

  const bar = document.createElement("div");
  bar.className = "rec-bar";

  const refresh = document.createElement("button");
  refresh.id = "export-refresh";
  refresh.textContent = "refresh";

  const copy = document.createElement("button");
  copy.id = "export-copy";
  copy.textContent = "copy";

  const download = document.createElement("button");
  download.id = "export-download";
  download.textContent = "download .js";

  bar.append(refresh, copy, download);
  container.appendChild(bar);

  textarea = document.createElement("textarea");
  textarea.id = "export-code";
  textarea.readOnly = true;
  textarea.rows = 12;
  textarea.spellcheck = false;
  container.appendChild(textarea);

  refresh.addEventListener("click", refreshExport);

  copy.addEventListener("click", async () => {
    refreshExport();
    try {
      await navigator.clipboard.writeText(textarea.value);
    } catch {
      // clipboard API blocked (e.g. no permission) — fall back to selection copy
      textarea.select();
      document.execCommand?.("copy");
    }
    flash(copy, "copied!");
  });

  download.addEventListener("click", () => {
    refreshExport();
    const blob = new Blob([textarea.value], { type: "text/javascript" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "tonus.js";
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  });

  refreshExport();
}

// Regenerate the displayed code from current state. Called on every program
// change so the panel never goes stale.
export function refreshExport() {
  if (textarea) textarea.value = buildExportCode();
}

function flash(btn, text) {
  const orig = btn.textContent;
  btn.textContent = text;
  setTimeout(() => (btn.textContent = orig), 1000);
}
