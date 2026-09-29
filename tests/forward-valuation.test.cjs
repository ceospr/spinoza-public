'use strict';
const {test} = require('node:test');
const assert = require('node:assert/strict');
const S = require('../public-schema.js');
const E = require('../valuation.js');
// test_forward_publication.py binds this shared fixture to the actual Python projector.
const report = require('./fixtures/forward-report.json');
class Node {
  constructor(tag) {this.tag = tag; this.children = []; this.textContent = '';}
  append(...nodes) {this.children.push(...nodes);}
  appendChild(node) {this.append(node);}
  get text() {return [this.textContent, ...this.children.map(node => node.text)].join(' ');}
}
const document = {createElement: tag => new Node(tag)};
test('actual Python projection validates and renders dates, named scenarios and implied requirements', () => {
  assert.equal(S.valuation(report), true);
  const rendered = E.renderForwardAnalysis(report, document).map(node => node.text).join(' ');
  for (const value of ['Bear', 'Base', 'Bull', '$80.00', '$120.00', '$180.00', 'Trailing twelve months', '2026-06-30', '$16.25', 'No solution', '12%', '10%']) assert.ok(rendered.includes(value), value);
  assert.match(rendered, /not forecasts and do not set the intrinsic estimate/);
});
test('closed schema rejects raw blobs, bogus dates, base mismatch, unknown versions', () => {
  for (const mutate of [r => r.analysis.raw_inputs = {}, r => r.analysis.baseline.period_end = '2026-02-30', r => r.analysis.scenarios[1].value = 121, r => r.schema_version = 'spinoza.public-valuation.v3', r => r.analysis.market_implied.requirements[0].provider = {}]) {
    const altered = structuredClone(report); mutate(altered); assert.equal(S.valuation(altered), false);
  }
});
test('legacy values validate without invented forward scenarios', () => {
  const old = structuredClone(report); old.schema_version = 'spinoza.public-valuation.v1'; delete old.analysis; delete old.recalculated_at_utc;
  assert.equal(S.valuation(old), true); assert.deepEqual(E.renderForwardAnalysis(old, document), []);
});
test('reviewed/unavailable and annual reports never masquerade as supported TTM scenarios', () => {
  const missing = structuredClone(report); missing.analysis.status = 'unavailable'; missing.estimates.intrinsic = {status: 'unavailable', value: null};
  missing.analysis.baseline.period = 'annual'; missing.analysis.reasons.push('Share-basis reconciliation required.');
  const rendered = E.renderForwardAnalysis(missing, document).map(node => node.text).join(' ');
  assert.match(rendered, /annual; not current TTM/); assert.match(rendered, /Share-basis reconciliation/); assert.doesNotMatch(rendered, /\$80\.00|\$120\.00|\$180\.00/);
  assert.equal(S.valuation(missing), true);
});
