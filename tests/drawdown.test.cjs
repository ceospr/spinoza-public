const test = require('node:test');
const assert = require('node:assert/strict');
const dashboard = require('../dashboard.js');
const schema = require('../public-schema.js');
const sample = require('../data/public_dashboard.json');

function documentMock() {
  const nodes = new Map();
  const node = () => ({textContent: '', children: [], appendChild(item) {this.children.push(item);}, replaceChildren() {this.children = [];}});
  return {createElement: node, getElementById(id) {if (!nodes.has(id)) nodes.set(id, node()); return nodes.get(id);}};
}

test('dated current drawdown is separate from maximum and refreshes without cache', async () => {
  const payload = {...sample, current_drawdown_at_utc: '2026-11-12T21:00:00Z',
    performance: {...sample.performance, current_drawdown_pct: 1.78, max_drawdown_pct: 6.98}};
  assert(schema.dashboard(payload));
  const document = documentMock();
  dashboard.render({...payload, performance: {...payload.performance, current_drawdown_pct: 4.14}}, document);
  await dashboard.refresh({document, refreshResearch: false, fetchImpl: async (_url, options) => {
    assert.equal(options.cache, 'no-store');
    return {ok: true, json: async () => payload};
  }});
  assert.equal(document.getElementById('max_drawdown_pct').textContent, '6.98%');
  assert.match(document.getElementById('current_drawdown').textContent, /1\.78%.*Nov 12, 2026/);
  assert(schema.dashboard(sample));
  assert(!schema.dashboard({...payload, private_balance: 7383.63}));
});
