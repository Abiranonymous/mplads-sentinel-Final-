import { useState, useEffect } from 'react';
import { fetchCartel, fetchCartelHTML } from '../api';
import { Network, AlertTriangle, Expand, Minimize2, Globe, List } from 'lucide-react';

export default function CartelGraph() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [showAll, setShowAll] = useState(false);
  const [graphHtml, setGraphHtml] = useState(null);
  const [graphLoading, setGraphLoading] = useState(false);
  const [viewMode, setViewMode] = useState('graph'); // 'graph' | 'list'

  useEffect(() => {
    (async () => {
      try {
        const res = await fetchCartel(true);
        setData(res);
      } catch (err) {
        console.error('Cartel fetch error:', err);
      }
      setLoading(false);
    })();
  }, []);

  // Fetch the Pyvis HTML for interactive graph
  useEffect(() => {
    (async () => {
      setGraphLoading(true);
      try {
        const html = await fetchCartelHTML();
        setGraphHtml(html);
      } catch (err) {
        console.error('Cartel graph HTML error:', err);
      }
      setGraphLoading(false);
    })();
  }, []);

  if (loading) return <div className="card p-8 h-64 animate-shimmer rounded-2xl" />;
  if (!data) return <div className="card p-8 text-center text-sm text-[var(--color-text-muted)]">Unable to load network data.</div>;

  const members = data.members || {};
  const cartelGroups = {};
  Object.entries(members).forEach(([vendorId, cartelId]) => {
    if (!cartelGroups[cartelId]) cartelGroups[cartelId] = [];
    cartelGroups[cartelId].push(vendorId);
  });

  const sortedCartels = Object.entries(cartelGroups).sort((a, b) => b[1].length - a[1].length);
  const displayCartels = showAll ? sortedCartels : sortedCartels.slice(0, 10);

  return (
    <div className="space-y-4 animate-fade-in">
      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="card p-4">
          <div className="text-xs text-[var(--color-text-muted)] mb-1">Cartels Detected</div>
          <div className="text-2xl font-bold text-[var(--color-critical)]">{data.cartels}</div>
        </div>
        <div className="card p-4">
          <div className="text-xs text-[var(--color-text-muted)] mb-1">Vendors Implicated</div>
          <div className="text-2xl font-bold text-[var(--color-text-primary)]">{data.cartel_vendors}</div>
        </div>
        <div className="card p-4">
          <div className="text-xs text-[var(--color-text-muted)] mb-1">Total Cartel Outlay</div>
          <div className="text-2xl font-bold text-[var(--color-text-primary)]">₹{data.cartel_outlay_cr?.toFixed(2)} Crore</div>
        </div>
      </div>

      {/* Color Legend */}
      <div className="card p-4">
        <h3 className="text-sm font-semibold text-[var(--color-text-primary)] mb-3">
          Understanding the Shared Identity Network
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div className="flex items-center gap-3 p-3 rounded-lg" style={{ background: 'var(--color-critical-bg)' }}>
            <div className="w-5 h-5 rounded-full flex-shrink-0" style={{ background: 'var(--color-critical)' }} />
            <div>
              <div className="text-sm font-medium" style={{ color: 'var(--color-critical)' }}>Red = Shared Identity (Probable Shell Company)</div>
              <div className="text-xs text-[var(--color-text-muted)]">Vendors sharing PAN, bank account, or director</div>
            </div>
          </div>
          <div className="flex items-center gap-3 p-3 rounded-lg bg-[var(--color-background)]">
            <div className="w-5 h-5 rounded-full flex-shrink-0" style={{ background: 'var(--color-brand)' }} />
            <div>
              <div className="text-sm font-medium text-[var(--color-brand)]">Blue = Independent Vendor</div>
              <div className="text-xs text-[var(--color-text-muted)]">No identity overlap detected with other vendors</div>
            </div>
          </div>
        </div>
      </div>

      {/* View Toggle + Interactive Graph / Linked Groups */}
      <div className="card overflow-hidden">
        <div className="px-5 py-3 border-b border-[var(--color-border-light)] flex items-center justify-between">
          <h3 className="text-sm font-semibold text-[var(--color-text-primary)] flex items-center gap-2">
            <Network className="w-4 h-4" />
            {viewMode === 'graph' ? 'Interactive Network Visualization' : `Linked Vendor Groups ${!showAll && sortedCartels.length > 10 ? `(Top 10 of ${sortedCartels.length})` : ''}`}
          </h3>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setViewMode(viewMode === 'graph' ? 'list' : 'graph')}
              className="btn-secondary text-xs"
            >
              {viewMode === 'graph' ? <List className="w-3.5 h-3.5" /> : <Globe className="w-3.5 h-3.5" />}
              {viewMode === 'graph' ? 'Show Linked Vendor List' : 'Show Interactive Graph'}
            </button>
          </div>
        </div>

        {viewMode === 'graph' ? (
          /* ── Interactive Pyvis Graph via iframe ── */
          <div className="relative" style={{ minHeight: '640px' }}>
            {graphLoading && (
              <div className="absolute inset-0 flex items-center justify-center bg-[var(--color-background)]">
                <div className="flex flex-col items-center gap-3">
                  <div className="w-8 h-8 border-3 border-[var(--color-brand-light)] border-t-transparent rounded-full animate-spin" />
                  <span className="text-sm text-[var(--color-text-muted)]">Loading interactive network visualization...</span>
                </div>
              </div>
            )}
            {graphHtml ? (
              <iframe
                srcDoc={graphHtml}
                title="Cartel Network Interactive Graph"
                className="w-full border-0"
                style={{ height: '640px' }}
                sandbox="allow-scripts allow-same-origin"
              />
            ) : !graphLoading ? (
              <div className="flex items-center justify-center h-[640px] text-sm text-[var(--color-text-muted)]">
                Unable to load the interactive graph. Try the linked vendor list view instead.
              </div>
            ) : null}
          </div>
        ) : (
          /* ── Text-based Linked Vendor Groups (fallback / alternative) ── */
          <>
            <div className="divide-y divide-[var(--color-border-light)]">
              {displayCartels.map(([cartelId, vendors]) => (
                <div key={cartelId} className="px-5 py-3 hover:bg-[var(--color-background)] transition-colors">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <AlertTriangle className="w-4 h-4 text-[var(--color-critical)]" />
                      <span className="text-sm font-semibold text-[var(--color-text-primary)]">{cartelId}</span>
                      <span className="text-xs px-2 py-0.5 rounded-full bg-[var(--color-critical-bg)] text-[var(--color-critical)] font-medium">
                        {vendors.length} linked vendors
                      </span>
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-1.5 mt-2">
                    {vendors.map((v) => (
                      <span key={v} className="text-xs px-2 py-1 rounded-md bg-[var(--color-background-alt)] text-[var(--color-text-secondary)] font-mono">
                        {v}
                      </span>
                    ))}
                  </div>
                </div>
              ))}
            </div>
            {sortedCartels.length > 10 && (
              <div className="px-5 py-3 border-t border-[var(--color-border-light)]">
                <button onClick={() => setShowAll(!showAll)} className="btn-secondary text-xs w-full justify-center">
                  {showAll ? <Minimize2 className="w-3.5 h-3.5" /> : <Expand className="w-3.5 h-3.5" />}
                  {showAll ? 'Show Top 10 Only' : `View Full Expanded List (${sortedCartels.length} groups)`}
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
