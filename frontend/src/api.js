const API_BASE = ' https://mplads-sentinel-final.onrender.com/api';

async function fetchJSON(path, options = {}) {
  const res = await fetch(`${API_BASE}${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
  if (!res.ok) {
    const err = await res.text().catch(() => res.statusText);
    throw new Error(`API ${res.status}: ${err}`);
  }
  return res.json();
}

/** National statistics and summary metrics */
export function fetchStats() {
  return fetchJSON('/stats');
}

/** Scored risk register with optional filters */
export function fetchScore({ minScore = 0, tier, state, limit = 5000 } = {}) {
  const params = new URLSearchParams();
  if (minScore > 0) params.set('min_score', minScore);
  if (tier) params.set('tier', tier);
  if (state) params.set('state', state);
  if (limit) params.set('limit', limit);
  return fetchJSON(`/score?${params}`);
}

/** AI-generated executive briefing for a single work */
export function fetchBriefing(workId) {
  return fetchJSON(`/explain/${encodeURIComponent(workId)}`);
}

/** MP portfolio drill-down */
export function fetchMPPortfolio(mpId) {
  return fetchJSON(`/mp/${encodeURIComponent(mpId)}`);
}

/** Benford analysis — optional group_by: mp_id | vendor_id | state */
export function fetchBenford(groupBy) {
  const params = groupBy ? `?group_by=${groupBy}` : '';
  return fetchJSON(`/forensics/benford${params}`);
}

/** Cartel network data */
export function fetchCartel(cartelOnly = false) {
  return fetchJSON(`/forensics/cartel?cartel_only=${cartelOnly}`);
}

/** Cartel network HTML for iframe embedding */
export async function fetchCartelHTML() {
  const data = await fetchJSON('/forensics/cartel/html');
  return data.html;
}

/** Puppeteer synchrony / coordinated bidding */
export function fetchPuppeteer(mpId) {
  const params = mpId ? `?mp_id=${encodeURIComponent(mpId)}` : '';
  return fetchJSON(`/forensics/puppeteer${params}`);
}

/** Fuzzy search MPs */
export function searchMPs(query) {
  return fetchJSON(`/search/mp?q=${encodeURIComponent(query)}`);
}

/** Fuzzy search vendors */
export function searchVendors(query) {
  return fetchJSON(`/search/vendor?q=${encodeURIComponent(query)}`);
}

/** Fetch all MPs (for combobox initial list) */
export function fetchAllMPs() {
  return fetchJSON('/search/mp?q=__all__&limit=1000');
}

/** Fetch all vendors (for combobox initial list) */
export function fetchAllVendors() {
  return fetchJSON('/search/vendor?q=__all__&limit=2000');
}

/** Ground truth validation metrics */
export function fetchGroundTruth() {
  return fetchJSON('/ground-truth');
}

/** Backend health check */
export function fetchHealth() {
  return fetchJSON('/health');
}
