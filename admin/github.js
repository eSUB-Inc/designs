// Thin GitHub REST v3 client with two transports:
//  - Proxy mode (config.proxy.baseUrl set): every call goes to the auth proxy
//    with the user's Entra ID token; the proxy holds the PAT server-side.
//  - Direct mode (fallback): a per-session fine-grained PAT with Contents
//    Read/Write on designs-internal and Read on designs. No Actions scope:
//    publish status is inferred from content.enc + a live 200 check.
// Exposes window.GitHubApi.
(function () {
  "use strict";
  var G = window.ADMIN_CONFIG.github;
  var P = window.ADMIN_CONFIG.proxy || {};
  var API = "https://api.github.com";
  var token = null;

  function setToken(t) { token = t; }
  function proxyMode() { return !!P.baseUrl; }

  async function req(method, path, body) {
    var res;
    if (proxyMode()) {
      var idToken = await window.AdminAuth.getApiToken();
      res = await fetch(P.baseUrl.replace(/\/+$/, "") + "/gh", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: "Bearer " + idToken },
        body: JSON.stringify({ method: method, path: path, body: body || null }),
      });
    } else {
      res = await fetch(API + path, {
        method: method,
        headers: {
          Accept: "application/vnd.github+json",
          Authorization: "Bearer " + token,
          "X-GitHub-Api-Version": "2022-11-28",
        },
        body: body ? JSON.stringify(body) : undefined,
      });
    }
    if (res.status === 404) return { notFound: true };
    if (!res.ok) {
      var text = await res.text();
      var err = new Error("GitHub " + method + " " + path + " -> " + res.status + ": " + text.slice(0, 300));
      err.status = res.status;
      throw err;
    }
    return res.status === 204 ? {} : res.json();
  }

  async function verifyToken() {
    // Cheapest calls that prove the PAT reaches both repos.
    await req("GET", "/repos/" + G.owner + "/" + G.privateRepo);
    await req("GET", "/repos/" + G.owner + "/" + G.publicRepo);
  }

  function listDir(repo, path) {
    return req("GET", "/repos/" + G.owner + "/" + repo + "/contents/" + path + "?ref=" + G.branch);
  }

  async function getFile(repo, path) {
    var r = await req("GET", "/repos/" + G.owner + "/" + repo + "/contents/" + encodeURI(path) + "?ref=" + G.branch);
    if (r.notFound) return null;
    return r; // { content: base64, sha, ... }
  }

  function putFile(repo, path, base64Content, message, sha) {
    var body = { message: message, content: base64Content, branch: G.branch };
    if (sha) body.sha = sha;
    return req("PUT", "/repos/" + G.owner + "/" + repo + "/contents/" + encodeURI(path), body);
  }

  function deleteFile(repo, path, sha, message) {
    return req("DELETE", "/repos/" + G.owner + "/" + repo + "/contents/" + encodeURI(path), {
      message: message, sha: sha, branch: G.branch,
    });
  }

  // Latest commit touching a path -> { date, authorName } or null.
  async function latestCommit(repo, path) {
    var r = await req("GET", "/repos/" + G.owner + "/" + repo + "/commits?path=" + encodeURIComponent(path) + "&per_page=1&sha=" + G.branch);
    if (!r || r.notFound || !r.length) return null;
    var c = r[0];
    return {
      date: c.commit.committer.date,
      authorName: (c.commit.author && c.commit.author.name) || "",
      message: c.commit.message || "",
      sha: c.sha,
    };
  }

  // Move every file under fromDir to toDir in the private repo (copy + delete).
  async function moveDir(repo, fromDir, toDir, message) {
    var entries = await listDir(repo, fromDir);
    if (entries.notFound) throw new Error("Folder not found: " + fromDir);
    for (var i = 0; i < entries.length; i++) {
      var e = entries[i];
      if (e.type === "dir") { await moveDir(repo, e.path, toDir + "/" + e.name, message); continue; }
      var f = await getFile(repo, e.path);
      // The contents API returns EMPTY content for blobs over 1 MB — copying
      // that would silently truncate the file to zero bytes (and the delete
      // below would destroy the original). Refuse instead.
      if (e.size > 0 && !(f.content && f.content.length)) {
        throw new Error(e.path + " is " + (e.size / 1048576).toFixed(1) +
          " MB — over the 1 MB GitHub API limit, so it can't be moved by the admin app. Move it via git, or ask for the app's large-file upgrade.");
      }
      await putFile(repo, toDir + "/" + e.name, f.content.replace(/\n/g, ""), message);
      await deleteFile(repo, e.path, f.sha, message);
    }
  }

  async function deleteDir(repo, dir, message) {
    var entries = await listDir(repo, dir);
    if (entries.notFound) return;
    for (var i = 0; i < entries.length; i++) {
      var e = entries[i];
      if (e.type === "dir") { await deleteDir(repo, e.path, message); continue; }
      var f = await getFile(repo, e.path);
      await deleteFile(repo, e.path, f.sha, message);
    }
  }

  window.GitHubApi = {
    setToken: setToken, verifyToken: verifyToken, listDir: listDir, getFile: getFile,
    putFile: putFile, deleteFile: deleteFile, latestCommit: latestCommit,
    moveDir: moveDir, deleteDir: deleteDir,
  };
})();
