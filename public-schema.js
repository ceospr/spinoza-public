/* Display-only publication contracts. Unknown properties fail closed. */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.PublicSchema = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";
  const object = value => value !== null && typeof value === "object" && !Array.isArray(value);
  const finite = value => typeof value === "number" && Number.isFinite(value);
  const numeric = value => value === null || finite(value);
  const text = value => typeof value === "string" && value.length <= 1000;
  const symbol = value => typeof value === "string" && /^[A-Z0-9][A-Z0-9.-]{0,14}$/.test(value);
  const currency = value => typeof value === "string" && /^[A-Z]{3}$/.test(value);
  const hash = value => typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
  const day = value => typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
  const month = value => typeof value === "string" && /^\d{4}-(0[1-9]|1[0-2])$/.test(value);
  const timestamp = value => value === null || (typeof value === "string" && /^\d{4}-\d{2}-\d{2}T[\d:.]+Z$/.test(value) && Number.isFinite(Date.parse(value)));
  function keys(value, required, optional = []) {
    return object(value) && required.every(key => Object.hasOwn(value, key)) && Object.keys(value).every(key => required.includes(key) || optional.includes(key));
  }
  const list = (value, test) => Array.isArray(value) && value.length <= 10000 && value.every(test);
  const unique = (rows, key) => new Set(rows.map(row => row[key])).size === rows.length;
  function secUrl(value) {
    if (typeof value !== "string") return false;
    try {
      const url = new URL(value);
      return url.protocol === "https:" && url.hostname === "www.sec.gov" && !url.username && !url.password && !url.port && url.pathname === "/edgar/browse/" && /^\d{1,10}$/.test(url.searchParams.get("CIK") || "");
    } catch (_) { return false; }
  }
  const period = (row, key, test) => keys(row, [key, "return_pct"]) && test(row[key]) && finite(row.return_pct);
  function dashboard(value) {
    const metrics = ["since_inception_return_pct", "ytd_return_pct", "daily_return_pct", "max_drawdown_pct", "win_rate_pct"];
    return keys(value, ["schema_version", "updated_at_utc", "performance", "monthly_performance", "performance_history"]) && value.schema_version === "spinoza.public-dashboard.v1" && timestamp(value.updated_at_utc) &&
      keys(value.performance, [], metrics) && Object.values(value.performance).every(numeric) &&
      list(value.monthly_performance, row => period(row, "month", month)) && unique(value.monthly_performance, "month") &&
      list(value.performance_history, row => period(row, "date", day)) && unique(value.performance_history, "date");
  }
  function estimate(value) {
    return keys(value, ["status", "value"]) && ((value.status === "available" && finite(value.value)) || (value.status === "unavailable" && value.value === null));
  }
  function valuation(value) {
    return keys(value, ["schema_version", "symbol", "name", "sector", "industry", "currency", "as_of_utc", "quote", "estimates", "sec_filings_url", "summary"]) && value.schema_version === "spinoza.public-valuation.v1" && symbol(value.symbol) && currency(value.currency) &&
      [value.name, value.sector, value.industry, value.summary].every(text) && timestamp(value.as_of_utc) &&
      keys(value.quote, ["date", "value"]) && (value.quote.date === null || day(value.quote.date)) && numeric(value.quote.value) &&
      keys(value.estimates, ["intrinsic", "relative", "income"]) && Object.values(value.estimates).every(estimate) &&
      (value.sec_filings_url === null || secUrl(value.sec_filings_url));
  }
  function valuationIndex(value) {
    return keys(value, ["schema_version", "generated_at_utc", "companies"]) && value.schema_version === "spinoza.public-valuation-index.v1" && timestamp(value.generated_at_utc) &&
      list(value.companies, row => keys(row, ["symbol", "name", "sector", "industry", "file", "sha256", "intrinsic_available", "relative_available", "income_available"]) && symbol(row.symbol) && [row.name, row.sector, row.industry].every(text) && row.file === `valuation-${row.symbol}.json` && hash(row.sha256) && [row.intrinsic_available, row.relative_available, row.income_available].every(item => typeof item === "boolean")) && unique(value.companies, "symbol");
  }
  function candidate(value) {
    return keys(value, ["symbol", "name", "sector", "currency", "price", "price_date", "intrinsic_estimate", "report_sha256"]) && symbol(value.symbol) && currency(value.currency) && text(value.name) && text(value.sector) && finite(value.price) && value.price > 0 && day(value.price_date) && finite(value.intrinsic_estimate) && hash(value.report_sha256);
  }
  function research(value) {
    return keys(value, ["schema_version", "research_only", "published_at_utc", "valid_until_utc", "status", "longs", "shorts"]) && value.schema_version === "spinoza.public-research.v1" && value.research_only === true && timestamp(value.published_at_utc) && timestamp(value.valid_until_utc) && ["published", "unavailable"].includes(value.status) && list(value.longs, candidate) && list(value.shorts, candidate) && unique([...value.longs, ...value.shorts], "symbol") &&
      (value.status !== "published" || (value.published_at_utc !== null && value.valid_until_utc !== null && Date.parse(value.valid_until_utc) >= Date.parse(value.published_at_utc) && value.longs.length + value.shorts.length > 0));
  }
  function tracker(value) {
    return keys(value, ["schema_version", "updated_at_utc", "status", "months"]) && value.schema_version === "spinoza.public-research-performance.v1" && timestamp(value.updated_at_utc) && ["published", "unavailable"].includes(value.status) && list(value.months, row => period(row, "month", month)) && unique(value.months, "month");
  }
  return Object.freeze({dashboard, valuation, valuationIndex, research, tracker, secUrl});
});
