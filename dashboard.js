/* Portfolio presentation consumes aggregate results only. */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else { root.SpinozaDashboard = api; document.addEventListener("DOMContentLoaded", () => api.refresh()); }
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";
  const percent = (value, signed = true) => typeof value === "number" && Number.isFinite(value) ? `${signed && value > 0 ? "+" : ""}${value.toFixed(2)}%` : "Unavailable";
  function render(payload, document = globalThis.document) {
    const text = (id, value) => { const node = document.getElementById(id); if (node) node.textContent = value; };
    text("updated_at", payload?.updated_at_utc ? new Date(payload.updated_at_utc).toLocaleString() : "Unavailable");
    for (const key of ["since_inception_return_pct", "ytd_return_pct", "daily_return_pct", "max_drawdown_pct", "win_rate_pct"]) text(key, percent(payload?.performance?.[key], !["max_drawdown_pct", "win_rate_pct"].includes(key)));
    const body = document.getElementById("monthly_table_body");
    body.replaceChildren();
    for (const row of payload?.monthly_performance || []) {
      const tr = document.createElement("tr");
      for (const value of [row.month, percent(row.return_pct)]) {const td = document.createElement("td"); td.textContent = value; tr.appendChild(td);}
      body.appendChild(tr);
    }
    if (!body.children.length) { const tr = document.createElement("tr"), td = document.createElement("td"); td.colSpan = 2; td.className = "empty"; td.textContent = "Monthly results are not currently published."; tr.appendChild(td); body.appendChild(tr); }
    text("performance_status", payload ? "Published aggregate account performance. Results reflect the stated reporting date." : "Performance is temporarily unavailable. Please try again later.");
  }
  async function refresh({fetchImpl = globalThis.fetch, document = globalThis.document} = {}) {
    try { const response = await fetchImpl("data/public_dashboard.json", {cache: "no-store"}); if (!response.ok) throw Error(); const payload = await response.json(); if (!globalThis.PublicSchema.dashboard(payload)) throw Error(); render(payload, document); }
    catch (_) { render(null, document); }
    const year = document.getElementById("year"); if (year) year.textContent = String(new Date().getFullYear());
    if (globalThis.renderResearchPreview) globalThis.renderResearchPreview("#research-preview", {limit: 3});
  }
  return Object.freeze({render, refresh, percent});
});
