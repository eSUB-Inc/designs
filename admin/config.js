// Deployment configuration for the eSUB Designs Admin SPA.
// Fill these in before deploying. When clientId is left as a placeholder the
// app offers Demo Mode (simulated data, no network) so the UI can be reviewed.
window.ADMIN_CONFIG = {
  // Microsoft Entra ID app registration (esub.com tenant).
  // The app registration must be restricted to the designated security group
  // via "Assignment required" + group assignment on the Enterprise Application.
  auth: {
    clientId: "b0ef8399-d759-4bf0-b1a9-d06206a7f06c",
    tenantId: "9f90601e-35f6-4142-aacf-53f1218356e2",
    // Normalized so /admin/index.html and /admin/ both resolve to the single
    // registered redirect URI (https://designs.esub.com/admin/).
    redirectUri: window.location.origin + window.location.pathname.replace(/index\.html$/, ""),
  },
  // GitHub repositories.
  github: {
    owner: "eSUB-Inc",
    publicRepo: "designs",          // GitHub Pages site (ciphertext + gate)
    privateRepo: "designs-internal", // plaintext sources + access-codes.xlsx
    branch: "main",
  },
  site: {
    baseUrl: "https://designs.esub.com",
  },
  // Auth proxy (Cloudflare Worker; source in designs-internal under
  // design_handoff_admin_publishing_layer/proxy/). When baseUrl is set the app
  // never asks for a GitHub token: it sends the signed Entra ID token from login
  // and the proxy makes the GitHub calls with a server-held PAT. Leave "" to
  // fall back to the per-session PAT gate.
  proxy: {
    baseUrl: "https://designs-admin-proxy.esub-designs.workers.dev",
  },
  publishing: {
    pollIntervalMs: 15000,   // how often to check a pending page
    pollTimeoutMs: 600000,   // 10 min without success -> error state
    pageSize: 12,            // rows per page before pagination appears
    // Upload cap. Large files are supported (reads over 1 MB go through the
    // git blobs API), so this is a sanity bound, not an API limit — the gate
    // decrypts the whole page in the browser, so keep pages lean.
    maxUploadBytes: 26214400, // 25 MB
  },
  helpDesk: {
    // Service-desk portal for access requests and failed-publish investigations.
    // Rendered as "Contact Help Desk" with the label as the clickable link.
    url: "https://esubdev.atlassian.net/servicedesk/customer/portal/3",
    label: "Help Desk",
  },
};
