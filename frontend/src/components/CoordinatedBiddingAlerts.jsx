import React, { Component, useState, useEffect, useMemo, useCallback } from 'react';
import { fetchPuppeteer } from '../api';
import { Users, Eye, EyeOff, Expand, Minimize2, Grid3X3, Filter, Clock, CheckCircle2 } from 'lucide-react';
import { ScatterChart, Scatter, XAxis, YAxis, Tooltip as RechartsTooltip, ResponsiveContainer, CartesianGrid, Legend } from 'recharts';

class CoordinatedBiddingErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }
  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }
  componentDidCatch(error, errorInfo) {
    console.error('CoordinatedBiddingAlerts render error caught:', error, errorInfo);
  }
  render() {
    if (this.state.hasError) {
      return (
        <div className="card p-8 text-center space-y-3">
          <p className="text-sm text-[var(--color-critical)] font-semibold">
            Coordinated Bidding Alerts is temporarily unavailable.
          </p>
          <p className="text-xs text-[var(--color-text-muted)] font-mono">
            {this.state.error?.message || 'A render exception occurred.'}
          </p>
          <button
            onClick={() => this.setState({ hasError: false, error: null })}
            className="btn-secondary text-xs px-3 py-1.5"
          >
            Retry View
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

// ── True Color Gradient: smooth continuous scale (white -> rose -> deep crimson) ──
function heatColor(score, maxScore) {
  if (!score || score <= 0) return '#ffffff';
  const safeMax = Math.max(1, maxScore);
  const ratio = Math.min(1, Math.max(0.06, score / safeMax));
  // Continuous smooth gradient interpolation:
  // Low (0.0): white/soft light rose rgb(254, 242, 242)
  // Mid (0.5): vibrant crimson rgb(225, 29, 72)
  // Max (1.0): dark deep ruby rgb(153, 27, 27)
  const r = Math.round(254 - ratio * (254 - 153));
  const g = Math.round(242 - ratio * (242 - 27));
  const b = Math.round(242 - ratio * (242 - 27));
  return `rgb(${r}, ${g}, ${b})`;
}

function PairwiseHeatmap({ pairs, ringVendorIds }) {
  const [tooltipData, setTooltipData] = useState(null);
  const tooltip = tooltipData;
  const setTooltip = setTooltipData;

  const safePairs = useMemo(() => (Array.isArray(pairs) ? pairs : []), [pairs]);

  const { vendorNames, pairMap, maxVal, displayVendors } = useMemo(() => {
    if (!safePairs || safePairs.length === 0) {
      return { vendorNames: {}, pairMap: {}, maxVal: 0, displayVendors: [] };
    }

    const vendorSet = new Set();
    const nameMap = {};

    const hasFilter = ringVendorIds && (
      (ringVendorIds instanceof Set && ringVendorIds.size > 0) ||
      (Array.isArray(ringVendorIds) && ringVendorIds.length > 0)
    );

    const matchesFilter = (id, name) => {
      if (!hasFilter) return true;
      if (ringVendorIds instanceof Set) {
        return Boolean((id && ringVendorIds.has(id)) || (name && ringVendorIds.has(name)));
      }
      if (Array.isArray(ringVendorIds)) {
        return Boolean((id && ringVendorIds.includes(id)) || (name && ringVendorIds.includes(name)));
      }
      return true;
    };

    safePairs.forEach(p => {
      if (!p) return;
      const inRing = !hasFilter || (matchesFilter(p.v_a, p.vendor_name_a) && matchesFilter(p.v_b, p.vendor_name_b));
      if (inRing) {
        if (p.v_a) vendorSet.add(p.v_a);
        if (p.v_b) vendorSet.add(p.v_b);
      }
      if (p.v_a && p.vendor_name_a) nameMap[p.v_a] = p.vendor_name_a;
      if (p.v_b && p.vendor_name_b) nameMap[p.v_b] = p.vendor_name_b;
    });

    // Fallback: if ringVendorIds was provided but matched 0 pairs, include all vendors from safePairs
    if (vendorSet.size === 0) {
      safePairs.forEach(p => {
        if (!p) return;
        if (p.v_a) vendorSet.add(p.v_a);
        if (p.v_b) vendorSet.add(p.v_b);
        if (p.v_a && p.vendor_name_a) nameMap[p.v_a] = p.vendor_name_a;
        if (p.v_b && p.vendor_name_b) nameMap[p.v_b] = p.vendor_name_b;
      });
    }

    const allVendors = Array.from(vendorSet);

    // Build lookup: "v_a|v_b" -> { days, synchrony, va, vb, nameA, nameB }
    const map = {};
    let max = 0;
    safePairs.forEach(p => {
      if (!p || !p.v_a || !p.v_b) return;
      const key = `${p.v_a}|${p.v_b}`;
      const key2 = `${p.v_b}|${p.v_a}`;
      const days = Number(p.shared_sanction_days || 0);
      const score = Number(p.synchrony != null ? p.synchrony : days);
      const nA = p.vendor_name_a || p.v_a;
      const nB = p.vendor_name_b || p.v_b;
      map[key] = { days, synchrony: score, va: p.v_a, vb: p.v_b, nameA: nA, nameB: nB };
      map[key2] = { days, synchrony: score, va: p.v_b, vb: p.v_a, nameA: nB, nameB: nA };
      if (score > max) max = score;
    });

    const display = allVendors.filter(Boolean).sort();
    return { vendorNames: nameMap, pairMap: map, maxVal: max, displayVendors: display };
  }, [safePairs, ringVendorIds]);

  const safeDisplayVendors = useMemo(() => (Array.isArray(displayVendors) ? displayVendors : []), [displayVendors]);

  if (!safeDisplayVendors || safeDisplayVendors.length === 0) {
    return (
      <div className="p-6 text-center text-sm text-[var(--color-text-muted)]">
        No vendor ring co-filings detected for this MP office.
      </div>
    );
  }

  const getName = (id) => vendorNames?.[id] || id || '';
  const shortName = (id) => {
    const n = String(getName(id) || '');
    return n.length > 14 ? n.slice(0, 12) + '…' : n;
  };

  return (
    <div className="relative">
      <div className="flex items-start justify-between gap-4">
        {/* Heatmap Grid */}
        <div className="overflow-x-auto pb-4 flex-1">
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: `108px repeat(${safeDisplayVendors?.length || 0}, 40px)`,
              gap: '1px',
              width: 'fit-content',
            }}
          >
            {/* Top-left empty corner */}
            <div style={{ width: '108px', height: '84px' }} />
            {/* Column headers */}
            {(safeDisplayVendors || []).map((v) => (
              <div
                key={`col-${v}`}
                title={getName(v)}
                className="text-[10px] text-[var(--color-text-secondary)] font-medium select-none truncate"
                style={{
                  width: '40px',
                  writingMode: 'vertical-rl',
                  transform: 'rotate(180deg)',
                  height: '84px',
                  lineHeight: '40px',
                }}
              >
                {shortName(v)}
              </div>
            ))}

            {/* Data rows: row label + all cells */}
            {(safeDisplayVendors || []).flatMap((rowV) => {
              const rowName = getName(rowV);
              return [
                <div
                  key={`rowlabel-${rowV}`}
                  className="text-[10px] text-[var(--color-text-secondary)] font-medium text-right pr-2 truncate select-none flex items-center justify-end"
                  style={{ width: '108px', height: '40px' }}
                  title={rowName}
                >
                  {shortName(rowV)}
                </div>,
                ...(safeDisplayVendors || []).map((colV) => {
                  const key = `${rowV}|${colV}`;
                  const entry = pairMap?.[key];
                  const val = entry?.synchrony ?? 0;
                  const days = entry?.days ?? 0;
                  const isSelf = rowV === colV;
                  const colName = getName(colV);

                  return (
                    <div
                      key={`cell-${rowV}-${colV}`}
                      className="transition-all duration-75 cursor-pointer"
                      style={{
                        width: '40px',
                        height: '40px',
                        background: isSelf ? '#e2e8f0' : heatColor(val, maxVal),
                        border: '1px solid #e2e8f0',
                        borderRadius: '2px',
                      }}
                      onMouseEnter={(e) => {
                        setTooltipData({
                          vendorA: rowName || 'Vendor A',
                          vendorB: colName || 'Vendor B',
                          days: Number(days || 0),
                          synchrony: Number(val || 0),
                          isSelf: Boolean(isSelf),
                          x: e?.clientX ?? 0,
                          y: e?.clientY ?? 0,
                        });
                      }}
                      onMouseMove={(e) => {
                        if (e && e.clientX != null && e.clientY != null) {
                          setTooltipData(prev => (prev ? { ...prev, x: e.clientX, y: e.clientY } : null));
                        }
                      }}
                      onMouseLeave={() => setTooltipData(null)}
                    />
                  );
                }),
              ];
            })}
          </div>
        </div>

        {/* Vertical Gradient Scale Legend */}
        <div className="flex flex-col items-center pt-8 pr-2 select-none flex-shrink-0">
          <span className="text-[10px] font-semibold text-[var(--color-critical)] mb-1 font-mono">
            {Number(maxVal || 0) > 0 ? Number(maxVal).toFixed(1) : '10.0'}
          </span>
          <div
            className="w-3.5 h-40 rounded-full border border-[var(--color-border-light)] shadow-sm"
            style={{
              background: 'linear-gradient(to bottom, rgb(153, 27, 27) 0%, rgb(225, 29, 72) 45%, rgb(254, 242, 242) 85%, #ffffff 100%)',
            }}
          />
          <span className="text-[10px] font-medium text-[var(--color-text-muted)] mt-1 font-mono">
            0.0
          </span>
          <span
            className="text-[10px] font-semibold text-[var(--color-text-secondary)] mt-3 tracking-wider uppercase"
            style={{
              writingMode: 'vertical-rl',
              transform: 'rotate(180deg)',
            }}
          >
            Collusion Risk Score
          </span>
        </div>
      </div>

      {/* Dynamic Cursor-Tracking Floating Tooltip */}
      {Boolean(tooltipData && tooltipData?.x != null && tooltipData?.y != null) && (
        <div
          id="heatmap-floating-tooltip"
          className="fixed z-[9999] pointer-events-none bg-white rounded-xl shadow-2xl border border-[var(--color-border-light)] p-3.5 max-w-sm text-xs backdrop-blur-sm animate-fade-in"
          style={{
            left: `${Math.min((Number(tooltipData?.x) || 0) + 14, (typeof window !== 'undefined' ? (window?.innerWidth || 1200) : 1200) - 340)}px`,
            top: `${Math.min((Number(tooltipData?.y) || 0) + 14, (typeof window !== 'undefined' ? (window?.innerHeight || 800) : 800) - 160)}px`,
          }}
        >
          {tooltipData?.isSelf ? (
            <>
              <div className="text-xs font-semibold text-slate-600 mb-1 flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-slate-400 inline-block" />
                Baseline Self-Comparison
              </div>
              <p className="text-[var(--color-text-secondary)] leading-relaxed">
                <strong className="text-[var(--color-text-primary)]">{tooltipData?.vendorA || 'Same Identity'}</strong> (same vendor identity).
              </p>
            </>
          ) : (Number(tooltipData?.synchrony || 0) > 0 || Number(tooltipData?.days || 0) > 0) ? (
            <>
              <div
                className="text-xs font-semibold mb-1 flex items-center justify-between"
                style={{
                  color: (Number(tooltipData?.synchrony || 0) > 8 || Number(tooltipData?.days || 0) > 5) ? 'var(--color-critical)' : 'var(--color-high)',
                }}
              >
                <span>
                  {(Number(tooltipData?.synchrony || 0) > 8 || Number(tooltipData?.days || 0) > 5)
                    ? '🚨 High Probability of Collusion'
                    : '⚠️ Moderate Co-Filing Overlap'}
                </span>
                <span className="font-mono text-[10px] text-[var(--color-text-muted)] font-normal ml-2">
                  {tooltipData?.days || 0} shared {tooltipData?.days === 1 ? 'day' : 'days'}
                </span>
              </div>
              <p className="text-[var(--color-text-secondary)] leading-relaxed">
                <strong className="text-[var(--color-text-primary)]">{tooltipData?.vendorA || 'Vendor A'}</strong> and{' '}
                <strong className="text-[var(--color-text-primary)]">{tooltipData?.vendorB || 'Vendor B'}</strong> filed documents on the exact same dates{' '}
                <strong>{tooltipData?.days || 0} times</strong>.
              </p>
              {Number(tooltipData?.synchrony || 0) > 0 && (
                <div className="mt-1.5 pt-1.5 border-t border-[var(--color-border-light)] flex justify-between text-[11px] text-[var(--color-text-muted)] font-mono">
                  <span>Collusion Risk Score</span>
                  <span className="font-semibold text-[var(--color-text-primary)]">
                    {Number(tooltipData?.synchrony || 0).toFixed(1)}
                  </span>
                </div>
              )}
            </>
          ) : (
            <>
              <div className="text-xs font-semibold text-emerald-600 mb-1 flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-emerald-500 inline-block" />
                Independent Filing Pattern
              </div>
              <p className="text-[var(--color-text-secondary)] leading-relaxed">
                No overlapping filing dates detected between{' '}
                <strong className="text-[var(--color-text-primary)]">{tooltipData?.vendorA || 'Vendor A'}</strong> and{' '}
                <strong className="text-[var(--color-text-primary)]">{tooltipData?.vendorB || 'Vendor B'}</strong>.
              </p>
            </>
          )}
        </div>
      )}
    </div>
  );
}

function TimelineScatter({ timelineWorks }) {
  const safeWorks = useMemo(() => (Array.isArray(timelineWorks) ? timelineWorks : []), [timelineWorks]);

  const { vendorNames, ringPoints, independentPoints, dateMin, dateMax } = useMemo(() => {
    if (!safeWorks || safeWorks.length === 0) {
      return { vendorNames: [], ringPoints: [], independentPoints: [], dateMin: 0, dateMax: 0 };
    }

    // Sort Ring vendors first, then Independent vendors (exactly replicating Streamlit)
    const ringVendors = new Set(safeWorks.filter(w => w?.is_ring).map(w => w?.vendor_name).filter(Boolean));
    const allVendors = Array.from(new Set(safeWorks.map(w => w?.vendor_name).filter(Boolean)));
    const sortedVendors = allVendors.sort((a, b) => {
      const aIsRing = ringVendors.has(a);
      const bIsRing = ringVendors.has(b);
      if (aIsRing && !bIsRing) return -1;
      if (!aIsRing && bIsRing) return 1;
      return String(a || '').localeCompare(String(b || ''));
    });

    const ring = [];
    const indep = [];
    let minD = Infinity;
    let maxD = -Infinity;

    safeWorks.forEach(w => {
      if (!w?.sanction_date) return;
      const d = new Date(w.sanction_date).getTime();
      if (isNaN(d)) return;
      if (d < minD) minD = d;
      if (d > maxD) maxD = d;

      const pt = {
        dateTimestamp: d,
        dateStr: w.sanction_date,
        vendorIndex: sortedVendors.indexOf(w.vendor_name),
        vendorName: w.vendor_name || 'Unknown',
        ringCategory: w.ring_category || (w.is_ring ? 'Ring' : 'Independent'),
        ringId: w.ring_id,
        isRing: Boolean(w.is_ring),
        workId: w.work_id,
        amount: Number(w.sanctioned_amount || 0),
      };

      if (w.is_ring) {
        ring.push(pt);
      } else {
        indep.push(pt);
      }
    });

    return {
      vendorNames: sortedVendors,
      ringPoints: ring,
      independentPoints: indep,
      dateMin: minD !== Infinity ? minD : 0,
      dateMax: maxD !== -Infinity ? maxD : 0,
    };
  }, [safeWorks]);

  if (!vendorNames || vendorNames.length === 0) {
    return (
      <div className="p-6 text-center text-sm text-[var(--color-text-muted)]">
        No sanction timeline data available for this audit scope.
      </div>
    );
  }

  // Calculate height dynamically: each vendor row gets ~30px
  const chartHeight = Math.max(340, Math.min(680, (vendorNames?.length || 0) * 30 + 100));

  return (
    <div className="w-full">
      <ResponsiveContainer width="100%" height={chartHeight}>
        <ScatterChart margin={{ top: 20, right: 30, bottom: 45, left: 160 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={true} horizontal={true} />
          <XAxis
            dataKey="dateTimestamp"
            name="Sanction Date"
            type="number"
            domain={[dateMin - 86400000 * 5, dateMax + 86400000 * 5]}
            tickFormatter={(ts) => {
              const d = new Date(ts);
              return isNaN(d.getTime()) ? '' : d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: '2-digit' });
            }}
            tick={{ fontSize: 10, fill: '#64748b' }}
            label={{ value: 'Timeline of Sanction Dates', position: 'bottom', offset: 25, fontSize: 11, fill: '#64748b', fontWeight: 500 }}
          />
          <YAxis
            dataKey="vendorIndex"
            name="Vendor"
            type="number"
            domain={[-0.5, Math.max(1, (vendorNames?.length || 1)) - 0.5]}
            ticks={(vendorNames || []).map((_, i) => i)}
            tickFormatter={(i) => {
              const name = vendorNames?.[i] || '';
              return name.length > 24 ? name.slice(0, 22) + '…' : name;
            }}
            tick={{ fontSize: 10, fill: '#334155' }}
            width={155}
          />
          <Legend
            verticalAlign="top"
            height={36}
            iconType="circle"
            formatter={(value) => <span className="text-xs font-medium text-[var(--color-text-primary)] mr-4">{value}</span>}
          />
          <RechartsTooltip
            cursor={{ strokeDasharray: '3 3', stroke: '#94a3b8' }}
            content={({ payload }) => {
              if (!payload || !payload.length || !payload[0]?.payload) return null;
              const d = payload[0]?.payload || {};
              return (
                <div className="bg-white rounded-xl shadow-xl border border-[var(--color-border-light)] p-3 text-xs max-w-xs animate-fade-in">
                  <div className="flex items-center gap-1.5 mb-1.5">
                    <span
                      className="w-2.5 h-2.5 rounded-full"
                      style={{ background: d?.isRing ? 'var(--color-critical)' : '#94a3b8' }}
                    />
                    <span className="font-semibold" style={{ color: d?.isRing ? 'var(--color-critical)' : 'var(--color-text-primary)' }}>
                      {d?.isRing ? `Ring Vendor (${d?.ringId || 'Ring'})` : 'Independent Vendor'}
                    </span>
                  </div>
                  <div className="font-medium text-[var(--color-text-primary)] mb-1">
                    {d?.vendorName}
                  </div>
                  <div className="text-[var(--color-text-muted)] space-y-0.5 font-mono text-[11px]">
                    <div>Date: <strong className="text-[var(--color-text-secondary)]">{d?.dateStr}</strong></div>
                    {d?.workId && <div>Work ID: <strong className="text-[var(--color-text-secondary)]">{d?.workId}</strong></div>}
                    {Number(d?.amount || 0) > 0 && <div>Sanction: <strong className="text-[var(--color-text-secondary)]">₹{Number(d?.amount || 0).toFixed(2)} Lakhs</strong></div>}
                  </div>
                </div>
              );
            }}
          />
          <Scatter
            name="Ring Vendors (Suspicious Collusion)"
            data={ringPoints}
            fill="#dc2626"
            fillOpacity={0.6}
            shape="circle"
            legendType="circle"
            r={4.5}
          />
          <Scatter
            name="Independent Vendors"
            data={independentPoints}
            fill="#94a3b8"
            fillOpacity={0.6}
            shape="circle"
            legendType="circle"
            r={4.5}
          />
        </ScatterChart>
      </ResponsiveContainer>
    </div>
  );
}

function CoordinatedBiddingAlerts() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [selectedMP, setSelectedMP] = useState('MP-BR-032');
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [showAllRings, setShowAllRings] = useState(false);
  const [showHeatmapAll, setShowHeatmapAll] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setError(null);
      try {
        const queryParam = selectedMP && selectedMP !== 'all' ? selectedMP : '';
        const res = await fetchPuppeteer(queryParam);
        if (!cancelled && res) {
          setData(res);
          if (!selectedMP && Array.isArray(res?.mp_list) && res.mp_list.length > 0) {
            setSelectedMP(res.mp_list[0]?.mp_id || '');
          }
        }
      } catch (err) {
        console.error('Puppeteer fetch error:', err);
        if (!cancelled) setError(err?.message || 'Failed to load data');
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => { cancelled = true; };
  }, [selectedMP]);

  const mpList = Array.isArray(data?.mp_list) ? data.mp_list : [];
  const rings = Array.isArray(data?.all_rings) ? data.all_rings : (Array.isArray(data?.rings) ? data.rings : []);
  const scopedRings = Array.isArray(data?.rings) ? data.rings : [];
  const significantPairs = Array.isArray(data?.significant_pairs) ? data.significant_pairs : [];
  const timelineWorks = Array.isArray(data?.timeline_works) ? data.timeline_works : [];
  const displayRings = showAllRings ? rings : rings.slice(0, 15);

  const currentMP = selectedMP || data?.selected_mp || mpList?.[0]?.mp_id || 'all';
  const activeMPName = currentMP !== 'all' ? mpList?.find?.(m => m?.mp_id === currentMP)?.mp_name : null;

  // Extract vendor IDs in this MP's ring for localized dense heatmap scoping (MUST be called before any early returns)
  const ringVendorIds = useMemo(() => {
    const ids = new Set();
    const safeScoped = Array.isArray(scopedRings) ? scopedRings : [];
    safeScoped.forEach(r => {
      if (typeof r?.vendors === 'string') {
        r.vendors.split(/[|,;]/).forEach(v => {
          const trimmed = v.trim();
          if (trimmed) ids.add(trimmed);
        });
      } else if (Array.isArray(r?.vendors)) {
        r.vendors.forEach(v => {
          const trimmed = String(v || '').trim();
          if (trimmed) ids.add(trimmed);
        });
      }
    });
    return ids;
  }, [scopedRings]);

  if (loading && !data) return <div className="card p-8 h-64 animate-shimmer rounded-2xl" />;
  if (!data) {
    return (
      <div className="card p-8 text-center space-y-3">
        <p className="text-sm text-[var(--color-text-muted)]">
          {error ? `Unable to load coordinated bidding data (${error}).` : 'Unable to load coordinated bidding data.'}
        </p>
        <button
          onClick={() => {
            setLoading(true);
            setError(null);
            const queryParam = selectedMP && selectedMP !== 'all' ? selectedMP : '';
            fetchPuppeteer(queryParam)
              .then(res => { if (res) setData(res); })
              .catch(e => setError(e?.message))
              .finally(() => setLoading(false));
          }}
          className="btn-secondary text-xs px-3 py-1.5"
        >
          Retry Connection
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-5 animate-fade-in">
      {/* Summary KPI Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div className="card p-4">
          <div className="text-xs text-[var(--color-text-muted)] mb-1">Vendor Pairs Analyzed</div>
          <div className="text-2xl font-bold text-[var(--color-text-primary)]">{(data?.pairs_tested ?? 0).toLocaleString()}</div>
        </div>
        <div className="card p-4">
          <div className="text-xs text-[var(--color-text-muted)] mb-1">Suspicious Pairs Found</div>
          <div className="text-2xl font-bold text-[var(--color-critical)]">{(data?.pairs_significant ?? 0).toLocaleString()}</div>
        </div>
        <div className="card p-4">
          <div className="text-xs text-[var(--color-text-muted)] mb-1">Coordinated Bidding Rings</div>
          <div className="text-2xl font-bold text-[var(--color-text-primary)]">{(rings || []).length}</div>
        </div>
        <div className="card p-4">
          <div className="text-xs text-[var(--color-text-muted)] mb-1">Total Ring Outlay</div>
          <div className="text-2xl font-bold text-[var(--color-text-primary)]">
            ₹{(rings || []).reduce((a, r) => a + (r?.outlay_cr || 0), 0).toFixed(2)} Crore
          </div>
        </div>
      </div>

      {/* Explanation Banner */}
      <div className="card p-4 bg-[var(--color-background)]">
        <p className="text-sm text-[var(--color-text-secondary)] leading-relaxed">
          <strong>Coordinated Filing Detection:</strong> The engine analyzes whether multiple contractors file sanctions
          or bid documents on identical dates more frequently than random chance would explain.
          When contractors consistently submit paperwork in lock-step, it flags potential puppet rings controlled by a single operator.
        </p>
      </div>

      {/* ── MP Office Selector ('Inspect MP') ── */}
      <div className="card p-4 bg-slate-50 border border-[var(--color-border-light)] flex flex-col md:flex-row items-start md:items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Filter className="w-4 h-4 text-[var(--color-brand)]" />
          <div>
            <span className="text-xs font-semibold text-[var(--color-text-primary)]">Inspect MP Office:</span>
            <span className="text-xs text-[var(--color-text-muted)] ml-2 hidden sm:inline">
              Select an MP constituency to isolate their vendor co-filing patterns
            </span>
          </div>
        </div>
        <div className="flex items-center gap-2 w-full md:w-auto">
          <select
            id="inspect-mp-select"
            value={currentMP}
            onChange={(e) => setSelectedMP(e.target.value)}
            className="w-full md:w-80 px-3 py-2 text-xs bg-white border border-[var(--color-border)] rounded-lg font-medium text-[var(--color-text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--color-brand-light)] shadow-sm"
          >
            {(mpList || []).map(mp => (
              <option key={mp?.mp_id || ''} value={mp?.mp_id || ''}>
                {mp?.mp_id} — {mp?.mp_name}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* ── Side-by-Side Grid Layout: Heatmap (Left) + Filing Timeline (Right) ── */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-8 items-start">
        {/* Heatmap Card (Left) */}
        <div className="card overflow-hidden">
          <div className="px-5 py-3 border-b border-[var(--color-border-light)] flex items-center justify-between">
            <div>
              <h3 className="text-sm font-semibold text-[var(--color-text-primary)] flex items-center gap-2">
                <Grid3X3 className="w-4 h-4 text-[var(--color-brand)]" />
                Pairwise Filing Overlap Heatmap
                {activeMPName && <span className="text-xs font-normal text-[var(--color-text-muted)]">• {activeMPName}</span>}
              </h3>
              <p className="text-[11px] text-[var(--color-text-muted)] mt-0.5">
                Dynamic hover tracks cursor across all cells. Shading reflects Collusion Risk Score.
              </p>
            </div>
          </div>
          <div className="p-5">
            {significantPairs?.length > 0 ? (
              <PairwiseHeatmap pairs={significantPairs} ringVendorIds={ringVendorIds} />
            ) : (
              <div className="p-6 text-center text-sm text-[var(--color-text-muted)]">
                No statistically significant synchronized pairs found for {activeMPName || 'the selected scope'}.
              </div>
            )}
          </div>
        </div>

        {/* Filing Timeline (Right) */}
        <div className="card p-5">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 mb-2">
            <div>
              <h3 className="text-sm font-semibold text-[var(--color-text-primary)] flex items-center gap-2">
                <Clock className="w-4 h-4 text-[var(--color-brand)]" />
                Filing Overlap Timeline
                {activeMPName && <span className="text-xs font-normal text-[var(--color-text-muted)]">• {activeMPName}</span>}
              </h3>
              <p className="text-xs text-[var(--color-text-muted)] mt-0.5">
                X-axis is sanction date timeline. Y-axis is contractor names. Overlapping co-filings form darker clusters.
              </p>
            </div>
          </div>
          <TimelineScatter timelineWorks={timelineWorks} />
        </div>
      </div>

      {/* ── Ring Dossier Table (Below Grid) ── */}
      {(rings?.length || 0) > 0 && (
        <div className="card overflow-hidden">
          <div className="px-5 py-3 border-b border-[var(--color-border-light)] flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Users className="w-4 h-4 text-[var(--color-critical)]" />
              <div>
                <h3 className="text-sm font-semibold text-[var(--color-text-primary)]">
                  Ring Dossier
                </h3>
                <p className="text-[11px] text-[var(--color-text-muted)]">
                  Identified coordinated bidding rings, puppet contractors, and share of constituency funds
                </p>
              </div>
            </div>
            <span className="badge badge-critical text-xs">
              {rings?.length || 0} {(rings?.length === 1) ? 'Ring' : 'Rings'} Detected
            </span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[var(--color-border-light)] bg-slate-50">
                  <th className="text-left px-5 py-2.5 text-xs font-semibold text-[var(--color-text-muted)]">Ring ID</th>
                  <th className="text-left px-5 py-2.5 text-xs font-semibold text-[var(--color-text-muted)]">Member of Parliament</th>
                  <th className="text-right px-5 py-2.5 text-xs font-semibold text-[var(--color-text-muted)]">Vendors</th>
                  <th className="text-right px-5 py-2.5 text-xs font-semibold text-[var(--color-text-muted)]">Works</th>
                  <th className="text-right px-5 py-2.5 text-xs font-semibold text-[var(--color-text-muted)]">Outlay (Crore)</th>
                  <th className="text-right px-5 py-2.5 text-xs font-semibold text-[var(--color-text-muted)]">Share of MP Purse</th>
                  <th className="text-right px-5 py-2.5 text-xs font-semibold text-[var(--color-text-muted)]">Collusion Risk Score</th>
                  <th className="text-center px-5 py-2.5 text-xs font-semibold text-[var(--color-text-muted)]">Action</th>
                </tr>
              </thead>
              <tbody>
                {(displayRings || []).map((ring, i) => {
                  const isCurrentMP = ring?.mp_id === currentMP;
                  return (
                    <tr
                      key={ring?.ring_id || i}
                      className={`border-b border-[var(--color-border-light)] transition-colors ${
                        isCurrentMP ? 'bg-red-50/40' : 'hover:bg-[var(--color-background)]'
                      }`}
                    >
                      <td className="px-5 py-2.5 font-mono text-xs font-semibold text-[var(--color-critical)]">
                        {ring?.ring_id}
                      </td>
                      <td className="px-5 py-2.5">
                        <div className="font-medium text-[var(--color-text-primary)]">{ring?.mp_name}</div>
                        <div className="text-[11px] text-[var(--color-text-muted)] font-mono">{ring?.mp_id}</div>
                      </td>
                      <td className="px-5 py-2.5 text-right font-medium">{ring?.puppets ?? 0}</td>
                      <td className="px-5 py-2.5 text-right">{ring?.works ?? 0}</td>
                      <td className="px-5 py-2.5 text-right font-semibold text-[var(--color-text-primary)]">
                        ₹{Number(ring?.outlay_cr || 0).toFixed(2)} Cr
                      </td>
                      <td className="px-5 py-2.5 text-right">
                        <div className="flex items-center justify-end gap-2">
                          <div className="w-16 h-2 rounded-full bg-[var(--color-border-light)] overflow-hidden">
                            <div
                              className="h-full rounded-full"
                              style={{
                                width: `${Math.min(100, (ring?.share_of_mp_outlay || 0) * 100)}%`,
                                background: (ring?.share_of_mp_outlay || 0) > 0.4 ? 'var(--color-critical)' : 'var(--color-brand)',
                              }}
                            />
                          </div>
                          <span className="text-xs font-medium">
                            {((ring?.share_of_mp_outlay || 0) * 100).toFixed(0)}%
                          </span>
                        </div>
                      </td>
                      <td className="px-5 py-2.5 text-right font-mono text-xs font-semibold text-[var(--color-critical)]">
                        {Number(ring?.ring_strength || 0).toFixed(1)}
                      </td>
                      <td className="px-5 py-2.5 text-center">
                        <button
                          onClick={() => ring?.mp_id && setSelectedMP(ring.mp_id)}
                          className={`btn-secondary text-xs px-2.5 py-1 ${isCurrentMP ? 'bg-red-100 text-red-700 border-red-200' : ''}`}
                        >
                          {isCurrentMP ? 'Inspecting' : 'Inspect MP'}
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="px-5 py-3 border-t border-[var(--color-border-light)] flex items-center justify-between">
            <button onClick={() => setShowAdvanced(!showAdvanced)} className="btn-ghost text-xs">
              {showAdvanced ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
              {showAdvanced ? 'Hide Implicated Vendors' : 'View Implicated Contractors in Rings'}
            </button>
            {(rings || []).length > 15 && (
              <button onClick={() => setShowAllRings(!showAllRings)} className="btn-secondary text-xs">
                {showAllRings ? <Minimize2 className="w-3.5 h-3.5" /> : <Expand className="w-3.5 h-3.5" />}
                {showAllRings ? 'Show Top 15 Only' : `View Full Expanded List (${rings.length} rings)`}
              </button>
            )}
          </div>
          {showAdvanced && (
            <div className="p-4 bg-slate-50 border-t border-[var(--color-border-light)] space-y-3">
              <div className="text-xs font-semibold text-[var(--color-text-primary)]">
                Contractors Implicated by Ring:
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {(rings || []).map((r, i) => (
                  <div key={r?.ring_id || i} className="p-3 bg-white rounded-lg border border-[var(--color-border-light)] text-xs">
                    <div className="font-semibold text-[var(--color-critical)] mb-1">
                      {r?.ring_id} ({r?.mp_name}):
                    </div>
                    <div className="text-[var(--color-text-secondary)] leading-relaxed">
                      {r?.vendors || 'No vendor list provided'}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Color Guide */}
      <div className="card p-4">
        <h3 className="text-sm font-semibold text-[var(--color-text-primary)] mb-3">
          Forensic Color Guide for Coordinated Bidding Analysis
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div className="flex items-center gap-3 p-3 rounded-lg" style={{ background: 'var(--color-critical-bg)' }}>
            <div className="w-5 h-5 rounded-full flex-shrink-0" style={{ background: 'var(--color-critical)' }} />
            <div>
              <div className="text-sm font-medium" style={{ color: 'var(--color-critical)' }}>
                Dark Red / Crimson = Coordinated Bidding Ring
              </div>
              <div className="text-xs text-[var(--color-text-muted)]">Statistically improbable submission synchrony across identical dates</div>
            </div>
          </div>
          <div className="flex items-center gap-3 p-3 rounded-lg bg-[var(--color-background)]">
            <div className="w-5 h-5 rounded-full flex-shrink-0" style={{ background: '#94a3b8' }} />
            <div>
              <div className="text-sm font-medium text-[var(--color-text-secondary)]">
                Slate / White = Independent / Normal Contractor
              </div>
              <div className="text-xs text-[var(--color-text-muted)]">Standard uncorrelated filing timeline conforming to null hypothesis</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function CoordinatedBiddingAlertsWrapper(props) {
  return (
    <CoordinatedBiddingErrorBoundary>
      <CoordinatedBiddingAlerts {...props} />
    </CoordinatedBiddingErrorBoundary>
  );
}

