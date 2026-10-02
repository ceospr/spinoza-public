'use strict';
const {test} = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const schema = require('../public-schema.js');
const candidates = require('../research-candidates.js');
const returns = require('../research-status.js');
const source = require('./fixtures/forward-report.json');

class Element {
  constructor(tag) {this.tagName = tag; this.children = []; this._text = '';}
  set innerHTML(_) {throw Error('HTML interpolation is not allowed');}
  set textContent(value) {this._text = String(value); this.children = [];}
  get textContent() {return this._text + this.children.map(node => node.textContent).join('');}
  append(...nodes) {this.children.push(...nodes);}
  appendChild(node) {this.children.push(node); return node;}
  replaceChildren(...nodes) {this.children = nodes; this._text = '';}
}
const documentMock = () => {const nodes = new Map(); return {createElement: tag => new Element(tag), getElementById: id => {if (!nodes.has(id)) nodes.set(id, new Element('div')); return nodes.get(id);}};};
function fixture() {
  const report = structuredClone(source), hash = crypto.createHash('sha256').update(JSON.stringify(report)).digest('hex');
  const row = {symbol: report.symbol, name: report.name, sector: report.sector, currency: 'USD', price: 120, price_date: '2026-10-01', intrinsic_estimate: 150, report_sha256: hash,
    month_end_forecast: {status: 'available', value: 122.5, month: '2026-10', target_date: '2026-10-30', as_of_utc: '2026-10-02T14:00:00Z', model_version: 'atlas_pulse_gap_twelfth_v1', kind: 'conditional_projection', methodology: 'One twelfth of the value gap; a conditional scenario.'}};
  return {row, report, reports: new Map([[row.symbol, {report, report_sha256: hash, selection_report_changed: false}]]),
    payload: {schema_version: 'spinoza.public-research.v1', research_only: true, published_at_utc: '2026-10-02T14:00:00Z', valid_until_utc: '2026-11-01T00:00:00Z', status: 'published', longs: [row], shorts: []}};
}

test('October projection is separate from intrinsic value and keeps its source assumptions when reports change', () => {
  const f = fixture(), document = documentMock();
  assert(schema.research(f.payload));
  f.report.quote.value = 130; f.report.estimates.intrinsic.value = 180;
  f.reports.get(f.row.symbol).selection_report_changed = true;
  candidates.render(f.payload, document, new Date('2026-10-03T00:00:00Z'), f.reports);
  const cells = document.getElementById('research_candidates_long_body').children[0].children;
  assert.equal(cells.length, 4);
  assert.match(cells[1].textContent, /\$130\.00/);
  assert.match(cells[2].textContent, /\$180\.00/);
  assert.match(cells[3].textContent, /\$122\.50/);
  assert.doesNotMatch(cells[3].textContent, /October 2026|2026-10-30|conditional projection|As of/);
  assert.doesNotMatch(cells[3].textContent, /atlas_pulse_gap_twelfth_v1/);
  assert.doesNotMatch(cells[3].textContent, /One twelfth/);
  assert.equal(document.getElementById('research_candidates_projection_methodology').textContent, 'Projection: One twelfth of the value gap; a conditional scenario.');
  assert.match(cells[3].textContent, /Projection baseline \$120\.00/);
  assert.match(cells[3].textContent, /retains the selection report assumptions/);
  assert.equal(document.getElementById('research_candidates_short_body').children[0].children[0].colSpan, 4);
});

test('missing, future and unverified projections never fall back to intrinsic or candidate estimates', () => {
  for (const kind of ['missing', 'unavailable', 'unverified']) {
    const f = fixture(), document = documentMock();
    if (kind === 'missing') delete f.row.month_end_forecast;
    if (kind === 'unavailable') {f.row.month_end_forecast.status = 'unavailable'; f.row.month_end_forecast.value = null;}
    if (kind === 'unverified') f.reports.clear();
    candidates.render(f.payload, document, new Date('2026-10-03T00:00:00Z'), f.reports);
    const cell = document.getElementById('research_candidates_long_body').children[0].children[3];
    assert.match(cell.textContent, /Unavailable/);
    assert.doesNotMatch(cell.textContent, /\$122\.50|\$150\.00/);
  }
});

test('future publications and prior-month projections cannot masquerade as the current selection', () => {
  const f = fixture(), document = documentMock();
  candidates.render(f.payload, document, new Date('2026-10-02T13:59:59Z'), f.reports);
  assert.doesNotMatch(document.getElementById('research_candidates_long_body').textContent, /122\.50/);
  for (const mutate of [
    p => p.longs[0].month_end_forecast.as_of_utc = '2026-10-03T00:00:00Z',
    p => p.longs[0].month_end_forecast.as_of_utc = '2026-09-30T23:00:00Z',
    p => p.longs[0].month_end_forecast.target_date = '2026-10-01',
    p => {p.published_at_utc = '2026-11-02T12:00:00Z'; p.valid_until_utc = '2026-12-01T00:00:00Z';},
    p => {p.published_at_utc = '2026-10-01T00:30:00Z'; p.longs[0].month_end_forecast.as_of_utc = p.published_at_utc;}
  ]) {const payload = structuredClone(f.payload); mutate(payload); assert.equal(schema.research(payload), false);}
});

test('forecast contract rejects mismatched horizons, contradictory availability and private fields', () => {
  for (const mutate of [f => f.value = -1, f => f.value = '122.5', f => f.status = 'unavailable', f => f.target_date = '2026-11-02', f => f.target_date = '2026-10-32', f => f.month = '2026-13', f => f.as_of_utc = null, f => f.model_version = '', f => f.kind = 'guaranteed', f => f.private_debug = true]) {
    const f = fixture(); mutate(f.row.month_end_forecast); assert.equal(schema.research(f.payload), false);
  }
});

function historyScenario(side = 'LONG') {
  const f = fixture();
  const dates = ['2025-12-31', '2026-01-30', '2026-02-27', '2026-03-31', '2026-04-30', '2026-05-29', '2026-06-30', '2026-07-31', '2026-08-31', '2026-09-30'];
  const closes = dates.map((date, index) => ({date, value: 100 * 1.02 ** index}));
  const mean = closes.slice(1).reduce((sum, row, index) => sum + row.value / closes[index].value - 1, 0) / 9;
  f.row.intrinsic_estimate = side === 'LONG' ? 150 : 60;
  const forecast = f.row.month_end_forecast;
  forecast.model_version = 'atlas_pulse_monthly_history_gap_v1';
  forecast.inputs = {average_monthly_return: mean, monthly_closes: closes, price_basis: 'split_adjusted_close'};
  forecast.value = side === 'LONG' ? 120 + 30 * Math.abs(mean) * 120 : 120 - 2 * Math.abs(mean) * 120 * 120 / 100;
  if (side === 'SHORT') {f.payload.longs = []; f.payload.shorts = [f.row];}
  return f;
}

test('history projection binds the completed-month average and side-specific requested formula', () => {
  for (const side of ['LONG', 'SHORT']) {
    const f = historyScenario(side);
    assert(schema.research(f.payload));
    assert.equal(f.row.month_end_forecast.inputs.monthly_closes.length, 10);
    if (side === 'LONG') assert(f.row.month_end_forecast.value > f.row.intrinsic_estimate, 'Requested arithmetic must not be silently capped at fair value');
    for (const mutate of [
      p => p.value += 1,
      p => p.inputs.average_monthly_return *= -2,
      p => p.inputs.monthly_closes.pop(),
      p => p.inputs.monthly_closes[0].date = '2026-01-02',
      p => p.inputs.monthly_closes[9].date = '2026-10-01',
      p => p.inputs.monthly_closes[5].value = 0,
      p => p.inputs.monthly_closes[5].private_debug = 'PRIVATE_CANARY',
      p => p.reason = 'insufficient_history',
    ]) {const changed = structuredClone(f.payload); mutate(changed[side === 'LONG' ? 'longs' : 'shorts'][0].month_end_forecast); assert.equal(schema.research(changed), false);}
  }
  const f = historyScenario('SHORT');
  f.row.month_end_forecast.value = 120 - 2 * Math.abs(f.row.month_end_forecast.inputs.average_monthly_return) * 120;
  assert.equal(schema.research(f.payload), false, 'Applying share price only once is not the requested short formula');
});

test('missing-history scenarios remain unavailable without an invented estimate', () => {
  const f = historyScenario();
  delete f.row.month_end_forecast.inputs;
  Object.assign(f.row.month_end_forecast, {status: 'unavailable', value: null, reason: 'insufficient_history'});
  assert(schema.research(f.payload));
  f.row.month_end_forecast.value = 120;
  assert.equal(schema.research(f.payload), false);
});

const tracker = () => ({schema_version: 'spinoza.public-research-performance.v1', status: 'published', updated_at_utc: '2026-10-02T20:00:00Z', methodology: 'Reconstructed gross research reference return. Separate from live account performance.',
  months: [{month: '2026-09', return_pct: 0.7224, start_date: '2026-09-08', end_date: '2026-09-30', status: 'final', methodology: 'Equal weight across 3 longs and 5 shorts; covers part of September.'}]});

test('September return displays its actual period without repeated methodology paragraphs', async () => {
  const payload = tracker(), document = documentMock(); assert(schema.tracker(payload));
  await returns.refresh({fetchImpl: async () => ({ok: true, json: async () => payload}), document});
  const body = document.getElementById('research_return_body');
  assert.match(body.textContent, /September 2026/);
  assert.match(body.textContent, /2026-09-08 to 2026-09-30/);
  assert.match(body.textContent, /\+0\.72%/);
  assert.doesNotMatch(body.textContent, /covers part of September|Reconstructed|Equal weight/);
  assert.equal(document.getElementById('atlas_tracker_methodology').textContent, '');
  assert.match(document.getElementById('atlas_tracker_updated').textContent, /Pacific/);
});

test('return validation rejects backwards periods and leaking fields; unavailable fetch clears old results', async () => {
  for (const mutate of [r => r.start_date = '2026-10-01', r => r.end_date = '2026-10-01', r => r.status = 'guaranteed', r => r.private_debug = true]) {
    const payload = tracker(); mutate(payload.months[0]); assert.equal(schema.tracker(payload), false);
  }
  const document = documentMock(); returns.render(tracker(), document);
  await returns.refresh({fetchImpl: async () => ({ok: false}), document});
  assert.doesNotMatch(document.getElementById('research_return_body').textContent, /0\.72/);
  assert.equal(document.getElementById('atlas_tracker_updated').textContent, '');
});
