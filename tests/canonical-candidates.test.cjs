'use strict';
const {test} = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const C = require('../research-candidates.js');
const S = require('../public-schema.js');
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
const documentMock = () => {const nodes = new Map(); return {createElement: tag => new Element(tag), getElementById: id => {if (!nodes.has(id)) nodes.set(id, new Element('div')); return nodes.get(id);}, nodes};};
function fixture() {
  const report = structuredClone(source), bytes = Buffer.from(JSON.stringify(report));
  const hash = crypto.createHash('sha256').update(bytes).digest('hex');
  const entry = {symbol: report.symbol, name: report.name, sector: report.sector, industry: report.industry, file: `valuation-${report.symbol}.json`, sha256: hash, intrinsic_available: true, relative_available: false, income_available: false};
  const index = {schema_version: 'spinoza.public-valuation-index.v1', generated_at_utc: '2026-09-28T12:00:00Z', companies: [entry]};
  const selected = {symbol: report.symbol, name: 'Original selection name', sector: report.sector, currency: 'USD', price: 999, price_date: '2026-09-03', intrinsic_estimate: 777, report_sha256: 'a'.repeat(64)};
  const payload = {schema_version: 'spinoza.public-research.v1', research_only: true, published_at_utc: '2026-09-08T12:00:00Z', valid_until_utc: '2026-09-09T00:00:00Z', status: 'published', longs: [selected], shorts: []};
  const fetchImpl = async url => url === 'data/research-candidates.json' ? {ok: true, json: async () => payload} : url === 'data/valuation-index.json' ? {ok: true, json: async () => index} : {ok: true, arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)};
  return {report, bytes, hash, entry, index, selected, payload, fetchImpl};
}

test('candidate values and links use canonical report; original selection remains explicitly archived', async () => {
  const f = fixture(), before = structuredClone(f.payload);
  assert(S.research(f.payload)); assert(S.valuation(f.report));
  const reports = await C.resolveReports(f.payload, {fetchImpl: f.fetchImpl, cryptoImpl: crypto.webcrypto});
  const document = documentMock(); C.render(f.payload, document, new Date('2026-09-29T00:00:00Z'), reports);
  const body = document.getElementById('research_candidates_long_body');
  assert.match(body.textContent, /\$120\.00/); assert.match(body.textContent, /\$150\.00/);
  assert.doesNotMatch(body.textContent, /\$777\.00|\$999\.00|2026-09-03/);
  assert.match(body.textContent, /2026-09-04|2026-09-28/);
  assert.match(body.textContent, /Model v2|Selection not reassessed/);
  assert.equal(body.children[0].children[0].children[0].href, `valuation.html?q=TEST&report_sha256=${f.hash}`);
  assert.equal(document.getElementById('research_candidates_status').textContent, 'Archived selection');
  assert.match(document.getElementById('research_candidates_date').textContent, /Selection published 2026-09-08/);
  assert.match(document.getElementById('research_candidates_date').textContent, /does not requalify/);
  assert.deepEqual(f.payload, before);
});

test('tampered canonical bytes never fall back to stale candidate price or estimate', async () => {
  const f = fixture(); f.entry.sha256 = '0'.repeat(64);
  const reports = await C.resolveReports(f.payload, {fetchImpl: f.fetchImpl, cryptoImpl: crypto.webcrypto});
  const document = documentMock(); C.render(f.payload, document, new Date('2026-09-29T00:00:00Z'), reports);
  const body = document.getElementById('research_candidates_long_body');
  assert.match(body.textContent, /Unavailable/); assert.match(body.textContent, /could not be verified/);
  assert.doesNotMatch(body.textContent, /\$120\.00|\$150\.00|\$777\.00|\$999\.00/);
  assert.equal(body.children[0].children[0].children[0].href, 'valuation.html?q=TEST');
});

test('index failure and absent secure hashing withhold canonical values', async () => {
  const f = fixture();
  for (const options of [{fetchImpl: async () => ({ok: false}), cryptoImpl: crypto.webcrypto}, {fetchImpl: f.fetchImpl, cryptoImpl: {}}]) {
    const reports = await C.resolveReports(f.payload, options);
    assert.equal(reports.get('TEST').report, undefined);
  }
});

test('actual refresh hydrates canonical reports and safe text, including unavailable intrinsic', async () => {
  const f = fixture(); f.report.name = '<img src=x onerror=alert(1)>';
  f.report.estimates.intrinsic = {status: 'unavailable', value: null}; f.report.analysis.status = 'unavailable';
  f.entry.intrinsic_available = false;
  const bytes = Buffer.from(JSON.stringify(f.report)); f.entry.sha256 = crypto.createHash('sha256').update(bytes).digest('hex');
  const fetchImpl = async url => url.startsWith('data/valuation-TEST') ? {ok: true, arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)} : f.fetchImpl(url);
  const document = documentMock(); await C.refresh({fetchImpl, document, now: new Date('2026-09-29T00:00:00Z')});
  const body = document.getElementById('research_candidates_long_body');
  assert.match(body.textContent, /<img/); assert.match(body.textContent, /Unavailable/); assert.match(body.textContent, /\$150\.00/);
  const tags = node => [node.tagName, ...node.children.flatMap(tags)]; assert(!tags(body).includes('img'));
});
