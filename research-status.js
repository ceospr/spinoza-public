/* Published aggregate research performance, with unavailable results preserved. */
(function () {
  'use strict';
  document.addEventListener('DOMContentLoaded', async () => {
    const body = document.getElementById('research_return_body'); if (!body) return;
    const status = document.getElementById('atlas_tracker_status');
    const text = (tag, value) => {const node = document.createElement(tag); node.textContent = value; return node;};
    try {
      const response = await fetch('data/atlas_pulse_tracker.json', {cache: 'no-store'}); if (!response.ok) throw Error();
      const payload = await response.json(); if (!PublicSchema.tracker(payload)) throw Error(); body.replaceChildren();
      status.textContent = payload.status === 'published' ? 'Published monthly research returns.' : 'Research returns are currently unavailable.';
      document.getElementById('atlas_tracker_updated').textContent = payload.updated_at_utc ? 'As of ' + new Date(payload.updated_at_utc).toLocaleString() : '';
      for (const row of payload.months) {const tr = document.createElement('tr'); tr.append(text('td', row.month), text('td', row.return_pct.toFixed(2) + '%')); body.appendChild(tr);}
      if (!payload.months.length) throw Error('no-results');
    } catch (_) {
      body.replaceChildren(); const tr = document.createElement('tr'), td = text('td', 'No aggregate research return is currently published.'); td.colSpan = 2; td.className = 'empty'; tr.appendChild(td); body.appendChild(tr);
      status.textContent = 'Research returns are currently unavailable.';
    }
  });
})();
