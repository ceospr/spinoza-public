/* Archived selections resolve values through verified canonical company reports. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else {root.ResearchCandidates = api; document.addEventListener('DOMContentLoaded', () => api.refresh());}
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const schema = typeof module === 'object' && module.exports ? require('./public-schema.js') : globalThis.PublicSchema;
  const money = (value, currency) => typeof value === 'number' && Number.isFinite(value) ? new Intl.NumberFormat('en-US', {style: 'currency', currency, maximumFractionDigits: 2}).format(value) : 'Unavailable';
  const monthName = value => new Intl.DateTimeFormat('en-US', {month: 'long', year: 'numeric', timeZone: 'UTC'}).format(new Date(value + '-01T00:00:00Z'));
  async function resolveReports(payload, {fetchImpl = globalThis.fetch, cryptoImpl = globalThis.crypto} = {}) {
    const selected = [...payload.longs, ...payload.shorts], resolved = new Map();
    let index;
    try {
      if (!cryptoImpl?.subtle) throw Error('A secure connection is required to verify company reports.');
      const response = await fetchImpl('data/valuation-index.json', {cache: 'no-store'});
      if (!response.ok) throw Error('The current company index could not be loaded.');
      index = await response.json();
      if (!schema.valuationIndex(index)) throw Error('The current company index could not be verified.');
    } catch (_) {
      for (const row of selected) resolved.set(row.symbol, {error: 'Current company report could not be verified.'});
      return resolved;
    }
    await Promise.all(selected.map(async row => {
      try {
        const entry = index.companies.find(item => item.symbol === row.symbol);
        if (!entry) throw Error();
        const response = await fetchImpl('data/' + entry.file, {cache: 'no-store'});
        if (!response.ok) throw Error();
        const bytes = await response.arrayBuffer();
        const hash = Array.from(new Uint8Array(await cryptoImpl.subtle.digest('SHA-256', bytes)), byte => byte.toString(16).padStart(2, '0')).join('');
        if (hash !== entry.sha256) throw Error();
        const report = JSON.parse(new TextDecoder('utf-8', {fatal: true}).decode(bytes));
        if (!schema.valuation(report) || report.symbol !== row.symbol) throw Error();
        for (const kind of ['intrinsic', 'relative', 'income']) if ((report.estimates[kind].status === 'available') !== entry[kind + '_available']) throw Error();
        resolved.set(row.symbol, {report, report_sha256: hash, selection_report_changed: hash !== row.report_sha256});
      } catch (_) {resolved.set(row.symbol, {error: 'Current company report could not be verified.'});}
    }));
    return resolved;
  }
  function render(payload, document = globalThis.document, now = new Date(), reports = new Map()) {
    payload = schema.research(payload) ? payload : null;
    const text = (id, value) => {const node = document.getElementById(id); if (node) node.textContent = value;};
    const el = (tag, value, cls) => {const node = document.createElement(tag); if (value !== undefined) node.textContent = value; if (cls) node.className = cls; return node;};
    const available = payload?.status === 'published' && Date.parse(payload.published_at_utc) <= now.getTime();
    const archived = available && now.getTime() >= Date.parse(payload.valid_until_utc);
    const methods = new Set(available ? [...payload.longs, ...payload.shorts].map(row => row.month_end_forecast?.methodology).filter(Boolean) : []);
    const sharedMethod = methods.size === 1 ? [...methods][0] : '';
    text('research_candidates_projection_methodology', sharedMethod ? 'Atlas Pulse projection: ' + sharedMethod : '');
    text('research_candidates_status', !available ? 'Research publication unavailable' : archived ? 'Archived selection' : 'Published research');
    text('research_candidates_date', available ? `Selection published ${payload.published_at_utc.slice(0, 10)} · Qualification ${archived ? 'expired' : 'valid until'} ${new Date(payload.valid_until_utc).toLocaleString()}. Values come from current published company reports; updating a value does not requalify this selection.` : 'A new research publication will appear here when available.');
    for (const side of ['long', 'short']) {
      const rows = available ? [...payload[side + 's']].sort((a, b) => a.symbol.localeCompare(b.symbol)) : [];
      text('research_candidates_' + side + '_count', rows.length ? rows.length + ' shown' : '');
      const body = document.getElementById('research_candidates_' + side + '_body'); if (!body) continue; body.replaceChildren();
      for (const row of rows) {
        const canonical = reports.get(row.symbol), report = canonical?.report;
        const tr = el('tr'), company = el('td'), link = el('a', row.symbol, 'atlas-ticker');
        link.href = 'valuation.html?q=' + encodeURIComponent(row.symbol) + (report ? '&report_sha256=' + canonical.report_sha256 : '');
        company.append(link, el('span', report?.name || row.name, 'candidate-company'), el('small', report?.sector || row.sector, 'atlas-sector'));
        const price = el('td', money(report?.quote.value, report?.currency));
        if (report) price.appendChild(el('small', report.currency + ' · ' + (report.quote.date || 'Date unavailable'), 'candidate-observation'));
        const estimate = el('td', money(report?.estimates.intrinsic.value, report?.currency));
        if (report) {
          const date = report.recalculated_at_utc || report.as_of_utc;
          estimate.appendChild(el('small', (report.analysis?.model_version === 'forward_intrinsic_v2' ? 'Model v2' : 'Published estimate') + (date ? ' · ' + (report.recalculated_at_utc ? 'recalculated ' : 'research ') + date.slice(0, 10) : ''), 'candidate-valuation-note'));
          if (canonical.selection_report_changed) estimate.appendChild(el('small', 'Selection not reassessed', 'candidate-valuation-note'));
        } else estimate.appendChild(el('small', canonical?.error || 'Current company report unavailable.', 'candidate-valuation-note'));
        const forecast = row.month_end_forecast;
        const forecastVisible = Boolean(report) && forecast?.status === 'available' && Date.parse(forecast.as_of_utc) <= now.getTime();
        const projection = el('td', money(forecastVisible ? forecast.value : null, row.currency));
        if (forecast) {
          const label = forecast.kind === 'model_forecast' ? 'Atlas Pulse forecast' : 'Atlas Pulse conditional projection';
          projection.appendChild(el('small', monthName(forecast.month) + (forecast.target_date ? ' · target ' + forecast.target_date : ' month end'), 'candidate-valuation-note'));
          projection.appendChild(el('small', label, 'candidate-valuation-note'));
          projection.appendChild(el('small', 'As of ' + forecast.as_of_utc.slice(0, 10), 'candidate-valuation-note'));
          if (forecast.methodology && !sharedMethod) projection.appendChild(el('small', forecast.methodology, 'candidate-valuation-note'));
          if (report && (row.price !== report.quote.value || row.price_date !== report.quote.date)) projection.appendChild(el('small', 'Projection baseline ' + money(row.price, row.currency) + ' · ' + row.price_date, 'candidate-valuation-note'));
          if (canonical?.selection_report_changed) projection.appendChild(el('small', 'Projection retains the selection report assumptions.', 'candidate-valuation-note'));
          if (!report) projection.appendChild(el('small', 'Current company report could not be verified.', 'candidate-valuation-note'));
        } else projection.appendChild(el('small', 'No month-end projection published.', 'candidate-valuation-note'));
        tr.append(company, price, estimate, projection); body.appendChild(tr);
      }
      if (!rows.length) {const tr = el('tr'), td = el('td', 'No published candidates at this research date.', 'empty'); td.colSpan = 4; tr.appendChild(td); body.appendChild(tr);}
    }
  }
  let sequence = 0;
  async function refresh({fetchImpl = globalThis.fetch, document = globalThis.document, now = new Date()} = {}) {
    const ticket = ++sequence;
    let payload = null, reports = new Map();
    try {const response = await fetchImpl('data/research-candidates.json', {cache: 'no-store'}); if (!response.ok) throw Error(); const value = await response.json(); if (!schema.research(value)) throw Error(); payload = value;
      if (payload.status === 'published' && Date.parse(payload.published_at_utc) <= now.getTime()) reports = await resolveReports(payload, {fetchImpl});
    } catch (_) {}
    if (ticket === sequence) render(payload, document, now, reports);
    return payload;
  }
  return Object.freeze({render, refresh, resolveReports});
});
