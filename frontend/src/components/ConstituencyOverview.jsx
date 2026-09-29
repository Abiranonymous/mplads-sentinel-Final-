import { useState, useEffect, useMemo } from 'react';
import { fetchMPPortfolio } from '../api';
import { PieChart, Pie, Cell, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from 'recharts';
import { Loader2, MapPin, Expand, Minimize2, X, AlertTriangle, ShieldAlert } from 'lucide-react';
import RiskBadge from './RiskBadge';

const COLORS = ['#1e40af', '#3b82f6', '#60a5fa', '#93c5fd', '#bfdbfe', '#6366f1', '#8b5cf6', '#a78bfa', '#c4b5fd', '#ddd6fe', '#94a3b8'];

export default function ConstituencyOverview({ mpId, mpName }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [showAllVendors, setShowAllVendors] = useState(false);
  const [showHighRiskModal, setShowHighRiskModal] = useState(false);

  useEffect(() => {
    if (!mpId) return;
    setLoading(true);
    (async () => {
      try {
        const res = await fetchMPPortfolio(mpId);
        setData(res);
      } catch (err) {
        console.error('MP portfolio error:', err);
      }
      setLoading(false);
    })();
  }, [mpId]);

  // ── Derive category data from the register array ──
  const categoryData = useMemo(() => {
    if (!data?.register) return [];
    const categoryMap = {};
    for (const work of data.register) {
      const cat = work.work_category || 'Unknown';
      if (!categoryMap[cat]) categoryMap[cat] = { count: 0, amount: 0 };
      categoryMap[cat].count += 1;
      categoryMap[cat].amount += (work.sanctioned_amount || 0);
    }
    return Object.entries(categoryMap)
      .map(([name, { count, amount }]) => ({
        name,
        count,
        amount: Math.round(amount * 100) / 100,
      }))
      .sort((a, b) => b.amount - a.amount);
  }, [data]);

  // ── High-risk works filtered from register ──
  const highRiskWorks = useMemo(() => {
    if (!data?.register) return [];
    return data.register.filter(w => w.risk_score > 60);
  }, [data]);

  if (!mpId) {
    return (
      <div className="card p-12 text-center">
        <MapPin className="w-8 h-8 text-[var(--color-text-muted)] mx-auto mb-3" />
        <p className="text-sm text-[var(--color-text-secondary)]">
          Search for a Member of Parliament using the search bar above to view their constituency overview.
        </p>
      </div>
    );
  }

  if (loading) return <div className="card p-8 h-64 animate-shimmer rounded-2xl" />;
  if (!data) return <div className="card p-8 text-center text-sm text-[var(--color-text-muted)]">Unable to load constituency data.</div>;

  const vendors = data.vendor_concentration || [];
  const topVendors = showAllVendors ? vendors : vendors.slice(0, 10);
  const othersTotal = !showAllVendors && vendors.length > 10
    ? vendors.slice(10).reduce((s, v) => s + v.sanctioned_amount, 0) : 0;

  const pieData = topVendors.map(v => ({
    name: v.vendor_name || 'Unknown',
    value: Math.round(v.sanctioned_amount * 100) / 100,
  }));
  if (othersTotal > 0) pieData.push({ name: `Others (${vendors.length - 10} more)`, value: Math.round(othersTotal * 100) / 100 });

  return (
    <div className="space-y-4 animate-fade-in">
      {/* MP Header */}
      <div className="card p-5">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-lg font-bold text-[var(--color-text-primary)]">{data.mp_name}</h3>
            <p className="text-sm text-[var(--color-text-secondary)]">{data.district}, {data.state}</p>
          </div>
          <div className="text-right">
            <div className="text-sm text-[var(--color-text-muted)]">Average Risk Level</div>
            <div className="text-2xl font-bold" style={{
              color: data.avg_risk > 60 ? 'var(--color-critical)' : data.avg_risk > 40 ? 'var(--color-high)' : 'var(--color-low)'
            }}>
              {data.avg_risk}
            </div>
          </div>
        </div>
      </div>

      {/* Key Metrics */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="card p-4">
          <div className="text-xs text-[var(--color-text-muted)] mb-1">Total Works</div>
          <div className="text-xl font-bold">{data.works}</div>
        </div>
        <div className="card p-4">
          <div className="text-xs text-[var(--color-text-muted)] mb-1">Total Sanctioned</div>
          <div className="text-xl font-bold">₹{data.total_sanctioned_cr} Crore</div>
        </div>
        <div className="card p-4">
          <div className="text-xs text-[var(--color-text-muted)] mb-1">Total Released</div>
          <div className="text-xl font-bold">₹{data.total_released_cr} Crore</div>
        </div>
        {/* ── Clickable High Risk Works Card ── */}
        <div
          className="card p-4 cursor-pointer group relative"
          onClick={() => highRiskWorks.length > 0 && setShowHighRiskModal(true)}
          id="high-risk-works-card"
        >
          <div className="text-xs text-[var(--color-text-muted)] mb-1">High Risk Works</div>
          <div className="text-xl font-bold text-[var(--color-critical)]">{data.high_risk_works}</div>
          {highRiskWorks.length > 0 && (
            <div className="text-[10px] text-[var(--color-brand)] mt-1 opacity-0 group-hover:opacity-100 transition-opacity flex items-center gap-1">
              <ShieldAlert className="w-3 h-3" />
              Click to view flagged projects
            </div>
          )}
        </div>
      </div>

      {/* Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Vendor Pie */}
        <div className="card p-5">
          <div className="flex items-center justify-between mb-4">
            <h4 className="text-sm font-semibold text-[var(--color-text-primary)]">
              Contractor Fund Concentration
              {!showAllVendors && vendors.length > 10 && ` (Top 10 of ${vendors.length})`}
            </h4>
            {vendors.length > 10 && (
              <button onClick={() => setShowAllVendors(!showAllVendors)} className="btn-ghost text-xs">
                {showAllVendors ? <Minimize2 className="w-3 h-3" /> : <Expand className="w-3 h-3" />}
                {showAllVendors ? 'Top 10' : 'View All'}
              </button>
            )}
          </div>
          <ResponsiveContainer width="100%" height={280}>
            <PieChart>
              <Pie data={pieData} cx="50%" cy="50%" outerRadius={100} innerRadius={50} dataKey="value" paddingAngle={2}>
                {pieData.map((_, i) => (
                  <Cell key={i} fill={COLORS[i % COLORS.length]} />
                ))}
              </Pie>
              <Tooltip formatter={(val) => `₹${val.toLocaleString('en-IN')} Lakh`} contentStyle={{ borderRadius: 8, fontSize: 12 }} />
              <Legend wrapperStyle={{ fontSize: 11 }} />
            </PieChart>
          </ResponsiveContainer>
        </div>

        {/* Category Spending Bar — derived from register */}
        <div className="card p-5">
          <h4 className="text-sm font-semibold text-[var(--color-text-primary)] mb-4">Spending by Category</h4>
          {categoryData.length > 0 ? (
            <ResponsiveContainer width="100%" height={280}>
              <BarChart data={categoryData} margin={{ top: 5, right: 20, bottom: 40, left: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border-light)" />
                <XAxis dataKey="name" tick={{ fontSize: 10 }} angle={-30} textAnchor="end" />
                <YAxis tick={{ fontSize: 11 }} />
                <Tooltip
                  contentStyle={{ borderRadius: 8, fontSize: 12 }}
                  formatter={(val, name) => {
                    if (name === 'amount') return [`₹${Number(val).toLocaleString('en-IN')} Lakh`, 'Total Amount'];
                    return [val, 'Works'];
                  }}
                />
                <Bar dataKey="amount" fill="var(--color-brand)" radius={[4, 4, 0, 0]} name="amount" />
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <div className="h-[280px] flex items-center justify-center text-sm text-[var(--color-text-muted)]">
              No category data available for this constituency.
            </div>
          )}
        </div>
      </div>

      {/* Risk Tier Distribution */}
      {data.tier_counts && (
        <div className="card p-5">
          <h4 className="text-sm font-semibold text-[var(--color-text-primary)] mb-3">Risk Distribution</h4>
          <div className="flex gap-3">
            {['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'].map(tier => (
              <div key={tier} className="flex items-center gap-2">
                <RiskBadge tier={tier} />
                <span className="text-sm font-semibold">{data.tier_counts[tier] || 0}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── High Risk Works Modal ── */}
      {showHighRiskModal && (
        <div className="modal-backdrop" onClick={() => setShowHighRiskModal(false)}>
          <div
            className="modal-content"
            onClick={e => e.stopPropagation()}
            style={{ maxWidth: '900px', width: '95%' }}
          >
            <div className="p-6">
              {/* Header */}
              <div className="flex items-center justify-between mb-5">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl flex items-center justify-center" style={{ background: 'var(--color-critical-bg)' }}>
                    <AlertTriangle className="w-5 h-5 text-[var(--color-critical)]" />
                  </div>
                  <div>
                    <h3 className="text-base font-bold text-[var(--color-text-primary)]">
                      High Risk Works — {data.mp_name}
                    </h3>
                    <p className="text-xs text-[var(--color-text-muted)]">
                      {highRiskWorks.length} projects flagged with a risk score above 60
                    </p>
                  </div>
                </div>
                <button onClick={() => setShowHighRiskModal(false)} className="btn-ghost p-2 rounded-full">
                  <X className="w-5 h-5" />
                </button>
              </div>

              {/* Table */}
              <div className="overflow-x-auto rounded-xl border border-[var(--color-border-light)]">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-[var(--color-background-alt)]">
                      <th className="text-left px-4 py-2.5 text-xs font-semibold text-[var(--color-text-muted)]">Work Identifier</th>
                      <th className="text-left px-4 py-2.5 text-xs font-semibold text-[var(--color-text-muted)]">Contractor</th>
                      <th className="text-right px-4 py-2.5 text-xs font-semibold text-[var(--color-text-muted)]">Amount</th>
                      <th className="text-center px-4 py-2.5 text-xs font-semibold text-[var(--color-text-muted)]">Risk Level</th>
                      <th className="text-left px-4 py-2.5 text-xs font-semibold text-[var(--color-text-muted)]">Reasons for Flag</th>
                    </tr>
                  </thead>
                  <tbody>
                    {highRiskWorks.map((w) => (
                      <tr key={w.work_id} className="border-t border-[var(--color-border-light)] hover:bg-[var(--color-background)] transition-colors">
                        <td className="px-4 py-2.5 font-mono text-xs">{w.work_id}</td>
                        <td className="px-4 py-2.5">{w.vendor_name || <span className="italic text-[var(--color-text-muted)]">Not assigned</span>}</td>
                        <td className="px-4 py-2.5 text-right font-medium whitespace-nowrap">
                          ₹{Number(w.sanctioned_amount).toLocaleString('en-IN', { maximumFractionDigits: 2 })} Lakh
                        </td>
                        <td className="px-4 py-2.5 text-center">
                          <RiskBadge tier={w.risk_tier} score={w.risk_score} />
                        </td>
                        <td className="px-4 py-2.5">
                          <div className="flex flex-wrap gap-1">
                            {(w.reason_chips || []).map((chip, i) => (
                              <span key={i} className="text-[11px] px-2 py-0.5 rounded-full bg-[var(--color-critical-bg)] text-[var(--color-critical)] font-medium">
                                {chip}
                              </span>
                            ))}
                            {(!w.reason_chips || w.reason_chips.length === 0) && (
                              <span className="text-xs text-[var(--color-text-muted)] italic">Machine learning anomaly detected</span>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
