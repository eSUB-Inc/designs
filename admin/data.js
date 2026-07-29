// Data layer: joins internal/ + archive/ folders, access-codes.xlsx, and commit
// metadata into page records, and performs the write operations the UI needs.
// Two implementations with one interface: RealStore (GitHub API) and DemoStore.
// Exposes window.AdminData = { makeStore }.
(function () {
  "use strict";
  var CFG = window.ADMIN_CONFIG;
  var G = CFG.github;

  function b64EncodeUtf8(str) {
    // Chunked: fromCharCode.apply on a whole large file overflows the arg limit.
    var bytes = new TextEncoder().encode(str);
    var bin = "";
    for (var i = 0; i < bytes.length; i += 0x8000) {
      bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    }
    return btoa(bin);
  }
  function slugify(name) {
    return name.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  }

  // ---------------- Real store (GitHub API + PAT) ----------------
  function RealStore(user) {
    var gh = window.GitHubApi;
    var commitMsg = function (verb, slug) {
      // First name lands in the commit message so "published by" survives even
      // when the git author is the PAT owner.
      return verb + " " + slug + " via admin (" + user.firstName + ")";
    };

    async function readWorkbook() {
      var f = await gh.getFile(G.privateRepo, "access-codes.xlsx");
      if (!f) return { rows: [], sheet: null, wb: null, sha: null };
      var wb = XLSX.read(f.content.replace(/\n/g, ""), { type: "base64" });
      var sheetName = wb.SheetNames[0];
      var rows = XLSX.utils.sheet_to_json(wb.Sheets[sheetName], { defval: "" });
      return { rows: rows, wb: wb, sheetName: sheetName, sha: f.sha };
    }

    async function writeWorkbook(book, message) {
      var out = XLSX.write(book.wb, { type: "base64", bookType: "xlsx" });
      await gh.putFile(G.privateRepo, "access-codes.xlsx", out, message, book.sha);
    }

    async function listSlugs(dir) {
      var entries = await gh.listDir(G.privateRepo, dir);
      if (entries.notFound) return [];
      return entries.filter(function (e) { return e.type === "dir"; }).map(function (e) { return e.name; });
    }

    async function loadPages() {
      var results = await Promise.all([readWorkbook(), listSlugs("internal"), listSlugs("archive")]);
      var book = results[0], live = results[1], archived = results[2];
      var byPath = {};
      book.rows.forEach(function (r) {
        var slug = String(r.public_path || "").replace(/^\/+|\/+$/g, "");
        if (slug) byPath[slug] = r;
      });
      var pages = [];
      live.forEach(function (slug) { pages.push(makeRec(slug, byPath[slug], "published")); });
      archived.forEach(function (slug) { pages.push(makeRec(slug, byPath[slug], "archived")); });
      // Publish metadata from the latest commit touching each live folder.
      await Promise.all(pages.map(async function (p) {
        var dir = (p.status === "archived" ? "archive/" : "internal/") + p.slug;
        var c = await gh.latestCommit(G.privateRepo, dir);
        if (c) {
          p.lastPublished = c.date;
          var m = /via admin \(([^)]+)\)/.exec(c.message);
          p.publishedBy = m ? m[1] : firstNameFromCommit(c.authorName);
        }
      }));
      return pages;
    }

    function firstNameFromCommit(authorName) {
      return (authorName || "").split(" ")[0];
    }

    function makeRec(slug, row, status) {
      return {
        slug: slug,
        url: CFG.site.baseUrl + "/" + slug + "/",
        title: row ? String(row.title || "") : "",
        notes: row ? String(row.notes || "") : "",
        code: row ? String(row.plaintext_code || "") : "",
        status: status,
        lastPublished: null,
        publishedBy: "",
      };
    }

    async function putHtml(slug, htmlText, verb) {
      var path = "internal/" + slug + "/index.html";
      var existing = await gh.getFile(G.privateRepo, path);
      var b64 = b64EncodeUtf8(htmlText);
      // A byte-identical update never re-encrypts (the pipeline's content hash is
      // unchanged), so the publish poll would time out into a false Failed.
      if (existing && existing.content && existing.content.replace(/\n/g, "") === b64) {
        throw new Error("This file is identical to the current source of “" + slug + "” — nothing to republish.");
      }
      await gh.putFile(G.privateRepo, path, b64, commitMsg(verb, slug), existing ? existing.sha : undefined);
    }

    return {
      user: user,
      loadPages: loadPages,
      uploadPage: function (slug, htmlText) { return putHtml(slug, htmlText, "Publish"); },
      updatePage: function (slug, htmlText) { return putHtml(slug, htmlText, "Update"); },
      resetCode: async function (slug) {
        var book = await readWorkbook();
        if (!book.wb) throw new Error("access-codes.xlsx not found");
        // Blank plaintext_code + encoded_code on the matching row; the pipeline
        // mints a fresh code and re-encrypts (README: "Reset a code").
        var ws = book.wb.Sheets[book.sheetName];
        var ref = XLSX.utils.decode_range(ws["!ref"]);
        var header = {};
        for (var c = ref.s.c; c <= ref.e.c; c++) {
          var cell = ws[XLSX.utils.encode_cell({ r: 0, c: c })];
          if (cell) header[String(cell.v)] = c;
        }
        var found = false;
        for (var r = 1; r <= ref.e.r; r++) {
          var pathCell = ws[XLSX.utils.encode_cell({ r: r, c: header.public_path })];
          if (pathCell && String(pathCell.v).replace(/^\/+|\/+$/g, "") === slug) {
            ws[XLSX.utils.encode_cell({ r: r, c: header.plaintext_code })] = { t: "s", v: "" };
            if (header.encoded_code != null) ws[XLSX.utils.encode_cell({ r: r, c: header.encoded_code })] = { t: "s", v: "" };
            found = true; break;
          }
        }
        if (!found) throw new Error("No workbook row for " + slug);
        await writeWorkbook(book, commitMsg("Reset code for", slug));
      },
      saveNotes: async function (slug, notes) {
        var book = await readWorkbook();
        if (!book.wb) throw new Error("access-codes.xlsx not found");
        var ws = book.wb.Sheets[book.sheetName];
        var ref = XLSX.utils.decode_range(ws["!ref"]);
        var header = {};
        for (var c = ref.s.c; c <= ref.e.c; c++) {
          var cell = ws[XLSX.utils.encode_cell({ r: 0, c: c })];
          if (cell) header[String(cell.v)] = c;
        }
        if (header.notes == null) throw new Error("No notes column in workbook");
        for (var r = 1; r <= ref.e.r; r++) {
          var pathCell = ws[XLSX.utils.encode_cell({ r: r, c: header.public_path })];
          if (pathCell && String(pathCell.v).replace(/^\/+|\/+$/g, "") === slug) {
            ws[XLSX.utils.encode_cell({ r: r, c: header.notes })] = { t: "s", v: notes };
            await writeWorkbook(book, commitMsg("Edit notes for", slug));
            return;
          }
        }
        throw new Error("No workbook row for " + slug);
      },
      archivePage: function (slug) { return gh.moveDir(G.privateRepo, "internal/" + slug, "archive/" + slug, commitMsg("Archive", slug)); },
      restorePage: function (slug) { return gh.moveDir(G.privateRepo, "archive/" + slug, "internal/" + slug, commitMsg("Restore", slug)); },
      deletePage: async function (slug, status) {
        await gh.deleteDir(G.privateRepo, (status === "archived" ? "archive/" : "internal/") + slug, commitMsg("Delete", slug));
      },
      // Snapshot the public ciphertext sha so an update can detect re-publish.
      getEncSha: async function (slug) {
        var f = await gh.getFile(G.publicRepo, slug + "/content.enc");
        return f ? f.sha : null;
      },
      checkPublished: async function (slug, prevEncSha) {
        var f = await gh.getFile(G.publicRepo, slug + "/content.enc");
        if (!f) return false;
        if (prevEncSha && f.sha === prevEncSha) return false; // update not live yet
        // Confirm the page itself serves 200.
        try {
          var res = await fetch(CFG.site.baseUrl + "/" + slug + "/", { method: "HEAD", cache: "no-store" });
          return res.ok;
        } catch (e) { return false; }
      },
      checkUnpublished: async function (slug) {
        var f = await gh.getFile(G.publicRepo, slug + "/content.enc");
        return !f;
      },
    };
  }

  // Demo Mode was removed from the deployed app: its simulated data exposed the
  // real access-code vocabulary/pattern in this public file. The DemoStore lives
  // on in the internal handoff bundle's git history if ever needed for UX review.
  window.AdminData = {
    slugify: slugify,
    makeStore: function (user) { return RealStore(user); },
  };
})();
