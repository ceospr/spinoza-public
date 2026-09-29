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
    const rootKeys = ["schema_version", "updated_at_utc", "performance", "monthly_performance", "performance_history"];
    const v2 = value?.schema_version === "spinoza.public-dashboard.v2";
    if (!keys(value, v2 ? [...rootKeys, "trade_history", "open_positions"] : rootKeys) ||
        !["spinoza.public-dashboard.v1", "spinoza.public-dashboard.v2"].includes(value.schema_version) || !timestamp(value.updated_at_utc) ||
        !list(value.monthly_performance, row => period(row, "month", month)) || !unique(value.monthly_performance, "month") ||
        !list(value.performance_history, row => period(row, "date", day)) || !unique(value.performance_history, "date")) return false;
    if (!v2) return keys(value.performance, [], metrics) && Object.values(value.performance).every(numeric);
    const countKeys = ["closed_trades_count", "winning_trades_count", "losing_trades_count", "breakeven_trades_count", "open_positions_count"];
    const performance = value.performance;
    const rounded = (value, digits) => finite(value) && value === Number(value.toFixed(digits));
    if (!keys(performance, [...metrics, "profit_factor", ...countKeys]) || !Object.values(performance).every(numeric) ||
        [...metrics, "profit_factor"].some(key => performance[key] !== null && !rounded(performance[key], 2)) ||
        countKeys.some(key => performance[key] !== null && (!Number.isSafeInteger(performance[key]) || performance[key] < 0)) ||
        (performance.max_drawdown_pct !== null && performance.max_drawdown_pct < 0) ||
        (performance.win_rate_pct !== null && (performance.win_rate_pct < 0 || performance.win_rate_pct > 100)) ||
        (performance.profit_factor !== null && performance.profit_factor < 0)) return false;
    const outcomes = [performance.winning_trades_count, performance.losing_trades_count, performance.breakeven_trades_count];
    const knownOutcomes = outcomes.filter(finite).reduce((sum, count) => sum + count, 0);
    if (performance.closed_trades_count !== null && (knownOutcomes > performance.closed_trades_count ||
        (outcomes.every(finite) && knownOutcomes !== performance.closed_trades_count))) return false;
    const positive = value => rounded(value, 4) && value > 0;
    const returnValue = value => value === null || rounded(value, 2);
    const direction = value => ["LONG", "SHORT"].includes(value);
    return value.monthly_performance.every(row => rounded(row.return_pct, 2)) && value.performance_history.every(row => rounded(row.return_pct, 2)) &&
      Array.isArray(value.trade_history) && value.trade_history.length <= 2000 &&
      (performance.closed_trades_count === null || performance.closed_trades_count >= value.trade_history.length) && value.trade_history.every(row =>
      keys(row, ["symbol", "direction", "entry_date", "exit_date", "entry_price", "exit_price", "realized_return_pct"]) &&
      symbol(row.symbol) && direction(row.direction) && day(row.entry_date) && day(row.exit_date) && row.entry_date <= row.exit_date &&
      positive(row.entry_price) && positive(row.exit_price) && returnValue(row.realized_return_pct)) &&
      Array.isArray(value.open_positions) && value.open_positions.length <= 1000 &&
      (performance.open_positions_count === null || performance.open_positions_count >= value.open_positions.length) && value.open_positions.every(row =>
        keys(row, ["symbol", "direction", "average_entry_price", "latest_price", "unrealized_return_pct"]) &&
        symbol(row.symbol) && direction(row.direction) && positive(row.average_entry_price) && positive(row.latest_price) && returnValue(row.unrealized_return_pct));
  }
  function estimate(value) {
    return keys(value, ["status", "value"]) && ((value.status === "available" && finite(value.value)) || (value.status === "unavailable" && value.value === null));
  }
  const fact = value => keys(value, ["label", "value", "unit", "source"]) && text(value.label) && numeric(value.value) && ["ratio", "per_share", "money", "number"].includes(value.unit) && text(value.source);
  function forwardAnalysis(value) {
    return keys(value, ["model_version", "model_name", "basis", "status", "policy_sha256", "baseline", "assumptions", "scenarios", "market_implied", "reasons", "warnings"]) && value.model_version === "forward_intrinsic_v2" && text(value.model_name) && ["forward_operating_dcf", "forward_equity_distribution", "forward_financial_equity", "reit_dividend_income"].includes(value.basis) && ["estimated", "unavailable"].includes(value.status) && hash(value.policy_sha256) &&
      keys(value.baseline, ["period", "period_start", "period_end", "method", "values"]) && ["annual", "ttm", "unavailable"].includes(value.baseline.period) && [value.baseline.period_start, value.baseline.period_end].every(item => item === null || day(item)) && text(value.baseline.method) && list(value.baseline.values, fact) && list(value.assumptions, fact) &&
      list(value.scenarios, row => keys(row, ["name", "value", "assumptions"]) && ["bear", "base", "bull"].includes(row.name) && numeric(row.value) && list(row.assumptions, fact)) && unique(value.scenarios, "name") && value.scenarios.length === 3 &&
      keys(value.market_implied, ["recorded_price", "requirements", "note"]) && numeric(value.market_implied.recorded_price) && list(value.market_implied.requirements, fact) && text(value.market_implied.note) && list(value.reasons, text) && list(value.warnings, text);
  }
  function valuation(value) {
    const v2 = value?.schema_version === "spinoza.public-valuation.v2";
    const fields = ["schema_version", "symbol", "name", "sector", "industry", "currency", "as_of_utc", "quote", "estimates", "sec_filings_url", "summary"];
    if (v2) fields.push("analysis", "recalculated_at_utc");
    return keys(value, fields) && (v2 || value.schema_version === "spinoza.public-valuation.v1") && symbol(value.symbol) && currency(value.currency) &&
      [value.name, value.sector, value.industry, value.summary].every(text) && timestamp(value.as_of_utc) &&
      keys(value.quote, ["date", "value"]) && (value.quote.date === null || day(value.quote.date)) && numeric(value.quote.value) &&
      keys(value.estimates, ["intrinsic", "relative", "income"]) && Object.values(value.estimates).every(estimate) &&
      (value.sec_filings_url === null || secUrl(value.sec_filings_url)) && (!v2 || (timestamp(value.recalculated_at_utc) && forwardAnalysis(value.analysis) && (value.analysis.status !== "unavailable" || (value.estimates.intrinsic.status === "unavailable" && value.estimates.income.status === "unavailable")) &&
      (value.estimates.intrinsic.status !== "available" || (value.analysis.basis !== "reit_dividend_income" && value.analysis.scenarios.find(row => row.name === "base").value === value.estimates.intrinsic.value)) &&
      (value.estimates.income.status !== "available" || (value.analysis.basis === "reit_dividend_income" && value.analysis.scenarios.find(row => row.name === "base").value === value.estimates.income.value))));
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
