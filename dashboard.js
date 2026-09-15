/* Display approved account results. Publication calculations remain private. */
(function (root, factory) {
  const api = factory(typeof module === "object" && module.exports ? require("./public-schema.js") : root.PublicSchema);
  if (typeof module === "object" && module.exports) module.exports = api;
  else { root.SpinozaDashboard = api; document.addEventListener("DOMContentLoaded", () => api.refresh()); }
})(typeof globalThis !== "undefined" ? globalThis : this, function (schema) {
  "use strict";
  const finite = value => typeof value === "number" && Number.isFinite(value);
  const percent = (value, signed = true) => finite(value) ? `${signed && value > 0 ? "+" : ""}${value.toFixed(2)}%` : "Unavailable";
  const price = value => finite(value) ? new Intl.NumberFormat("en-US", {style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 4}).format(value) : "Unavailable";
  const count = value => Number.isSafeInteger(value) && value >= 0 ? value.toLocaleString("en-US") : "Unavailable";
  const asOf = value => value ? new Intl.DateTimeFormat("en-US", {dateStyle: "medium", timeStyle: "short", timeZone: "America/Los_Angeles"}).format(new Date(value)) + " Pacific" : "Unavailable";
  function table(document, id, rows, columns, emptyMessage) {
    const body = document.getElementById(id);
    if (!body) return;
    body.replaceChildren();
    for (const row of rows) {
      const tr = document.createElement("tr");
      for (const column of columns) {
        const td = document.createElement("td");
        td.textContent = column.value(row);
        if (column.className) td.className = column.className(row);
        tr.appendChild(td);
      }
      body.appendChild(tr);
    }
    if (!rows.length) {
      const tr = document.createElement("tr"), td = document.createElement("td");
      td.colSpan = columns.length; td.className = "empty"; td.textContent = emptyMessage; tr.appendChild(td); body.appendChild(tr);
    }
  }
  const returnClass = value => !finite(value) || value === 0 ? "return-neutral dashboard-number" : value > 0 ? "return-positive dashboard-number" : "return-negative dashboard-number";
  function render(candidate, document = globalThis.document) {
    const payload = schema.dashboard(candidate) ? candidate : null;
    const v2 = payload?.schema_version === "spinoza.public-dashboard.v2";
    const text = (id, value) => { const node = document.getElementById(id); if (node) node.textContent = value; };
    text("updated_at", asOf(payload?.updated_at_utc));
    text("preview_snapshot_date", asOf(payload?.updated_at_utc));
    text("positions_as_of", payload?.updated_at_utc ? "Positions at the snapshot time · " + asOf(payload.updated_at_utc) : "Snapshot date unavailable");
    for (const key of ["since_inception_return_pct", "ytd_return_pct", "daily_return_pct", "max_drawdown_pct", "win_rate_pct"]) {
      text(key, percent(payload?.performance?.[key], !["max_drawdown_pct", "win_rate_pct"].includes(key)));
    }
    text("profit_factor", finite(payload?.performance?.profit_factor) ? payload.performance.profit_factor.toFixed(2) : "Unavailable");
    for (const key of ["closed_trades_count", "winning_trades_count", "losing_trades_count", "breakeven_trades_count", "open_positions_count"]) text(key, count(payload?.performance?.[key]));
    table(document, "monthly_table_body", payload?.monthly_performance || [], [
      {value: row => row.month}, {value: row => percent(row.return_pct), className: row => returnClass(row.return_pct)}
    ], "Monthly results are not currently published.");
    const trades = v2 ? payload.trade_history.slice().sort((a, b) => b.exit_date.localeCompare(a.exit_date) || b.entry_date.localeCompare(a.entry_date)) : [];
    table(document, "trade_table_body", trades, [
      {value: row => row.symbol, className: () => "dashboard-ticker"},
      {value: row => row.direction === "LONG" ? "Long" : "Short"},
      {value: row => row.entry_date}, {value: row => row.exit_date},
      {value: row => price(row.entry_price), className: () => "dashboard-number"},
      {value: row => price(row.exit_price), className: () => "dashboard-number"},
      {value: row => percent(row.realized_return_pct), className: row => returnClass(row.realized_return_pct)}
    ], v2 ? "No completed trades are included in this snapshot." : "Completed-trade details are not available in this publication.");
    const positions = v2 ? payload.open_positions.slice().sort((a, b) => a.symbol.localeCompare(b.symbol)) : [];
    table(document, "positions_table_body", positions, [
      {value: row => row.symbol, className: () => "dashboard-ticker"},
      {value: row => row.direction === "LONG" ? "Long" : "Short"},
      {value: row => price(row.average_entry_price), className: () => "dashboard-number"},
      {value: row => price(row.latest_price), className: () => "dashboard-number"},
      {value: row => percent(row.unrealized_return_pct), className: row => returnClass(row.unrealized_return_pct)}
    ], v2 ? "No positions are included in this snapshot." : "Position details are not available in this publication.");
    text("trade_records_status", v2 ? `${count(trades.length)} completed-trade records shown · most recent exits first` : "Trade details unavailable");
    text("position_records_status", v2 ? `${count(positions.length)} positions shown` : "Position details unavailable");
    text("performance_status", payload ? "Published account performance. Results reflect the stated reporting date." : "Performance is temporarily unavailable. Please try again later.");
    return payload;
  }
  function dataSource(document) {
    const source = document.body?.dataset?.dashboardSource;
    if (source === undefined || source === "data/public_dashboard.json") return "data/public_dashboard.json";
    if (source === "review/dashboard.json") return source;
    throw new Error("Unsupported dashboard publication.");
  }
  async function refresh({fetchImpl = globalThis.fetch, document = globalThis.document} = {}) {
    let payload = null;
    try {
      const source = dataSource(document);
      const response = await fetchImpl(source, {cache: "no-store"});
      if (!response.ok) throw new Error("Publication unavailable.");
      const candidate = await response.json();
      if (!schema.dashboard(candidate) || (source === "review/dashboard.json" && candidate.schema_version !== "spinoza.public-dashboard.v2")) throw new Error("Unsupported publication.");
      payload = candidate;
    } catch (_) { /* Unverified or unavailable publications clear all displayed values. */ }
    render(payload, document);
    const year = document.getElementById("year"); if (year) year.textContent = String(new Date().getFullYear());
    if (globalThis.renderResearchPreview) globalThis.renderResearchPreview("#research-preview", {limit: 3});
    return payload;
  }
  return Object.freeze({render, refresh, percent, dataSource});
});
