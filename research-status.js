/* Published aggregate research performance with its measurement period. */
(function (root, factory) {
  const api = factory(typeof module === 'object' && module.exports ? require('./public-schema.js') : root.PublicSchema);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else {root.ResearchReturns = api; document.addEventListener('DOMContentLoaded', () => api.refresh());}
})(typeof globalThis !== 'undefined' ? globalThis : this, function (schema) {
  'use strict';
  function render(candidate, document = globalThis.document) {
    const payload = schema.tracker(candidate) ? candidate : null;
    const body = document.getElementById('research_return_body'); if (!body) return payload;
    const setText = (id, value) => {const node = document.getElementById(id); if (node) node.textContent = value;};
    const el = (tag, value, cls) => {const node = document.createElement(tag); node.textContent = value; if (cls) node.className = cls; return node;};
    const rows = payload?.status === 'published' ? [...payload.months].sort((a, b) => b.month.localeCompare(a.month)) : [];
    body.replaceChildren();
    setText('atlas_tracker_status', rows.length ? 'Published monthly research reference returns.' : 'Research returns are currently unavailable.');
    setText('atlas_tracker_updated', payload?.updated_at_utc ? 'As of ' + new Intl.DateTimeFormat('en-US', {dateStyle: 'medium', timeStyle: 'short', timeZone: 'America/Los_Angeles'}).format(new Date(payload.updated_at_utc)) + ' Pacific' : '');
    for (const row of rows) {
      const tr = document.createElement('tr');
      const month = el('td', new Intl.DateTimeFormat('en-US', {month: 'long', year: 'numeric', timeZone: 'UTC'}).format(new Date(row.month + '-01T00:00:00Z')));
      if (row.start_date && row.end_date) month.appendChild(el('small', row.start_date + ' to ' + row.end_date, 'candidate-valuation-note'));
      if (row.status === 'month_to_date') month.appendChild(el('small', 'Month to date', 'candidate-valuation-note'));
      const result = el('td', (row.return_pct > 0 ? '+' : '') + row.return_pct.toFixed(2) + '%');
      tr.append(month, result); body.appendChild(tr);
    }
    if (!rows.length) {const tr = document.createElement('tr'), td = el('td', 'No aggregate research return is currently published.', 'empty'); td.colSpan = 2; tr.appendChild(td); body.appendChild(tr);}
    return payload;
  }
  async function refresh({fetchImpl = globalThis.fetch, document = globalThis.document} = {}) {
    let payload = null;
    try {const response = await fetchImpl('data/atlas_pulse_tracker.json', {cache: 'no-store'}); if (!response.ok) throw Error(); const value = await response.json(); if (!schema.tracker(value)) throw Error(); payload = value;} catch (_) {}
    render(payload, document); return payload;
  }
  return Object.freeze({render, refresh});
});
