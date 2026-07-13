/* gate.js
 *
 * Client-side, code-based access gate for design previews on designs.esub.com.
 * A gated page ships ONLY an encrypted payload (content.enc). This script
 * prompts the visitor for the page's access code, derives an AES-256-GCM key
 * from that code (PBKDF2-HMAC-SHA256), fetches content.enc, and decrypts it
 * in the browser. On success the real page is rendered; on failure the visitor
 * can retry, and if the payload is missing/unreadable the eSUB 404 is shown.
 *
 * REQUIRED BOILERPLATE in each gated page's <head>:
 *   <style>html { visibility: hidden; }</style>
 *   <script>window.__DESIGN_GATE__ = { enc: "content.enc", title: "eSUB Designs" };</script>
 *   <script src="/gate.js" defer></script>
 *
 * SECURITY MODEL: The page content is genuinely encrypted — without the
 * correct code the payload is unreadable (view-source shows only ciphertext).
 * Codes are case-sensitive and never stored in the repo (only a per-page salt
 * and a salted verifier are). This is real content protection, but it is still
 * a shared-secret scheme: anyone who has a valid code can decrypt that page,
 * and once decrypted the content lives in the visitor's browser. Rotate codes
 * by re-encoding (see designs-internal/publish.py).
 *
 * These crypto parameters MUST match designs-internal/publish.py exactly.
 */
(function () {
  "use strict";

  var CFG = window.__DESIGN_GATE__ || {};
  var ENC_PATH = CFG.enc || "content.enc";      // relative to the page's directory
  var STORAGE_KEY = "designs-code:" + location.pathname;

  // ---- helpers ------------------------------------------------------------
  function b64ToBytes(b64) {
    var bin = atob(b64);
    var out = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }

  function reveal() { document.documentElement.style.visibility = "visible"; }

  async function deriveKey(code, saltBytes, iterations) {
    var enc = new TextEncoder();
    var baseKey = await crypto.subtle.importKey(
      "raw", enc.encode(code), { name: "PBKDF2" }, false, ["deriveKey"]
    );
    return crypto.subtle.deriveKey(
      { name: "PBKDF2", salt: saltBytes, iterations: iterations, hash: "SHA-256" },
      baseKey,
      { name: "AES-GCM", length: 256 },
      false,
      ["decrypt"]
    );
  }

  // Returns decrypted HTML string, or throws (wrong code / tampered payload).
  async function decrypt(envelope, code) {
    var salt = b64ToBytes(envelope.salt);
    var iv = b64ToBytes(envelope.iv);
    var ct = b64ToBytes(envelope.ct);            // ciphertext + GCM tag
    var key = await deriveKey(code, salt, envelope.iter);
    var plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: iv }, key, ct);
    return new TextDecoder().decode(plain);
  }

  var _envelope = null;
  async function loadEnvelope() {
    if (_envelope) return _envelope;
    var res = await fetch(ENC_PATH, { cache: "no-store" });
    if (!res.ok) throw new Error("payload-missing");
    _envelope = await res.json();
    return _envelope;
  }

  // Replace the whole document with the decrypted page (scripts run).
  function render(html) {
    try { sessionStorage.setItem(STORAGE_KEY, _lastCode); } catch (e) {}
    document.open();
    document.write(html);
    document.close();
  }

  // Show the eSUB 404 (used when the payload can't be fetched at all).
  async function show404() {
    try {
      var res = await fetch("/404.html", { cache: "no-store" });
      if (res.ok) {
        var html = await res.text();
        document.open(); document.write(html); document.close();
        return;
      }
    } catch (e) {}
    // Fallback if /404.html is itself unavailable.
    document.body.innerHTML =
      '<div style="font-family:-apple-system,BlinkMacSystemFont,sans-serif;text-align:center;padding:4rem 1rem;color:#323a42">' +
      '<h1 style="color:#ed6a5a;font-size:3rem;margin:0">404</h1><p>Page not found.</p></div>';
    reveal();
  }

  var _lastCode = "";

  // ---- prompt UI ----------------------------------------------------------
  function buildPrompt() {
    var title = CFG.title || "eSUB Designs";
    var wrap = document.createElement("div");
    wrap.setAttribute("data-design-gate", "");
    wrap.innerHTML =
      '<style>' +
      ':root{--coral:#ed6a5a;--coral-hover:#c54232;--muted:#5a626a;--border:#d7d7d7;--bg-soft:#f5f6f7;--card:#fff;--text:#323a42;--heading:#0a121a}' +
      '@media (prefers-color-scheme:dark){:root{--bg-soft:#10191f;--card:#323a42;--text:#d7d7d7;--heading:#fff;--muted:#9aa4ad;--border:#3d4650}}' +
      '[data-design-gate]{position:fixed;inset:0;display:flex;align-items:center;justify-content:center;padding:1.5rem;' +
      'font-family:"Inter",-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;background:var(--bg-soft);' +
      'color:var(--text);-webkit-font-smoothing:antialiased;z-index:2147483647}' +
      '[data-design-gate] *,[data-design-gate] *::before,[data-design-gate] *::after{box-sizing:border-box}' +
      '[data-design-gate] .card{background:var(--card);border:1px solid var(--border);border-top:4px solid var(--coral);' +
      'border-radius:5px;max-width:26rem;width:100%;padding:2.5rem 2.25rem;text-align:center;' +
      'box-shadow:0 1px 3px rgba(10,18,26,.06),0 12px 32px rgba(10,18,26,.08)}' +
      '[data-design-gate] .brand{font-size:1.4rem;font-weight:800;letter-spacing:-.02em;color:var(--heading);margin:0 0 .25rem}' +
      '[data-design-gate] .brand span{color:var(--coral)}' +
      '[data-design-gate] .tag{font-size:.72rem;font-weight:600;letter-spacing:.12em;text-transform:uppercase;color:var(--muted);margin:0 0 1.5rem}' +
      '[data-design-gate] label{display:block;text-align:left;font-size:.85rem;font-weight:600;color:var(--heading);margin:0 0 .4rem}' +
      '[data-design-gate] input{width:100%;padding:12px 14px;font-size:1rem;font-family:inherit;color:var(--text);background:var(--bg-soft);' +
      'border:1px solid var(--border);border-radius:5px;outline:none}' +
      '[data-design-gate] input:focus{border-color:var(--coral);box-shadow:0 0 0 3px rgba(237,106,90,.15)}' +
      '[data-design-gate] button{margin-top:1rem;width:100%;background:var(--coral);color:#fff;font-weight:700;font-size:1rem;' +
      'font-family:inherit;border:0;padding:13px 0;border-radius:5px;cursor:pointer;transition:background-color .15s ease}' +
      '[data-design-gate] button:hover{background:var(--coral-hover)}' +
      '[data-design-gate] button:disabled{opacity:.6;cursor:default}' +
      '[data-design-gate] .err{min-height:1.2rem;margin:.75rem 0 0;font-size:.9rem;color:var(--coral);font-weight:600}' +
      '[data-design-gate].shake .card{animation:dg-shake .4s}' +
      '@keyframes dg-shake{0%,100%{transform:translateX(0)}20%,60%{transform:translateX(-7px)}40%,80%{transform:translateX(7px)}}' +
      '</style>' +
      '<form class="card" autocomplete="off">' +
      '<p class="brand">e<span>SUB</span> Designs</p>' +
      '<p class="tag">Preview access</p>' +
      '<label for="dg-code">Enter your access code</label>' +
      '<input id="dg-code" name="dg-code" type="password" autocapitalize="off" autocorrect="off" spellcheck="false" autocomplete="off" aria-describedby="dg-err">' +
      '<button type="submit">Unlock preview</button>' +
      '<p class="err" id="dg-err" role="alert"></p>' +
      '</form>';

    document.body.appendChild(wrap);
    document.title = title;
    reveal();

    var form = wrap.querySelector("form");
    var input = wrap.querySelector("#dg-code");
    var btn = wrap.querySelector("button");
    var err = wrap.querySelector("#dg-err");
    input.focus();

    form.addEventListener("submit", async function (ev) {
      ev.preventDefault();
      // Case-sensitive: preserve internal case, only strip surrounding whitespace.
      var code = input.value.replace(/^\s+|\s+$/g, "");
      if (!code) { input.focus(); return; }
      btn.disabled = true; err.textContent = "";
      try {
        var env = await loadEnvelope();
        _lastCode = code;
        var html = await decrypt(env, code);   // throws on wrong code
        render(html);
      } catch (e) {
        if (e && e.message === "payload-missing") { show404(); return; }
        // Wrong code (GCM auth failure): let the visitor retry.
        btn.disabled = false;
        err.textContent = "That code didn’t work. Check it and try again.";
        wrap.classList.remove("shake"); void wrap.offsetWidth; wrap.classList.add("shake");
        input.value = ""; input.focus();
      }
    });
  }

  // ---- boot ---------------------------------------------------------------
  async function boot() {
    if (!window.crypto || !crypto.subtle) {  // no WebCrypto -> can't decrypt
      show404();
      return;
    }
    // Try a cached code from this session first (survives refresh, not tab close).
    var cached = "";
    try { cached = sessionStorage.getItem(STORAGE_KEY) || ""; } catch (e) {}
    if (cached) {
      try {
        var env = await loadEnvelope();
        _lastCode = cached;
        var html = await decrypt(env, cached);
        render(html);
        return;
      } catch (e) {
        try { sessionStorage.removeItem(STORAGE_KEY); } catch (e2) {}
        if (e && e.message === "payload-missing") { show404(); return; }
        // fall through to prompt
      }
    }
    buildPrompt();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
