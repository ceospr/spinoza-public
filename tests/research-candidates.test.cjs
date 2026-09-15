'use strict';
const assert = require('node:assert/strict');
const {test} = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const S = require('../public-schema.js');
const candidates = require('../research-candidates.js');
const dashboard = require('../dashboard.js');
const valuation = require('../valuation.js');
const root = path.join(__dirname, '..');
const data = name => JSON.parse(fs.readFileSync(path.join(root, 'data', name), 'utf8'));
const clone = value => structuredClone(value);
const index = data('valuation-index.json');
const candidatesData = data('research-candidates.json');
const dashboardData = data('public_dashboard.json');

class Element {
  constructor(tag) {this.tagName = tag; this.children = []; this._text = '';}
  set innerHTML(_) {throw Error('HTML interpolation is not allowed');}
  set textContent(value) {this._text = String(value); this.children = [];}
  get textContent() {return this._text + this.children.map(node => node.textContent).join('');}
  append(...nodes) {this.children.push(...nodes);}
  appendChild(node) {this.children.push(node); return node;}
  replaceChildren(...nodes) {this.children = nodes; this._text = '';}
}
const documentMock = () => {
  const nodes = new Map();
  return {createElement: tag => new Element(tag), getElementById: id => {if (!nodes.has(id)) nodes.set(id, new Element('div')); return nodes.get(id);}, nodes};
};

test('every public data file matches an approved display schema', () => {
  assert(S.valuationIndex(index));
  const expected = new Set(['valuation-index.json', 'research-candidates.json', 'atlas_pulse_tracker.json', 'public_dashboard.json', 'public_dashboard_large.json', 'research.json', ...index.companies.map(row => row.file)]);
  assert.deepEqual(new Set(fs.readdirSync(path.join(root, 'data'))), expected);
  for (const row of index.companies) {
    const bytes = fs.readFileSync(path.join(root, 'data', row.file));
    assert.equal(crypto.createHash('sha256').update(bytes).digest('hex'), row.sha256, row.symbol);
    const report = JSON.parse(bytes);
    assert(S.valuation(report), row.symbol);
    assert.doesNotThrow(() => valuation.validateReport(report, row));
  }
  assert(S.research(candidatesData));
  assert(S.dashboard(dashboardData));
  assert(S.dashboard(data('public_dashboard_large.json')));
  assert(S.tracker(data('atlas_pulse_tracker.json')));
  const catalog = data('research.json');
  assert.equal(catalog.schema_version, 'spinoza.research.v1');
  for (const paper of catalog.papers) {
    assert(/^papers\/[a-z0-9][a-z0-9/-]*\.pdf$/.test(paper.pdf));
    assert(!paper.pdf.includes('..'));
    const bytes = fs.readFileSync(path.join(root, paper.pdf));
    assert.equal(crypto.createHash('sha256').update(bytes).digest('hex'), paper.sha256);
  }
});

test('research references bind to the exact sanitized company report and final estimate', () => {
  for (const row of [...candidatesData.longs, ...candidatesData.shorts]) {
    const entry = index.companies.find(item => item.symbol === row.symbol);
    assert(entry);
    assert.equal(row.report_sha256, entry.sha256);
    const report = data(entry.file);
    assert.equal(row.intrinsic_estimate, report.estimates.intrinsic.value);
    assert.equal(row.price, report.quote.value);
    assert.equal(row.price_date, report.quote.date);
    assert.doesNotThrow(() => valuation.validateReport(report, entry, row.report_sha256));
    assert.throws(() => valuation.validateReport(report, entry, '0'.repeat(64)));
  }
});

test('unknown fields fail closed at every nested publication boundary', () => {
  const payloads = [[S.dashboard, dashboardData], [S.valuationIndex, index], [S.valuation, data(index.companies[0].file)], [S.research, candidatesData], [S.tracker, data('atlas_pulse_tracker.json')]];
  function paths(value, prefix = []) {
    const result = [];
    if (value && typeof value === 'object') {
      if (!Array.isArray(value)) result.push(prefix);
      for (const [key, child] of Object.entries(value)) result.push(...paths(child, [...prefix, key]));
    }
    return result;
  }
  for (const [validate, original] of payloads) {
    for (const keys of paths(original)) {
      const mutated = clone(original); let target = mutated;
      for (const key of keys) target = target[key];
      target.private_debug = {value: 123};
      assert.equal(validate(mutated), false, keys.join('.'));
    }
  }
  const withPeriods = clone(dashboardData);
  withPeriods.monthly_performance = [{month: '2026-08', return_pct: 2, private_debug: 1}];
  assert.equal(S.dashboard(withPeriods), false);
  withPeriods.monthly_performance = []; withPeriods.performance_history = [{date: '2026-08-31', return_pct: 2, private_debug: 1}];
  assert.equal(S.dashboard(withPeriods), false);
});

test('invalid units, values, identities and dates are rejected', () => {
  for (const value of ['2.1', Infinity, NaN, true, {}]) {const item = clone(dashboardData); item.performance.daily_return_pct = value; assert.equal(S.dashboard(item), false);}
  for (const month of ['2026-13', '2026-00', '../data']) {const item = clone(dashboardData); item.monthly_performance = [{month, return_pct: 1}]; assert.equal(S.dashboard(item), false);}
  const report = data(index.companies[0].file); report.estimates.intrinsic = {status: 'unavailable', value: 1}; assert.equal(S.valuation(report), false);
  const unsafeIndex = clone(index); unsafeIndex.companies[0].file = '../private.json'; assert.equal(S.valuationIndex(unsafeIndex), false);
  const rows = clone(candidatesData); rows.shorts.push(clone(rows.longs[0])); assert.equal(S.research(rows), false);
});

test('SEC action accepts only the intended HTTPS issuer page', () => {
  assert.equal(S.secUrl('https://www.sec.gov/edgar/browse/?CIK=320193&owner=exclude'), true);
  for (const url of ['javascript:alert(1)', 'data:text/html,hello', 'http://www.sec.gov/edgar/browse/?CIK=1', 'https://www.sec.gov.evil.example/edgar/browse/?CIK=1', 'https://evil.example/?url=https://www.sec.gov', 'https://user@www.sec.gov/edgar/browse/?CIK=1', 'https://www.sec.gov/edgar/browse/?CIK=oops', '//www.sec.gov/edgar/browse/?CIK=1']) assert.equal(S.secUrl(url), false, url);
});

test('research text remains text when feed fields contain HTML', () => {
  const payload = clone(candidatesData), hostile = '<img src=x onerror="void null">';
  payload.longs[0].name = hostile; payload.longs[0].sector = hostile;
  assert(S.research(payload));
  const document = documentMock();
  candidates.render(payload, document, new Date('2026-09-14T20:00:00Z'));
  const body = document.getElementById('research_candidates_long_body');
  assert(body.textContent.includes(hostile));
  const tags = node => [node.tagName, ...node.children.flatMap(tags)];
  assert(!tags(body).includes('img'));
  assert.equal(document.getElementById('research_candidates_status').textContent, 'Archived research');
});

test('dashboard handles partial metrics and renders monthly values without HTML', () => {
  const document = documentMock();
  dashboard.render({...dashboardData, performance: {daily_return_pct: 0}, monthly_performance: [{month: '2026-08', return_pct: -1.5}]}, document);
  assert.equal(document.getElementById('daily_return_pct').textContent, '0.00%');
  assert.equal(document.getElementById('win_rate_pct').textContent, 'Unavailable');
  assert(document.getElementById('monthly_table_body').textContent.includes('-1.50%'));
  dashboard.render(null, document);
  assert.equal(document.getElementById('daily_return_pct').textContent, 'Unavailable');
});

test('company search preserves distinct estimate availability', () => {
  assert.equal(valuation.filter(index.companies, 'aapl')[0].symbol, 'AAPL');
  for (const kind of ['intrinsic', 'relative', 'income']) {
    assert(valuation.filter(index.companies, '', '', kind).every(row => row[kind + '_available']));
  }
  assert(valuation.filter(index.companies, '', '', 'unavailable').every(row => !row.intrinsic_available && !row.relative_available && !row.income_available));
});

test('public HTML uses local external scripts with restrictive CSP', () => {
  for (const file of fs.readdirSync(root).filter(name => name.endsWith('.html'))) {
    const html = fs.readFileSync(path.join(root, file), 'utf8');
    assert(html.includes('http-equiv="Content-Security-Policy"'), file);
    assert(html.includes("script-src 'self'"), file);
    assert(!html.includes('unsafe-inline'), file);
    for (const script of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {assert(/\bsrc="[a-z0-9-]+\.js(?:\?v=[a-z0-9-]+)?"/.test(script[1]), file); assert.equal(script[2].trim(), '');}
    for (const src of html.matchAll(/\b(?:src|href)="([^"?#]+)(?:[?#][^"]*)?"/g)) {
      if (/^(?:[a-z]+:|#)/i.test(src[1])) continue;
      assert(fs.existsSync(path.join(root, src[1])), `${file}: ${src[1]}`);
    }
  }
});
