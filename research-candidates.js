/* Display approved research conclusions; no selection or valuation calculations. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else {root.ResearchCandidates = api; document.addEventListener('DOMContentLoaded', () => api.refresh());}
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const money = (value, currency) => new Intl.NumberFormat('en-US', {style: 'currency', currency, maximumFractionDigits: 2}).format(value);
  function render(payload, document = globalThis.document, now = new Date()) {
    const text = (id, value) => {const node = document.getElementById(id); if (node) node.textContent = value;};
    const el = (tag, value, cls) => {const node = document.createElement(tag); if (value !== undefined) node.textContent = value; if (cls) node.className = cls; return node;};
    const available = payload?.status === 'published' && Date.parse(payload.published_at_utc) <= now.getTime();
    const archived = available && now.getTime() >= Date.parse(payload.valid_until_utc);
    text('research_candidates_status', !available ? 'Research publication unavailable' : archived ? 'Archived research' : 'Published research');
    text('research_candidates_date', available ? `Published ${payload.published_at_utc.slice(0, 10)} · Valid until ${new Date(payload.valid_until_utc).toLocaleString()}` : 'A new research publication will appear here when available.');
    for (const side of ['long', 'short']) {
      const rows = available ? [...payload[side + 's']].sort((a, b) => a.symbol.localeCompare(b.symbol)) : [];
      text('research_candidates_' + side + '_count', rows.length ? rows.length + ' shown' : '');
      const body = document.getElementById('research_candidates_' + side + '_body'); if (!body) continue; body.replaceChildren();
      for (const row of rows) {
        const tr = el('tr'), company = el('td'), link = el('a', row.symbol, 'atlas-ticker');
        link.href = 'valuation.html?q=' + encodeURIComponent(row.symbol) + '&report_sha256=' + row.report_sha256;
        company.append(link, el('span', row.name, 'candidate-company'), el('small', row.sector, 'atlas-sector'));
        const price = el('td', money(row.price, row.currency)); price.appendChild(el('small', row.currency + ' · ' + row.price_date, 'candidate-observation'));
        tr.append(company, price, el('td', money(row.intrinsic_estimate, row.currency))); body.appendChild(tr);
      }
      if (!rows.length) {const tr = el('tr'), td = el('td', 'No published candidates at this research date.', 'empty'); td.colSpan = 3; tr.appendChild(td); body.appendChild(tr);}
    }
  }
  let sequence = 0;
  async function refresh({fetchImpl = globalThis.fetch, document = globalThis.document, now = new Date()} = {}) {
    const ticket = ++sequence;
    let payload = null;
    try {const response = await fetchImpl('data/research-candidates.json', {cache: 'no-store'}); if (!response.ok) throw Error(); const value = await response.json(); if (!globalThis.PublicSchema.research(value)) throw Error(); payload = value;} catch (_) {}
    if (ticket === sequence) render(payload, document, now);
    return payload;
  }
  return Object.freeze({render, refresh});
});
