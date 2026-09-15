"use strict";
const assert = require("node:assert/strict");
const {test} = require("node:test");
const fs = require("node:fs");
const path = require("node:path");
const schema = require("../public-schema.js");
const dashboard = require("../dashboard.js");
const root = path.join(__dirname, "..");
const legacy = JSON.parse(fs.readFileSync(path.join(root, "data/public_dashboard.json"), "utf8"));

class Element {
  constructor(tag) { this.tagName = tag; this.children = []; this._text = ""; }
  set innerHTML(_) { throw Error("HTML interpolation is forbidden"); }
  set textContent(value) { this._text = String(value); this.children = []; }
  get textContent() { return this._text + this.children.map(node => node.textContent).join(""); }
  appendChild(node) { this.children.push(node); return node; }
  replaceChildren(...children) { this.children = children; this._text = ""; }
}
function documentMock(source) {
  const nodes = new Map();
  return {
    body: {dataset: source === undefined ? {} : {dashboardSource: source}},
    createElement: tag => new Element(tag),
    getElementById: id => { if (!nodes.has(id)) nodes.set(id, new Element("div")); return nodes.get(id); }, nodes
  };
}
function sample() {
  return {
    schema_version: "spinoza.public-dashboard.v2", updated_at_utc: "2026-09-14T20:20:07Z",
    performance: {since_inception_return_pct: 4, ytd_return_pct: 4, daily_return_pct: 0, max_drawdown_pct: 9.56,
      win_rate_pct: 50, profit_factor: 2.5, closed_trades_count: 2, winning_trades_count: 1, losing_trades_count: 1,
      breakeven_trades_count: 0, open_positions_count: 1},
    monthly_performance: [{month: "2026-08", return_pct: -1.5}], performance_history: [{date: "2026-08-31", return_pct: -1.5}],
    trade_history: [
      {symbol: "AAPL", direction: "LONG", entry_date: "2026-09-01", exit_date: "2026-09-08", entry_price: 100.1234, exit_price: 101, realized_return_pct: 7.25},
      {symbol: "MSFT", direction: "SHORT", entry_date: "2026-09-02", exit_date: "2026-09-09", entry_price: 101, exit_price: 100, realized_return_pct: -2.13}
    ],
    open_positions: [{symbol: "GOOG", direction: "SHORT", average_entry_price: 90, latest_price: 89, unrealized_return_pct: 3.74}]
  };
}
const rows = (document, id) => document.getElementById(id).children.map(tr => tr.children.map(td => td.textContent));

test("strict v2 accepts only the approved shapes and preserves the existing v1 feed", () => {
  assert(schema.dashboard(legacy));
  assert(schema.dashboard({...legacy, performance: {daily_return_pct: 0}}));
  assert(schema.dashboard(sample()));
  const original = sample();
  function objectPaths(value, prefix = []) {
    if (!value || typeof value !== "object") return [];
    return [...(!Array.isArray(value) ? [prefix] : []), ...Object.entries(value).flatMap(([key, child]) => objectPaths(child, [...prefix, key]))];
  }
  for (const keys of objectPaths(original)) {
    const payload = structuredClone(original); let node = payload;
    for (const key of keys) node = node[key];
    node.private_state = {secret: "audit-marker"};
    assert.equal(schema.dashboard(payload), false, keys.join("."));
  }
  for (const key of Object.keys(original.performance)) {
    const payload = sample(); delete payload.performance[key];
    assert.equal(schema.dashboard(payload), false, key);
  }
  const hybrid = {...legacy, trade_history: [], open_positions: []};
  assert.equal(schema.dashboard(hybrid), false);
});

test("trade and position identities, calendar dates, enums, prices and numeric return types are checked", () => {
  const invalid = [
    ["symbol", '<img src=x onerror="void null">'], ["symbol", "../private"], ["direction", "BUY"],
    ["entry_date", "2026-02-30"], ["exit_date", "2026-01-01"], ["entry_date", "2026-09-01T12:00:00Z"],
    ["entry_price", 0], ["exit_price", -1], ["entry_price", "100"], ["exit_price", Infinity], ["entry_price", 100.123456],
    ["realized_return_pct", "5"], ["realized_return_pct", NaN], ["realized_return_pct", 1.234]
  ];
  for (const [field, value] of invalid) {
    const payload = sample(); payload.trade_history[0][field] = value;
    assert.equal(schema.dashboard(payload), false, field);
  }
  for (const [field, value] of [["symbol", "<svg>"], ["direction", "SELL"], ["average_entry_price", null], ["latest_price", 0], ["unrealized_return_pct", true]]) {
    const payload = sample(); payload.open_positions[0][field] = value;
    assert.equal(schema.dashboard(payload), false, field);
  }
  const nullable = sample(); nullable.trade_history[0].realized_return_pct = null; nullable.open_positions[0].unrealized_return_pct = null;
  for (const key of Object.keys(nullable.performance)) nullable.performance[key] = null;
  assert(schema.dashboard(nullable));
});

test("invalid metric ranges, contradictory counts and oversized detail arrays are rejected", () => {
  for (const [field, value] of [["profit_factor", -1], ["profit_factor", Infinity], ["profit_factor", 1.234], ["max_drawdown_pct", -1], ["win_rate_pct", 101], ["win_rate_pct", -1], ["closed_trades_count", 1.5], ["open_positions_count", -1], ["open_positions_count", 0], ["winning_trades_count", 3], ["winning_trades_count", 0], ["closed_trades_count", Number.MAX_SAFE_INTEGER + 1]]) {
    const payload = sample(); payload.performance[field] = value;
    assert.equal(schema.dashboard(payload), false, field);
  }
  const trades = sample(); trades.trade_history = Array.from({length: 2001}, () => trades.trade_history[0]);
  assert.equal(schema.dashboard(trades), false);
  const positions = sample(); positions.open_positions = Array.from({length: 1001}, () => positions.open_positions[0]);
  assert.equal(schema.dashboard(positions), false);
  const counts = sample(); counts.performance.closed_trades_count = 0;
  for (const key of ["winning_trades_count", "losing_trades_count", "breakeven_trades_count"]) counts.performance[key] = null;
  assert.equal(schema.dashboard(counts), false, "Known count cannot be less than included trade rows");
  const truncated = sample(); truncated.trade_history = []; truncated.open_positions = [];
  assert(schema.dashboard(truncated), "Counts may refer to a larger history than the displayed slice");
});

test("rendering displays supplied returns and calendar dates without recalculation or HTML", () => {
  const payload = sample(), before = structuredClone(payload), document = documentMock();
  assert.equal(dashboard.render(payload, document), payload);
  assert.deepEqual(payload, before, "Rendering must not sort or alter the input publication");
  assert.deepEqual(rows(document, "trade_table_body"), [
    ["MSFT", "Short", "2026-09-02", "2026-09-09", "$101.00", "$100.00", "-2.13%"],
    ["AAPL", "Long", "2026-09-01", "2026-09-08", "$100.1234", "$101.00", "+7.25%"]
  ]);
  assert.deepEqual(rows(document, "positions_table_body"), [["GOOG", "Short", "$90.00", "$89.00", "+3.74%"]]);
  assert.equal(document.getElementById("profit_factor").textContent, "2.50");
  assert.equal(document.getElementById("daily_return_pct").textContent, "0.00%");
  assert.equal(document.getElementById("breakeven_trades_count").textContent, "0");
  assert.match(document.getElementById("preview_snapshot_date").textContent, /Sep 14, 2026.*1:20 PM Pacific/);
  assert.match(document.getElementById("positions_as_of").textContent, /^Positions at the snapshot time/);
  const duplicate = sample(); duplicate.trade_history.push(structuredClone(duplicate.trade_history[0]));
  duplicate.performance.closed_trades_count = 3; duplicate.performance.winning_trades_count = 2;
  dashboard.render(duplicate, document);
  assert.equal(rows(document, "trade_table_body").length, 3, "Distinct matched exits may share all public fields");
});

test("hostile or invalid subsequent input clears all previously rendered details", () => {
  const document = documentMock();
  dashboard.render(sample(), document);
  const hostile = sample(); hostile.trade_history[0].symbol = '<img src=x onerror="void null">';
  assert.equal(dashboard.render(hostile, document), null);
  assert.equal(document.getElementById("profit_factor").textContent, "Unavailable");
  assert.match(document.getElementById("trade_table_body").textContent, /not available/);
  assert.match(document.getElementById("positions_table_body").textContent, /not available/);
  assert(!document.getElementById("trade_table_body").textContent.includes("img"));
  const nullable = sample(); nullable.performance.profit_factor = null; nullable.trade_history[0].realized_return_pct = null;
  dashboard.render(nullable, document);
  assert.equal(document.getElementById("profit_factor").textContent, "Unavailable");
  assert.equal(rows(document, "trade_table_body")[1][6], "Unavailable");
  const empty = sample(); empty.trade_history = []; empty.open_positions = [];
  dashboard.render(empty, document);
  assert.equal(document.getElementById("trade_table_body").children[0].children[0].colSpan, 7);
  assert.equal(document.getElementById("positions_table_body").children[0].children[0].colSpan, 5);
});

test("preview loads only its approved fixed snapshot and never falls back to the normal feed", async () => {
  const calls = [], document = documentMock("review/dashboard.json");
  assert(await dashboard.refresh({document, fetchImpl: async (url, options) => { calls.push(url); assert.equal(options.cache, "no-store"); return {ok: true, json: async () => sample()}; }}));
  assert.deepEqual(calls, ["review/dashboard.json"]);
  calls.length = 0;
  assert.equal(await dashboard.refresh({document, fetchImpl: async url => { calls.push(url); return {ok: false}; }}), null);
  assert.deepEqual(calls, ["review/dashboard.json"]);
  assert.match(document.getElementById("trade_table_body").textContent, /not available/);
  assert.equal(await dashboard.refresh({document, fetchImpl: async () => ({ok: true, json: async () => legacy})}), null);
  for (const source of ["https://example.invalid/private", "//example.invalid/x", "../invest/.env", "data/public_dashboard.json?url=private", "review/../data/public_dashboard.json", ""]) {
    let requested = false;
    assert.equal(await dashboard.refresh({document: documentMock(source), fetchImpl: async () => { requested = true; throw Error(); }}), null);
    assert.equal(requested, false, source);
  }
});

test("normal homepage still loads its v1 publication and missing optional tables are harmless", async () => {
  const document = documentMock();
  const get = document.getElementById;
  document.getElementById = id => ["trade_table_body", "positions_table_body"].includes(id) ? null : get(id);
  const calls = [];
  const payload = await dashboard.refresh({document, fetchImpl: async url => {calls.push(url); return {ok: true, json: async () => legacy};}});
  assert.deepEqual(payload, legacy);
  assert.deepEqual(calls, ["data/public_dashboard.json"]);
  assert.equal(document.getElementById("daily_return_pct").textContent, dashboard.percent(legacy.performance.daily_return_pct));
});

test("review page and actual snapshot keep the disclosure and dates explicit", () => {
  const html = fs.readFileSync(path.join(root, "dashboard-preview.html"), "utf8");
  const home = fs.readFileSync(path.join(root, "index.html"), "utf8");
  assert.match(html, /data-dashboard-source="review\/dashboard.json"/);
  assert.match(html, /Fixed snapshot for review · September 14, 2026/);
  assert.match(html, /Account returns and drawdown cover the account/);
  assert.match(html, /Trade statistics cover the published closed-trade history/);
  assert(!home.includes("review/dashboard.json"));
  assert(!home.includes('id="trade_table_body"'));
  for (const id of ["since_inception_return_pct", "profit_factor", "closed_trades_count", "positions_table_body", "trade_table_body", "preview_snapshot_date"]) assert(html.includes(`id="${id}"`), id);
  for (const script of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) { assert.equal(script[2].trim(), ""); assert(!script[1].includes("https:")); }
  const payload = JSON.parse(fs.readFileSync(path.join(root, "review/dashboard.json"), "utf8"));
  assert(schema.dashboard(payload));
  assert.equal(payload.schema_version, "spinoza.public-dashboard.v2");
  assert.equal(payload.updated_at_utc, "2026-09-14T20:20:07Z");
  const document = documentMock("review/dashboard.json"); dashboard.render(payload, document);
  assert.equal(rows(document, "trade_table_body").length, payload.trade_history.length);
  assert.equal(rows(document, "positions_table_body").length, payload.open_positions.length);
});
