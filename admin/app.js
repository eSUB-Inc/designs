/* eSUB Designs Admin SPA — React (UMD) + htm, no build step. */
(function () {
  "use strict";
  var CFG = window.ADMIN_CONFIG;
  var html = htm.bind(React.createElement);
  var useState = React.useState, useEffect = React.useEffect, useMemo = React.useMemo, useRef = React.useRef;

  function icon(name) { return html`<span class="material-icons-outlined">${name}</span>`; }
  // Theme: default to system; session override via data-theme on <html>.
  function getThemeOverride() { try { return sessionStorage.getItem("designs-admin-theme") || ""; } catch (e) { return ""; } }
  function applyTheme(t) {
    if (t) document.documentElement.setAttribute("data-theme", t);
    else document.documentElement.removeAttribute("data-theme");
  }
  function ThemeToggle(props) {
    var st = useState(getThemeOverride()); var override = st[0], setOverride = st[1];
    var sysDark = window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches;
    var isDark = override ? override === "dark" : sysDark;
    function toggle() {
      var next = isDark ? "light" : "dark";
      try { sessionStorage.setItem("designs-admin-theme", next); } catch (e) {}
      applyTheme(next); setOverride(next);
    }
    return html`<button class="iconbtn themebtn ${props.floating ? "floating" : ""}" data-tip=${isDark ? "Switch to light mode" : "Switch to dark mode"} onClick=${toggle}>${icon(isDark ? "light_mode" : "dark_mode")}</button>`;
  }
  applyTheme(getThemeOverride());
  function fmtDate(iso) {
    if (!iso) return "—";
    var d = new Date(iso);
    return d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }) +
      " " + d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  }
  function claudePrompt(p) {
    return "Investigate a failed publish on designs.esub.com.\n" +
      "Page slug: " + p.slug + "\nAction: " + p.kind + "\nStarted: " + new Date(p.startedAt).toISOString() +
      "\nError: " + (p.error || "publish did not complete within the polling window") +
      "\n\nContext: eSUB-Inc/designs-internal (private) holds internal/<slug>/index.html and access-codes.xlsx; " +
      "a GitHub Action runs publish.py to encrypt the page (AES-256-GCM) and push <slug>/content.enc plus a gate shell " +
      "to eSUB-Inc/designs (public, GitHub Pages). Check the latest workflow run logs in designs-internal, verify the " +
      "commit landed on main, confirm content.enc updated in the public repo, and confirm the page returns 200. " +
      "Propose a remediation.";
  }

  // Internal audit trail (localStorage) for security review.
  function audit(user, action, slug, detail) {
    try {
      var key = "designs-admin-audit";
      var log = JSON.parse(localStorage.getItem(key) || "[]");
      log.push({ ts: new Date().toISOString(), user: (user && (user.username || user.name)) || "unknown", action: action, slug: slug || "", detail: detail || "" });
      if (log.length > 1000) log = log.slice(log.length - 1000);
      localStorage.setItem(key, JSON.stringify(log));
    } catch (e) {}
  }

  // ---------- small shared pieces ----------
  function useToasts() {
    var st = useState([]); var toasts = st[0], setToasts = st[1];
    function dismiss(id) { setToasts(function (t) { return t.filter(function (x) { return x.id !== id; }); }); }
    function push(msg, kind) {
      var id = Date.now() + Math.random();
      setToasts(function (t) { return t.concat({ id: id, msg: msg, kind: kind }); });
      // Errors must be readable, not blink-and-miss: 12s + click-to-dismiss.
      setTimeout(function () { dismiss(id); }, kind === "error" ? 12000 : 3200);
    }
    return [toasts, push, dismiss];
  }
  function copyText(text, toast, label) {
    navigator.clipboard.writeText(text).then(function () { toast(label || "Copied to clipboard"); },
      function () { toast("Copy failed — clipboard unavailable"); });
  }
  function Toasts(props) {
    return html`<div class="toasts">${props.items.map(function (t) {
      return html`<div class="toast ${t.kind === "error" ? "err" : ""}" key=${t.id} onClick=${function () { props.onDismiss(t.id); }}>${t.msg}</div>`;
    })}</div>`;
  }
  // "Contact Help Desk" with the label as the link — the one affordance for
  // access requests and error escalation everywhere it appears.
  function HelpDesk(props) {
    return html`<span>Contact <a href=${CFG.helpDesk.url} target="_blank" rel="noopener">${CFG.helpDesk.label}</a>${props.suffix || ""}</span>`;
  }
  function Modal(props) {
    return html`<div class="scrim" onClick=${function (e) { if (e.target === e.currentTarget && props.onClose) props.onClose(); }}>
      <div class="modal" role="dialog" aria-modal="true">${props.children}</div>
    </div>`;
  }
  function fmtSize(bytes) {
    return bytes >= 1048576 ? (bytes / 1048576).toFixed(1) + " MB" : Math.ceil(bytes / 1024) + " KB";
  }
  function FilePicker(props) {
    var inputRef = useRef(null);
    var st = useState(null); var sizeErr = st[0], setSizeErr = st[1];
    var max = CFG.publishing.maxUploadBytes;
    function onPick(f) {
      if (f.size > max) {
        setSizeErr("“" + f.name + "” is " + fmtSize(f.size) + " — over the " + fmtSize(max) +
          " limit. The admin publish app needs to be updated to support larger uploads, or the uploaded file's size needs to be reduced.");
        return;
      }
      setSizeErr(null);
      props.onFile(f);
    }
    return html`<div>
      <div class="filedrop ${props.file ? "on" : ""}" onClick=${function () { inputRef.current.click(); }}>
        ${props.file
          ? html`<span class="fname">${props.file.name}</span> — click to choose a different file`
          : "Click to choose a single HTML file (.html), up to " + fmtSize(max)}
      </div>
      <input ref=${inputRef} type="file" accept=".html,text/html" style=${{ display: "none" }}
        onChange=${function (e) { var f = e.target.files[0]; if (f) onPick(f); e.target.value = ""; }} />
      ${sizeErr && html`<p class="errline">${sizeErr}</p>`}
      <p class="hint">The file is published as <code>index.html</code> under the page's folder. It should be self-contained (inline assets) and no larger than ${fmtSize(max)}.</p>
    </div>`;
  }

  // ---------- login / PAT gate ----------
  function LoginScreen(props) {
    return html`<div class="login-wrap"><div class="card login-card">
      <p class="brand">e<span>SUB</span> Designs</p>
      <p class="tag">Publishing Admin</p>
      <p>Sign in with your esub.com credentials. Access is restricted.</p>
      <button class="btn btn-primary ms-btn" onClick=${props.onLogin} disabled=${!props.configured}>
        ${icon("badge")} Sign in
      </button>
      ${!props.configured && html`<p class="hint" style=${{ marginTop: "12px" }}>Microsoft sign-in isn't configured in <code>config.js</code> yet.</p>`}
      <p class="hint" style=${{ marginTop: "12px" }}>Need access? <${HelpDesk} suffix=" to request it." /></p>
    </div></div>`;
  }

  function PatGate(props) {
    var st = useState(""); var pat = st[0], setPat = st[1];
    var st2 = useState(null); var err = st2[0], setErr = st2[1];
    var st3 = useState(false); var busy = st3[0], setBusy = st3[1];
    async function submit() {
      setBusy(true); setErr(null);
      try {
        window.GitHubApi.setToken(pat.trim());
        await window.GitHubApi.verifyToken();
        try { sessionStorage.setItem("designs-admin-pat", pat.trim()); } catch (e) {}
        props.onReady();
      } catch (e) { setErr("Token check failed: " + e.message); }
      setBusy(false);
    }
    return html`<div class="login-wrap"><div class="card login-card" style=${{ textAlign: "left" }}>
      <p class="brand" style=${{ textAlign: "center" }}>e<span>SUB</span> Designs</p>
      <p class="tag" style=${{ textAlign: "center" }}>GitHub Access</p>
      <p>Signed in as <strong>${props.user.name}</strong>. Paste the team publishing token (from the shared vault) to manage pages. It is kept only for this browser session.</p>
      <p class="hint">Token scopes, for reference: Contents read/write on <code>designs-internal</code>, Contents read on <code>designs</code>.</p>
      <label for="pat">Team publishing token</label>
      <input id="pat" type="password" value=${pat} onInput=${function (e) { setPat(e.target.value); }}
        onKeyDown=${function (e) { if (e.key === "Enter" && pat.trim()) submit(); }} autocomplete="off" />
      ${err && html`<p class="errline">${err}</p>`}
      <p class="hint" style=${{ marginTop: "10px" }}>Trouble with your token or repo access? <${HelpDesk} suffix="." /></p>
      <div class="actions" style=${{ marginTop: "18px", display: "flex", justifyContent: "flex-end", gap: "10px" }}>
        <button class="btn btn-quiet" onClick=${props.onBack}>Back</button>
        <button class="btn btn-primary" disabled=${!pat.trim() || busy} onClick=${submit}>${busy ? "Checking…" : "Continue"}</button>
      </div>
    </div></div>`;
  }

  // ---------- row ----------
  function CodeCell(props) {
    var st = useState(false); var shown = st[0], setShown = st[1];
    var code = props.code;
    if (!code) return html`<span class="pgtitle">pending</span>`;
    return html`<div class="codecell">
      <span class="codeval">${shown ? code : "•••••••••••••"}</span>
      <button class="iconbtn" data-tip=${shown ? "Hide code" : "Reveal code"} onClick=${function () { setShown(!shown); }}>${icon(shown ? "visibility_off" : "visibility")}</button>
      <button class="iconbtn" data-tip="Copy code" onClick=${function () { props.copy(code, "Code copied"); }}>${icon("content_copy")}</button>
    </div>`;
  }

  function StatusChip(props) {
    var p = props.pending;
    if (p && p.status === "publishing") return html`<span class="chip pending"><span class="spin" style=${{ width: "11px", height: "11px", borderWidth: "1.5px" }}></span>Publishing</span>`;
    if (p && p.status === "failed") return html`<span class="chip failed" onClick=${function () { props.onFail(p); }}>${icon("error_outline")}Failed — details</span>`;
    if (props.page.status === "archived") return html`<span class="chip archived">${icon("inventory_2")}Archived</span>`;
    if (!props.page.code) return html`<span class="chip pending"><span class="spin" style=${{ width: "11px", height: "11px", borderWidth: "1.5px" }}></span>Publishing</span>`;
    return html`<span class="chip published">${icon("check_circle")}Published</span>`;
  }

  function Row(props) {
    var pg = props.page, copy = props.copy;
    var archived = pg.status === "archived";
    var secure = pg.url + "#code=" + encodeURIComponent(pg.code || "");
    return html`<tr>
      <td><div class="pgname">${pg.slug}</div>${pg.title && html`<div class="pgtitle">${pg.title}</div>`}</td>
      <td><${StatusChip} page=${pg} pending=${props.pending} onFail=${props.onFail} /></td>
      <td class="notes ${archived ? "" : "notes-edit"}" title=${archived ? undefined : "Click to edit notes"}
        onClick=${archived ? undefined : function () { props.onNotes(pg); }}>${pg.notes || "—"}${!archived && html`<span class="material-icons-outlined noteicon">edit</span>`}</td>
      <td><div class="urlcell">
        ${archived ? html`<span class="pgtitle">unpublished</span>` : html`<a href=${pg.url} target="_blank" rel="noopener">/${pg.slug}/</a>
        <button class="iconbtn" data-tip="Copy URL" onClick=${function () { copy(pg.url, "URL copied"); }}>${icon("content_copy")}</button>
        <button class="iconbtn" data-tip="Copy secure link (URL + code)" disabled=${!pg.code} onClick=${function () { copy(secure, "Secure link copied"); }}>${icon("enhanced_encryption")}</button>`}
      </div></td>
      <td>${archived ? html`<span class="pgtitle">—</span>` : html`<${CodeCell} code=${pg.code} copy=${copy} />`}</td>
      <td style=${{ whiteSpace: "nowrap" }}>${pg.sizeBytes != null ? fmtSize(pg.sizeBytes) : "—"}</td>
      <td style=${{ whiteSpace: "nowrap" }}>${fmtDate(pg.lastPublished)}</td>
      <td>${pg.publishedBy || "—"}</td>
      <td><div class="rowactions">
        ${!archived && html`<button class="iconbtn" data-tip="Update HTML" onClick=${function () { props.onUpdate(pg); }}>${icon("upload_file")}</button>
        <button class="iconbtn" data-tip="Reset access code" onClick=${function () { props.onReset(pg); }}>${icon("lock_reset")}</button>
        <button class="iconbtn" data-tip="Archive (unpublish)" onClick=${function () { props.onArchive(pg); }}>${icon("inventory_2")}</button>`}
        ${archived && html`<button class="iconbtn" data-tip="Restore (republish, new code)" onClick=${function () { props.onRestore(pg); }}>${icon("restore")}</button>`}
        <button class="iconbtn danger" data-tip="Delete permanently" onClick=${function () { props.onDelete(pg); }}>${icon("delete_outline")}</button>
      </div></td>
    </tr>`;
  }

  // ---------- main screen ----------
  function effStatus(pg, pend) {
    if (pend && pend.status === "publishing") return "Publishing";
    if (pend && pend.status === "failed") return "Failed";
    if (pg.status === "archived") return "Archived";
    return pg.code ? "Published" : "Publishing";
  }

  function Main(props) {
    var store = props.store, user = props.user;
    var s1 = useState([]); var pages = s1[0], setPages = s1[1];
    var s2 = useState(true); var loading = s2[0], setLoading = s2[1];
    var s3 = useState(""); var search = s3[0], setSearch = s3[1];
    var s4 = useState({ key: "name", dir: 1 }); var sort = s4[0], setSort = s4[1];
    var sf1 = useState([]); var byFilter = sf1[0], setByFilter = sf1[1];
    var sf2 = useState([]); var statusFilter = sf2[0], setStatusFilter = sf2[1];
    var sf3 = useState(null); var openFilter = sf3[0], setOpenFilter = sf3[1];
    var s5 = useState(1); var pageNum = s5[0], setPageNum = s5[1];
    var s6 = useState([]); var pending = s6[0], setPending = s6[1];
    var s7 = useState(null); var modal = s7[0], setModal = s7[1];
    var s8 = useState(null); var loadErr = s8[0], setLoadErr = s8[1];
    var toastPair = useToasts(); var toasts = toastPair[0], toast = toastPair[1], dismissToast = toastPair[2];
    var copy = function (text, label) { copyText(text, toast, label); };
    var pendingRef = useRef(pending); pendingRef.current = pending;

    async function reload() {
      setLoading(true); setLoadErr(null);
      try { setPages(await store.loadPages()); }
      catch (e) { setLoadErr(e.message); }
      setLoading(false);
    }
    useEffect(function () { reload(); }, []);

    // Poll pending publishes.
    useEffect(function () {
      var t = setInterval(async function () {
        var items = pendingRef.current.filter(function (p) { return p.status === "publishing"; });
        if (!items.length) return;
        for (var i = 0; i < items.length; i++) {
          var p = items[i];
          try {
            var done = await store.checkPublished(p.slug, p.prevEncSha);
            if (done) {
              markPending(p.slug, { status: "published" });
              await reload();
            } else if (Date.now() - p.startedAt > CFG.publishing.pollTimeoutMs) {
              markPending(p.slug, { status: "failed", error: "Publish did not complete within " + Math.round(CFG.publishing.pollTimeoutMs / 60000) + " minutes." });
            }
          } catch (e) {
            // Transient poll errors (rate limit, network blip) are retried on
            // the next tick; only the overall timeout fails the publish.
            if (Date.now() - p.startedAt > CFG.publishing.pollTimeoutMs) {
              markPending(p.slug, { status: "failed", error: e.message });
            }
          }
        }
      }, CFG.publishing.pollIntervalMs);
      return function () { clearInterval(t); };
    }, [store]);

    function markPending(slug, patch) {
      setPending(function (list) { return list.map(function (p) { return p.slug === slug ? Object.assign({}, p, patch) : p; }); });
    }
    function addPending(slug, kind, prevEncSha) {
      setPending(function (list) {
        return list.filter(function (p) { return p.slug !== slug; }).concat({ slug: slug, kind: kind, status: "publishing", startedAt: Date.now(), prevEncSha: prevEncSha || null });
      });
    }

    // ----- actions -----
    async function doUpload(name, file) {
      var slug = window.AdminData.slugify(name);
      var htmlText = await file.text();
      await store.uploadPage(slug, htmlText);
      audit(user, "upload", slug, "new page (" + file.name + ", " + htmlText.length + " bytes)");
      addPending(slug, "new page");
      setModal(null);
      toast("Submitted — publishing " + slug);
      reload();
    }
    async function doUpdate(pg, file) {
      var htmlText = await file.text();
      var prevSha = null;
      try { prevSha = await store.getEncSha(pg.slug); } catch (e) {}
      await store.updatePage(pg.slug, htmlText);
      audit(user, "update", pg.slug, "replaced html (" + file.name + ", " + htmlText.length + " bytes)");
      addPending(pg.slug, "update", prevSha);
      setModal(null);
      toast("Submitted — republishing " + pg.slug);
    }
    async function doReset(pg) {
      setModal(null);
      // Snapshot the ciphertext sha first: a reset re-encrypts the SAME page, so
      // "published" means the sha changed — existence + 200 are already true.
      var prevSha = null;
      try { prevSha = await store.getEncSha(pg.slug); } catch (e) {}
      try { await store.resetCode(pg.slug); }
      catch (e) { toast("Code reset failed: " + e.message, "error"); reload(); return; }
      audit(user, "reset-code", pg.slug);
      addPending(pg.slug, "code reset", prevSha);
      toast("Code reset submitted for " + pg.slug);
      reload();
    }
    async function doArchive(pg) {
      setModal(null);
      try { await store.archivePage(pg.slug); }
      catch (e) { toast("Archive failed: " + e.message, "error"); reload(); return; }
      audit(user, "archive", pg.slug);
      toast(pg.slug + " archived — unpublish in progress");
      reload();
    }
    async function doRestore(pg) {
      setModal(null);
      try { await store.restorePage(pg.slug); }
      catch (e) { toast("Restore failed: " + e.message, "error"); reload(); return; }
      audit(user, "restore", pg.slug);
      addPending(pg.slug, "restore");
      toast(pg.slug + " restoring — a new code will be minted");
      reload();
    }
    async function doDelete(pg) {
      setModal(null);
      try { await store.deletePage(pg.slug, pg.status); }
      catch (e) { toast("Delete failed: " + e.message, "error"); reload(); return; }
      audit(user, "delete", pg.slug, "was " + pg.status);
      toast(pg.slug + " deleted");
      reload();
    }

    var pendingBySlug = {};
    pending.forEach(function (p) { pendingBySlug[p.slug] = p; });

    async function doSaveNotes(pg, notes) {
      await store.saveNotes(pg.slug, notes);
      audit(user, "edit-notes", pg.slug, JSON.stringify({ from: pg.notes || "", to: notes }));
      setModal(null);
      toast("Notes saved for " + pg.slug);
      reload();
    }

    // ----- derived list -----
    var filtered = useMemo(function () {
      var q = search.trim().toLowerCase();
      var list = pages.filter(function (p) {
        if (q && p.slug.indexOf(q) < 0 && (p.title || "").toLowerCase().indexOf(q) < 0) return false;
        if (byFilter.length && byFilter.indexOf(p.publishedBy || "—") < 0) return false;
        if (statusFilter.length && statusFilter.indexOf(effStatus(p, pendingBySlug[p.slug])) < 0) return false;
        return true;
      });
      var cmp = sort.key === "pub"
        ? function (a, b) { return ((a.lastPublished || "").localeCompare(b.lastPublished || "")) * sort.dir; }
        : function (a, b) { return a.slug.localeCompare(b.slug) * sort.dir; };
      return list.slice().sort(cmp);
    }, [pages, search, sort, byFilter, statusFilter, pending]);

    var pageSize = CFG.publishing.pageSize;
    var totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
    var cur = Math.min(pageNum, totalPages);
    var visible = filtered.slice((cur - 1) * pageSize, cur * pageSize);
    useEffect(function () { setPageNum(1); }, [search, sort, byFilter, statusFilter]);

    function sortHeader(label, key) {
      var active = sort.key === key;
      return html`<th class="th-click" onClick=${function () { setSort(active ? { key: key, dir: -sort.dir } : { key: key, dir: key === "pub" ? -1 : 1 }); }}>
        ${label}<span class="tharrow">${active ? (sort.dir === 1 ? "\u2191" : "\u2193") : ""}</span>
      </th>`;
    }
    function filterHeader(label, id, options, selected, setSelected) {
      function toggle(opt) {
        setSelected(selected.indexOf(opt) >= 0 ? selected.filter(function (x) { return x !== opt; }) : selected.concat(opt));
      }
      var open = openFilter && openFilter.id === id;
      return html`<th class="th-click ${selected.length ? "th-filtered" : ""}" onClick=${function (e) {
          if (open) { setOpenFilter(null); return; }
          var r = e.currentTarget.getBoundingClientRect();
          setOpenFilter({ id: id, x: r.left, y: r.bottom + 2 });
        }}>
        ${label}<span class="material-icons-outlined thfilter">filter_list</span>
        ${open && html`<div class="filter-pop" style=${{ left: openFilter.x + "px", top: openFilter.y + "px" }} onClick=${function (e) { e.stopPropagation(); }}>
          ${options.map(function (opt) {
            return html`<label key=${opt}><input type="checkbox" checked=${selected.indexOf(opt) >= 0} onChange=${function () { toggle(opt); }} /> ${opt}</label>`;
          })}
          <button class="clearbtn" disabled=${!selected.length} onClick=${function () { setSelected([]); setOpenFilter(null); }}>Clear filter</button>
        </div>`}
      </th>`;
    }
    var byOptions = useMemo(function () {
      var s = {}; pages.forEach(function (p) { s[p.publishedBy || "\u2014"] = 1; });
      return Object.keys(s).sort();
    }, [pages]);
    var statusOptions = ["Published", "Publishing", "Archived", "Failed"];
    var strip = pending.filter(function (p) { return p.status !== "published" || Date.now() - p.startedAt < 3600000; });

    function failModal(p) { setModal({ kind: "fail", pending: p }); }

    return html`<div>
      <header class="hdr">
        <span class="brand">e<span>SUB</span> Designs</span>
        <span class="tag">Publishing Admin</span>
        <span class="spacer"></span>
        <${ThemeToggle} />
        <span class="user"><span class="avatar">${(user.firstName || "?").slice(0, 1).toUpperCase()}</span>${user.name}</span>
        <button class="signout" onClick=${props.onSignOut}>Sign out</button>
      </header>
      <div class="wrap">
        <div class="toolbar">
          <h1>Pages</h1>
          <span class="grow"></span>
          <div class="search">${icon("search")}<input placeholder="Filter by name…" value=${search} onInput=${function (e) { setSearch(e.target.value); }} /></div>
          <button class="btn btn-primary" onClick=${function () { setModal({ kind: "upload" }); }}>${icon("add")} Upload New Page</button>
        </div>

        ${strip.length > 0 && html`<div class="pending-strip">
          ${strip.map(function (p) {
            var pg = pages.find(function (x) { return x.slug === p.slug; });
            return html`<div class="card pending-card ${p.status === "published" ? "ok" : p.status === "failed" ? "err" : ""}" key=${p.slug}>
              ${p.status === "publishing" ? html`<span class="spin"></span>` : p.status === "published" ? html`<span class="check">${icon("check_circle")}</span>` : html`<span style=${{ color: "var(--red)" }}>${icon("error_outline")}</span>`}
              <div style=${{ flex: 1 }}>
                <div class="name">${p.slug} <span class="sub">· ${p.kind}</span></div>
                <div class="sub">${p.status === "publishing" ? "Waiting for the GitHub workflow to publish…"
                  : p.status === "published" ? "Live at " + CFG.site.baseUrl + "/" + p.slug + "/" + (pg && pg.code ? " · code ready" : "")
                  : p.error}</div>
              </div>
              ${p.status === "failed" && html`<button class="btn btn-quiet" onClick=${function () { failModal(p); }}>Details</button>`}
              ${p.status === "published" && pg && pg.code && html`<button class="btn btn-quiet" onClick=${function () { copy(pg.url + "#code=" + encodeURIComponent(pg.code), "Secure link copied"); }}>${icon("enhanced_encryption")} Copy secure link</button>`}
            </div>`;
          })}
        </div>`}

        <div class="card">
          ${loadErr ? html`<div class="empty">Unable to load pages: ${loadErr}
            <div style=${{ marginTop: "8px", fontSize: "13px" }}><${HelpDesk} suffix=" if this keeps happening." /></div>
            <div style=${{ marginTop: "12px" }}><button class="btn btn-quiet" onClick=${reload}>Retry</button></div></div>`
          : loading ? html`<div class="empty">Loading pages…</div>`
          : visible.length === 0 ? html`<div class="empty">
              ${search || byFilter.length || statusFilter.length
                ? html`No pages match the current ${search ? "search" : "filters"}.
                  <div style=${{ marginTop: "12px" }}><button class="btn btn-quiet" onClick=${function () { setSearch(""); setByFilter([]); setStatusFilter([]); setOpenFilter(null); }}>Clear search & filters</button></div>`
                : "No pages yet. Upload the first one."}
            </div>`
          : html`<div class="tablewrap"><table>
            <thead><tr>${sortHeader("Page", "name")}${filterHeader("Status", "status", statusOptions, statusFilter, setStatusFilter)}<th>Notes</th><th>Public URL</th><th>Access Code</th><th>Size</th>${sortHeader("Last Published", "pub")}${filterHeader("By", "by", byOptions, byFilter, setByFilter)}<th style=${{ textAlign: "right" }}>Actions</th></tr></thead>
            <tbody>
              ${visible.map(function (pg) {
                return html`<${Row} key=${pg.slug + pg.status} page=${pg} pending=${pendingBySlug[pg.slug]} copy=${copy} onFail=${failModal}
                  onNotes=${function (p) { setModal({ kind: "notes", page: p }); }}
                  onUpdate=${function (p) { setModal({ kind: "update", page: p }); }}
                  onReset=${function (p) { setModal({ kind: "reset", page: p }); }}
                  onArchive=${function (p) { setModal({ kind: "archive", page: p }); }}
                  onRestore=${function (p) { setModal({ kind: "restore", page: p }); }}
                  onDelete=${function (p) { setModal({ kind: "delete", page: p }); }} />`;
              })}
            </tbody>
          </table></div>
          ${totalPages > 1 && html`<div class="pager">
            <span class="count">${filtered.length} pages</span>
            <button disabled=${cur === 1} onClick=${function () { setPageNum(cur - 1); }}>‹</button>
            ${Array.from({ length: totalPages }, function (_, i) {
              return html`<button key=${i} class=${cur === i + 1 ? "cur" : ""} onClick=${function () { setPageNum(i + 1); }}>${i + 1}</button>`;
            })}
            <button disabled=${cur === totalPages} onClick=${function () { setPageNum(cur + 1); }}>›</button>
          </div>`}`}
        </div>
      </div>
      ${openFilter && html`<div style=${{ position: "fixed", inset: 0, zIndex: 5 }} onClick=${function () { setOpenFilter(null); }}></div>`}

      ${modal && modal.kind === "upload" && html`<${UploadModal} onClose=${function () { setModal(null); }} onSubmit=${doUpload} existing=${pages.map(function (p) { return p.slug; })} />`}
      ${modal && modal.kind === "update" && html`<${UpdateModal} page=${modal.page} onClose=${function () { setModal(null); }} onSubmit=${doUpdate} />`}
      ${modal && modal.kind === "reset" && html`<${ConfirmModal} title="Reset access code" danger=${false} confirmLabel="Reset Code"
        body=${"A new code will be generated for “" + modal.page.slug + "” and the page re-encrypted. The current code — and every link already shared with it — stops working."}
        onClose=${function () { setModal(null); }} onConfirm=${function () { doReset(modal.page); }} />`}
      ${modal && modal.kind === "archive" && html`<${ConfirmModal} title="Archive page" danger=${false} confirmLabel="Archive"
        body=${"“" + modal.page.slug + "” will be unpublished from designs.esub.com but its source is kept and it can be restored later. Restoring mints a new access code; notes and title are not retained (the registry row is removed)."}
        onClose=${function () { setModal(null); }} onConfirm=${function () { doArchive(modal.page); }} />`}
      ${modal && modal.kind === "delete" && html`<${ConfirmModal} title="Delete page" danger=${true} confirmLabel="Delete Permanently"
        body=${"“" + modal.page.slug + "” will be removed from the site, its source deleted, and its access-code row dropped. This cannot be undone from the admin."}
        onClose=${function () { setModal(null); }} onConfirm=${function () { doDelete(modal.page); }} />`}
      ${modal && modal.kind === "restore" && html`<${ConfirmModal} title="Restore page" danger=${false} confirmLabel="Restore"
        body=${"“" + modal.page.slug + "” will be republished at " + CFG.site.baseUrl + "/" + modal.page.slug + "/ with a newly minted access code (the pre-archive code was retired). Share the new secure link once it is live."}
        onClose=${function () { setModal(null); }} onConfirm=${function () { doRestore(modal.page); }} />`}
      ${modal && modal.kind === "notes" && html`<${NotesModal} page=${modal.page} onClose=${function () { setModal(null); }} onSave=${doSaveNotes} />`}
      ${modal && modal.kind === "fail" && html`<${FailModal} pending=${modal.pending} copy=${copy} onClose=${function () { setModal(null); }} />`}
      <${Toasts} items=${toasts} onDismiss=${dismissToast} />
    </div>`;
  }

  // ---------- modals ----------
  function UploadModal(props) {
    var s1 = useState(""); var name = s1[0], setName = s1[1];
    var s2 = useState(null); var file = s2[0], setFile = s2[1];
    var s3 = useState(false); var busy = s3[0], setBusy = s3[1];
    var s4 = useState(null); var err = s4[0], setErr = s4[1];
    var slug = window.AdminData.slugify(name);
    var collision = slug && props.existing.indexOf(slug) >= 0;
    async function submit() {
      setBusy(true); setErr(null);
      try { await props.onSubmit(name, file); }
      catch (e) { setErr(e.message); setBusy(false); }
    }
    return html`<${Modal} onClose=${props.onClose}>
      <h2>Upload New Page</h2>
      <p class="sub">The page is committed to the private repo; a GitHub workflow encrypts it, mints a 4-word access code, and publishes it.</p>
      <label>Page name</label>
      <input type="text" value=${name} placeholder="e.g. Budget Redesign" onInput=${function (e) { setName(e.target.value); }} />
      ${slug && html`<p class="hint">URL: <code>${CFG.site.baseUrl}/${slug}/</code>${collision ? html` — <span style=${{ color: "var(--red)", fontWeight: 700 }}>a page with this name already exists</span>` : ""}</p>`}
      <label>HTML file</label>
      <${FilePicker} file=${file} onFile=${setFile} />
      ${err && html`<p class="errline">${err}</p>`}
      <div class="actions">
        <button class="btn btn-quiet" onClick=${props.onClose}>Cancel</button>
        <button class="btn btn-primary" disabled=${!slug || !file || collision || busy} onClick=${submit}>${busy ? "Submitting…" : "Submit"}</button>
      </div>
    <//>`;
  }

  function UpdateModal(props) {
    var s1 = useState(null); var file = s1[0], setFile = s1[1];
    var s2 = useState(false); var busy = s2[0], setBusy = s2[1];
    var s3 = useState(null); var err = s3[0], setErr = s3[1];
    async function submit() {
      setBusy(true); setErr(null);
      try { await props.onSubmit(props.page, file); }
      catch (e) { setErr(e.message); setBusy(false); }
    }
    return html`<${Modal} onClose=${props.onClose}>
      <h2>Update “${props.page.slug}”</h2>
      <p class="sub">Upload a replacement HTML file. It is saved as <code>index.html</code>, re-encrypted, and republished. The access code and URL stay the same.</p>
      <${FilePicker} file=${file} onFile=${setFile} />
      ${err && html`<p class="errline">${err}</p>`}
      <div class="actions">
        <button class="btn btn-quiet" onClick=${props.onClose}>Cancel</button>
        <button class="btn btn-primary" disabled=${!file || busy} onClick=${submit}>${busy ? "Submitting…" : "Save & Republish"}</button>
      </div>
    <//>`;
  }

  function ConfirmModal(props) {
    return html`<${Modal} onClose=${props.onClose}>
      <h2>${props.title}</h2>
      <p class="sub" style=${{ marginTop: "8px" }}>${props.body}</p>
      <div class="actions">
        <button class="btn btn-quiet" onClick=${props.onClose}>Cancel</button>
        <button class=${"btn " + (props.danger ? "btn-danger" : "btn-primary")} onClick=${props.onConfirm}>${props.confirmLabel}</button>
      </div>
    <//>`;
  }

  function NotesModal(props) {
    var orig = props.page.notes || "";
    var s1 = useState(orig); var val = s1[0], setVal = s1[1];
    var s2 = useState(false); var confirmOpen = s2[0], setConfirmOpen = s2[1];
    var s3 = useState(false); var busy = s3[0], setBusy = s3[1];
    var s4 = useState(null); var err = s4[0], setErr = s4[1];
    var dirty = val !== orig;
    var ref = useRef(); ref.current = { dirty: dirty, confirmOpen: confirmOpen, busy: busy, save: save, attemptClose: attemptClose };
    function attemptClose() { if (ref.current.dirty) setConfirmOpen(true); else props.onClose(); }
    useEffect(function () {
      function onKey(e) {
        var isEnter = e.key === "Enter" || e.code === "Enter" || e.code === "NumpadEnter" || e.keyCode === 13;
        if (e.key === "Escape") {
          e.preventDefault();
          if (ref.current.confirmOpen) setConfirmOpen(false); else ref.current.attemptClose();
        } else if (isEnter && (e.altKey || e.ctrlKey || e.metaKey || (e.getModifierState && e.getModifierState("Alt")))) {
          e.preventDefault();
          if (ref.current.dirty && !ref.current.busy && !ref.current.confirmOpen) ref.current.save();
        }
      }
      document.addEventListener("keydown", onKey, true);
      return function () { document.removeEventListener("keydown", onKey, true); };
    }, []);
    async function save() {
      setBusy(true); setErr(null);
      try { await props.onSave(props.page, val); }
      catch (e) { setErr(e.message); setBusy(false); }
    }
    return html`<${Modal} onClose=${attemptClose}>
      <div class="modal-head">
        <h2>Notes — ${props.page.slug}</h2>
        <span style=${{ flex: 1 }}></span>
        <button class="iconbtn" data-tip="Save" disabled=${!dirty || busy} onClick=${save}>${icon("save")}</button>
        <button class="iconbtn" data-tip="Close" onClick=${attemptClose}>${icon("close")}</button>
      </div>
      <textarea class="notes-area" value=${val} placeholder="Add notes about this page…" autoFocus=${true}
        onInput=${function (e) { setVal(e.target.value); }}></textarea>
      ${err && html`<p class="errline">${err}</p>`}
      ${busy && html`<p class="hint">Saving…</p>`}
      <p class="keyhint">Cmd+Enter or Ctrl+Enter to save · Esc to close</p>
      ${confirmOpen && html`<div class="scrim" style=${{ zIndex: 120 }}>
        <div class="modal" style=${{ maxWidth: "380px" }}>
          <h2>Discard changes?</h2>
          <p class="sub" style=${{ marginTop: "8px" }}>Changes to the notes will be lost. Do you want to continue?</p>
          <div class="actions">
            <button class="btn btn-quiet" autoFocus=${true} onClick=${function () { setConfirmOpen(false); }}>No</button>
            <button class="btn btn-danger" onClick=${props.onClose}>Yes, Discard</button>
          </div>
        </div>
      </div>`}
    <//>`;
  }

  function FailModal(props) {
    var p = props.pending;
    var prompt = claudePrompt(p);
    return html`<${Modal} onClose=${props.onClose}>
      <h2>Publish failed — ${p.slug}</h2>
      <p class="sub">The ${p.kind} for “${p.slug}” did not complete. ${p.error || ""}</p>
      <p class="sub"><${HelpDesk} suffix=" so the pipeline can be investigated." /></p>
      <label>Investigation prompt (paste into Claude or the ticket)</label>
      <div class="copyblock">${prompt}</div>
      <div class="actions">
        <button class="btn btn-quiet" onClick=${function () { props.copy(prompt, "Prompt copied"); }}>${icon("content_copy")} Copy Prompt</button>
        <button class="btn btn-primary" onClick=${props.onClose}>Close</button>
      </div>
    <//>`;
  }

  // ---------- app root ----------
  function App() {
    var s1 = useState("boot"); var phase = s1[0], setPhase = s1[1];
    var s2 = useState(null); var user = s2[0], setUser = s2[1];
    var s3 = useState(null); var store = s3[0], setStore = s3[1];

    useEffect(function () {
      (async function () {
        if (window.AdminAuth.isConfigured) {
          var acct = await window.AdminAuth.init();
          if (acct) {
            setUser(acct);
            // Proxy mode: the Entra login is the only gate — no GitHub token to collect.
            if (CFG.proxy && CFG.proxy.baseUrl) {
              setStore(window.AdminData.makeStore(acct));
              setPhase("app");
              return;
            }
            var pat = null;
            try { pat = sessionStorage.getItem("designs-admin-pat"); } catch (e) {}
            if (pat) {
              window.GitHubApi.setToken(pat);
              setStore(window.AdminData.makeStore(acct));
              setPhase("app");
            } else setPhase("pat");
            return;
          }
        }
        setPhase("login");
      })();
    }, []);

    function signOut() {
      window.AdminAuth.logout();
    }

    if (phase === "boot") return html`<div class="login-wrap"><div class="empty">Loading…</div></div>`;
    if (phase === "login") return html`<div><${ThemeToggle} floating=${true} /><${LoginScreen} configured=${window.AdminAuth.isConfigured} onLogin=${function () { window.AdminAuth.login(); }} /></div>`;
    if (phase === "pat") return html`<div><${ThemeToggle} floating=${true} /><${PatGate} user=${user} onBack=${signOut} onReady=${function () { setStore(window.AdminData.makeStore(user)); setPhase("app"); }} /></div>`;
    return html`<${Main} store=${store} user=${user} onSignOut=${signOut} />`;
  }

  ReactDOM.createRoot(document.getElementById("root")).render(html`<${App} />`);
})();
