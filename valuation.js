/* Public company summaries and final estimates. Calculations stay in the publisher. */
const EquityValuation = (() => {
  'use strict';
  const schema = typeof module === 'object' && module.exports ? require('./public-schema.js') : globalThis.PublicSchema;
  const money = (value, currency) => typeof value === 'number' && Number.isFinite(value) ? new Intl.NumberFormat('en-US', {style: 'currency', currency, maximumFractionDigits: 2}).format(value) : 'Unavailable';
  const normalize = value => String(value || '').trim().toUpperCase();
  function filter(companies, query, sector = '', basis = '') {
    const q = normalize(query);
    return companies.filter(row => (!q || row.symbol.includes(q) || row.name.toUpperCase().includes(q)) && (!sector || row.sector === sector) && (!basis || (basis === 'unavailable' ? !row.intrinsic_available && !row.relative_available && !row.income_available : row[basis + '_available'])));
  }
  function validateReport(report, entry, expectedHash = null) {
    if (!schema.valuation(report) || report.symbol !== entry.symbol) throw Error('The published report does not match this company.');
    if (expectedHash !== null && expectedHash !== entry.sha256) throw Error('This research link refers to an earlier report. Open the current company report through Equity Valuation.');
    for (const kind of ['intrinsic', 'relative', 'income']) if ((report.estimates[kind].status === 'available') !== entry[kind + '_available']) throw Error('The report does not match the published availability status.');
    return report;
  }
  function formatFact(fact, currency) {
    if (typeof fact.value !== 'number' || !Number.isFinite(fact.value)) return 'Unavailable';
    if (fact.unit === 'ratio') return new Intl.NumberFormat('en-US', {style: 'percent', maximumFractionDigits: 1}).format(fact.value);
    if (fact.unit === 'money' || fact.unit === 'per_share') return money(fact.value, currency);
    return new Intl.NumberFormat('en-US', {maximumFractionDigits: 2}).format(fact.value);
  }
  function renderForwardAnalysis(report, doc) {
    if (report.schema_version !== 'spinoza.public-valuation.v2') return [];
    const model = report.analysis;
    const el = (tag, content, cls) => {const node = doc.createElement(tag); if (content !== undefined) node.textContent = content; if (cls) node.className = cls; return node;};
    const facts = rows => {
      const list = el('dl', undefined, 'ev-model-facts');
      for (const row of rows) {const item = el('div'); item.append(el('dt', row.label), el('dd', formatFact(row, report.currency))); if (row.source) item.append(el('small', row.source)); list.appendChild(item);}
      return list;
    };
    const section = (title, note) => {const node = el('section', undefined, 'ev-card'); node.append(el('h2', title)); if (note) node.append(el('p', note, 'ev-caption')); return node;};
    const scenarios = section('Bear, base and bull scenarios', 'Conditional values per share. These cases vary assumptions together; they are not probabilities or future price targets.');
    scenarios.append(el('p', `${model.model_name} · ${model.model_version}`, 'ev-caption'));
    const grid = el('div', undefined, 'ev-scenario-grid');
    for (const name of ['bear', 'base', 'bull']) {
      const row = model.scenarios.find(item => item.name === name), card = el('section', undefined, 'ev-scenario');
      card.append(el('h3', name[0].toUpperCase() + name.slice(1)), el('p', model.status === 'estimated' ? money(row.value, report.currency) : 'Unavailable', 'ev-scenario-value'));
      if (row.assumptions.length) {const detail = el('details'); detail.append(el('summary', 'Scenario assumptions'), facts(row.assumptions)); card.append(detail);}
      grid.append(card);
    }
    scenarios.append(grid);
    for (const reason of model.reasons) scenarios.append(el('p', reason, 'ev-gap-box'));
    const baseline = model.baseline;
    const period = baseline.period === 'ttm' ? 'Trailing twelve months (TTM)' : baseline.period === 'annual' ? 'Last fiscal year (annual; not current TTM)' : 'Financial period unavailable';
    const evidence = section(model.basis === 'reit_dividend_income' ? 'Dividend baseline and income assumptions' : 'Earnings baseline and forecast assumptions', `${period} · ${baseline.period_start || 'Start unavailable'} to ${baseline.period_end || 'End unavailable'}`);
    evidence.append(el('p', baseline.method, 'ev-caption'), facts(baseline.values));
    if (model.assumptions.length) evidence.append(el('h3', 'Base scenario assumptions'), facts(model.assumptions));
    if (model.warnings.length) {
      const details = el('details', undefined, 'ev-details'), list = el('ul', undefined, 'ev-small-list');
      details.append(el('summary', `${model.warnings.length} source and model notes`));
      for (const warning of model.warnings) list.append(el('li', warning));
      details.append(list); evidence.append(details);
    }
    const market = section('What would justify the recorded price?', `Price used: ${money(model.market_implied.recorded_price, report.currency)} · ${report.quote.date || 'Date unavailable'}. Each calculation changes the stated earnings or growth requirement; its description identifies what is held constant.`);
    market.append(facts(model.market_implied.requirements), el('p', model.market_implied.note, 'ev-caption'));
    return [scenarios, evidence, market];
  }
  return Object.freeze({money, normalize, filter, validateReport, formatFact, renderForwardAnalysis, secUrl: schema.secUrl});
})();
if (typeof module === 'object' && module.exports) module.exports = EquityValuation;

if (typeof document !== 'undefined') (async () => {
  'use strict';
  const E = EquityValuation, $ = id => document.getElementById(id);
  const el = (tag, content, cls) => {const node = document.createElement(tag); if (content !== undefined) node.textContent = content; if (cls) node.className = cls; return node;};
  const panel = $('report-panel'), params = new URLSearchParams(location.search);
  let index, selected, shown = 30, sequence = 0, controller;
  const cache = new Map();
  $('company-search').value = (params.get('q') || params.get('symbol') || '').slice(0, 100);
  $('year').textContent = String(new Date().getFullYear());

  function renderResults() {
    if (!index) return [];
    const rows = E.filter(index.companies, $('company-search').value, $('sector-filter').value, $('basis-filter').value);
    $('search-status').textContent = `${rows.length} ${rows.length === 1 ? 'company' : 'companies'} found`;
    const list = $('company-results'); list.replaceChildren();
    for (const row of rows.slice(0, shown)) {
      const li = el('li'), button = el('button', undefined, 'ev-company-button'); button.type = 'button'; button.setAttribute('aria-current', String(row.symbol === selected));
      button.append(el('span', row.symbol, 'ev-company-symbol'), el('span', row.name, 'ev-company-name'), el('span', row.intrinsic_available ? 'Intrinsic estimate available' : row.income_available ? 'Income scenario available' : row.relative_available ? 'Relative estimate available' : 'Estimate unavailable', 'ev-company-status'));
      button.addEventListener('click', () => selectCompany(row, true)); li.appendChild(button); list.appendChild(li);
    }
    $('more-results').hidden = rows.length <= shown;
    if (!rows.length) list.appendChild(el('li', 'No companies match these filters.', 'ev-caption'));
    return rows;
  }

  function renderReport(report) {
    const heading = el('section', undefined, 'ev-report-heading');
    const top = el('div', undefined, 'ev-symbol-line'); top.append(el('span', report.symbol, 'ev-symbol'), el('span', report.sector));
    heading.append(top, el('h2', report.name), el('p', report.industry, 'ev-caption'));
    if (report.recalculated_at_utc) heading.append(el('p', 'Recalculated with current model from archived inputs. Recorded price date: ' + (report.quote.date || 'unavailable') + '. Financial period ended: ' + (report.analysis.baseline.period_end || 'unavailable') + '.', 'ev-notice'));
    const values = el('dl', undefined, 'ev-kpis');
    function kpi(title, value, note) {const item = el('div', undefined, 'ev-kpi'); item.append(el('dt', title), el('dd', value), el('small', note)); values.appendChild(item);}
    kpi('Recorded closing price', E.money(report.quote.value, report.currency), `${report.currency} · ${report.quote.date || 'Date unavailable'} · not live`);
    kpi(report.analysis ? 'Base intrinsic estimate per share' : 'Intrinsic estimate per share', E.money(report.estimates.intrinsic.value, report.currency), report.analysis ? report.analysis.model_name : 'Conditional equity estimate · archived model');
    kpi('Relative estimate per share', E.money(report.estimates.relative.value, report.currency), 'A pricing comparison; separate from intrinsic value');
    if (report.estimates.income.status === 'available') kpi('Income scenario per share', E.money(report.estimates.income.value, report.currency), 'Separate from intrinsic equity value or property NAV');
    heading.appendChild(values);
    const actions = el('div', undefined, 'ev-actions');
    if (E.secUrl(report.sec_filings_url)) {const link = el('a', 'View SEC filings ↗', 'ev-action'); link.href = report.sec_filings_url; link.target = '_blank'; link.rel = 'noopener noreferrer'; actions.appendChild(link);}
    const print = el('button', 'Print report', 'ev-action'); print.type = 'button'; print.addEventListener('click', () => window.print()); actions.appendChild(print); heading.appendChild(actions);
    const conclusion = el('section', undefined, 'ev-card'); conclusion.append(el('h2', 'Reading this estimate'), el('p', report.summary, 'ev-caption'), el('p', 'Research as of ' + (report.as_of_utc ? new Date(report.as_of_utc).toLocaleString() : 'date unavailable'), 'ev-caption'));
    if (report.recalculated_at_utc) conclusion.append(el('p', 'Model recalculated ' + new Date(report.recalculated_at_utc).toLocaleString() + ' using archived inputs; quote date remains ' + (report.quote.date || 'unavailable') + '.', 'ev-caption'));
    panel.replaceChildren(heading, ...E.renderForwardAnalysis(report, document), conclusion);
  }

  async function selectCompany(entry, updateUrl) {
    selected = entry.symbol; const ticket = ++sequence;
    controller?.abort(); controller = new AbortController();
    renderResults(); panel.setAttribute('aria-busy', 'true'); panel.replaceChildren(el('div', 'Loading published company report…', 'ev-empty'));
    if (updateUrl) {const url = new URL(location.href); url.searchParams.set('q', entry.symbol); url.searchParams.delete('symbol'); url.searchParams.delete('report_sha256'); history.replaceState({}, '', url);}
    try {
      let report = cache.get(entry.symbol);
      if (!report) {
        const response = await fetch('data/' + entry.file, {signal: controller.signal, cache: 'no-cache'}); if (!response.ok) throw Error('The report could not be loaded.');
        const bytes = await response.arrayBuffer();
        if (!globalThis.crypto?.subtle) throw Error('A secure connection is required to verify this report.');
        const hash = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), byte => byte.toString(16).padStart(2, '0')).join('');
        if (hash !== entry.sha256) throw Error('This report does not match the current index. Reload to obtain the latest publication.');
        report = E.validateReport(JSON.parse(new TextDecoder('utf-8', {fatal: true}).decode(bytes)), entry); cache.set(entry.symbol, report);
      }
      if (ticket !== sequence) return;
      E.validateReport(report, entry, new URL(location.href).searchParams.get('report_sha256'));
      renderReport(report); document.title = `${entry.symbol} | Equity Valuation | Spinoza Research`;
    } catch (error) {
      if (ticket !== sequence || error.name === 'AbortError') return;
      const empty = el('div', undefined, 'ev-empty'); empty.append(el('h2', 'Report unavailable'), el('p', error.message, 'ev-caption'));
      const retry = el('button', 'Try again', 'ev-action'); retry.type = 'button'; retry.addEventListener('click', () => selectCompany(entry, false)); empty.appendChild(retry); panel.replaceChildren(empty);
    } finally {if (ticket === sequence) panel.setAttribute('aria-busy', 'false');}
  }
  $('search-form').addEventListener('submit', event => {event.preventDefault(); shown = 30; const rows = renderResults(); const exact = rows.find(row => E.normalize(row.symbol) === E.normalize($('company-search').value)); if (exact || rows.length === 1) selectCompany(exact || rows[0], true);});
  $('company-search').addEventListener('input', () => {shown = 30; renderResults();});
  for (const id of ['sector-filter', 'basis-filter']) $(id).addEventListener('change', () => {shown = 30; renderResults();});
  $('more-results').addEventListener('click', () => {shown += 30; renderResults();});
  try {
    const response = await fetch('data/valuation-index.json', {cache: 'no-cache'}); if (!response.ok) throw Error('The company index could not be loaded.');
    index = await response.json(); if (!PublicSchema.valuationIndex(index)) throw Error('The published company index is invalid.');
    $('release-summary').textContent = `${index.companies.length} companies · Published ${index.generated_at_utc ? new Date(index.generated_at_utc).toLocaleDateString() : 'date unavailable'}`;
    for (const sector of [...new Set(index.companies.map(row => row.sector))].filter(Boolean).sort()) {const option = el('option', sector); option.value = sector; $('sector-filter').appendChild(option);}
    const rows = renderResults(), query = $('company-search').value;
    const initial = rows.find(row => E.normalize(row.symbol) === E.normalize(query)) || (rows.length === 1 ? rows[0] : !query ? index.companies.find(row => row.symbol === 'AAPL') || index.companies[0] : null);
    if (initial) await selectCompany(initial, false); else panel.setAttribute('aria-busy', 'false');
  } catch (error) {$('release-summary').textContent = 'Published company data is temporarily unavailable.'; $('search-status').textContent = 'Please reload to try again.'; panel.replaceChildren(el('div', error.message, 'ev-empty')); panel.setAttribute('aria-busy', 'false');}
})();
