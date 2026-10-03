'use strict';
const {test} = require('node:test');
const assert = require('node:assert/strict');
const S = require('../public-schema.js');
const E = require('../valuation.js');
const now = Date.parse('2026-10-03T01:00:00Z');
const indexHash = 'a'.repeat(64), reportHash = 'b'.repeat(64);
const report = {schema_version: 'spinoza.public-valuation.v1', symbol: 'TEST', name: 'Example', sector: 'Example', industry: '', currency: 'USD',
  as_of_utc: '2026-10-02T21:00:00Z', quote: {date: '2026-10-02', value: 100},
  estimates: {intrinsic: {status: 'unavailable', value: null}, relative: {status: 'available', value: 90}, income: {status: 'available', value: 70}},
  sec_filings_url: null, summary: 'Published test report.'};
const index = {schema_version: 'spinoza.public-valuation-index.v1', generated_at_utc: report.as_of_utc, companies: [
  {symbol: 'TEST', name: 'Example', sector: 'Example', industry: '', file: 'valuation-TEST.json', sha256: reportHash,
    intrinsic_available: false, relative_available: true, income_available: true}]};
const payload = {schema_version: 'spinoza.public-valuation-fallbacks.v1', model_version: 'atlas_average_intrinsic_gap_v1',
  valuation_basis: 'average_gap_fallback', currency: 'USD', generated_at_utc: '2026-10-03T00:00:00Z', benchmark_as_of_date: '2026-10-02',
  expires_at_utc: '2026-11-06T23:59:59Z', source_index_sha256: indexHash, benchmark_sha256: 'c'.repeat(64), donor_count: 100,
  companies: [{symbol: 'TEST', value: 59, recorded_price: 100, quote_date: '2026-10-02', as_of_utc: report.as_of_utc, report_sha256: reportHash}]};

test('fallback is a separate final value while intrinsic and other estimates remain intact', () => {
  assert.ok(S.valuationFallbacks(payload));
  const before = JSON.stringify(report), rows = E.fallbackRows(payload, index, indexHash, now);
  const fair = E.fairValue(report, rows, now);
  assert.equal(fair.value, 59);
  assert.equal(fair.title, 'Fair value per share — fallback');
  assert.match(fair.note, /Average-gap estimate.*2026-10-02/);
  assert.doesNotMatch(fair.note, /ratio|formula|multiply|\*|percent|mean_intrinsic/);
  assert.equal(JSON.stringify(report), before);
  assert.equal(report.estimates.intrinsic.value, null);
  assert.equal(report.estimates.income.value, 70);
  assert.equal(E.filter(index.companies, '', '', 'fair_value', rows, now).length, 1);
  assert.equal(E.filter(index.companies, '', '', 'fallback', rows, now).length, 1);
  assert.equal(E.filter(index.companies, '', '', 'intrinsic', rows, now).length, 0);
});

test('genuine intrinsic always wins and fallback cannot replace it through catalog binding', () => {
  const genuine = structuredClone(report); genuine.estimates.intrinsic = {status: 'available', value: 120};
  const rows = E.fallbackRows(payload, index, indexHash, now);
  assert.equal(E.fairValue(genuine, rows, now).value, 120);
  assert.equal(E.fairValue(genuine, rows, now).fallback, false);
  const changedIndex = structuredClone(index); changedIndex.companies[0].intrinsic_available = true;
  assert.equal(E.fallbackRows(payload, changedIndex, indexHash, now).size, 0);
});

test('wrong index, report identity, price, date, currency, and as-of cannot supply fallback', () => {
  assert.equal(E.fallbackRows(payload, index, 'd'.repeat(64), now).size, 0);
  const changed = structuredClone(payload); changed.companies[0].report_sha256 = 'e'.repeat(64);
  assert.equal(E.fallbackRows(changed, index, indexHash, now).size, 0);
  const rows = E.fallbackRows(payload, index, indexHash, now);
  for (const mutate of [r => r.symbol = 'OTHER', r => r.quote.value = 101, r => r.quote.date = '2026-10-01',
    r => r.currency = 'CAD', r => r.as_of_utc = '2026-10-02T22:00:00Z']) {
    const altered = structuredClone(report); mutate(altered);
    assert.equal(E.fairValue(altered, rows, now).value, null);
  }
});

test('missing, future, and expired companions fail closed with inclusive expiry', () => {
  assert.equal(E.fallbackRows(null, index, indexHash, now).size, 0);
  assert.equal(E.fallbackRows(payload, index, indexHash, Date.parse(payload.generated_at_utc) - 1).size, 0);
  const expiry = Date.parse(payload.expires_at_utc);
  const rows = E.fallbackRows(payload, index, indexHash, expiry);
  assert.equal(E.fairValue(report, rows, expiry).value, 59);
  assert.equal(E.fairValue(report, rows, expiry + 1).value, null);
  assert.equal(E.filter(index.companies, '', '', 'fallback', rows, expiry + 1).length, 0);
});

test('strict public companion rejects private fields, unsupported methods and extended validity', () => {
  for (const mutate of [v => v.mean_intrinsic_to_price = .59, v => v.donors = [], v => v.model_version = 'unknown',
    v => v.valuation_basis = 'intrinsic', v => v.donor_count = 99, v => v.expires_at_utc = '2026-11-07T23:59:59Z',
    v => v.companies.push({...v.companies[0]}), v => v.companies[0].value = -1,
    v => v.companies[0].recorded_price = NaN, v => v.companies[0].quote_date = '2026-10-01',
    v => v.companies[0].as_of_utc = '2026-10-04T00:00:00Z', v => v.companies[0].source_path = 'private']) {
    const altered = structuredClone(payload); mutate(altered); assert.equal(S.valuationFallbacks(altered), false);
  }
});
