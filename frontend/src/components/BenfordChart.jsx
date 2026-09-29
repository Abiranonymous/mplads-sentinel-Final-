import { useState, useEffect } from 'react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Line, ComposedChart, Legend } from 'recharts';
import { Eye, EyeOff, AlertTriangle, CheckCircle } from 'lucide-react';
import { fetchBenford } from '../api';

const BENFORD_EXPECTED = [30.1, 17.6, 12.5, 9.7, 7.9, 6.7, 5.8, 5.1, 4.6];
const DIGIT_LABELS = ['1', '2', '3', '4', '5', '6', '7', '8', '9'];

export default function BenfordChart() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [entityData, setEntityData] = useState(null);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetchBenford();
        setData(res);
      } catch (err) {
        console.error('Benford fetch error:', err);
      }
      setLoading(false);
    })();
  }, []);

  const loadEntityScan = async () => {
    if (entityData) return;
    try {
      const res = await fetchBenford('mp_id');
      setEntityData(res);
    } catch (err) {
      console.error(err);
    }
  };

  if (loading) {
    return <div className="card p-8 h-64 animate-shimmer rounded-2xl" />;
  }

  if (!data) {
    return (
      <div className="card p-8 text-center text-sm text-[var(--color-text-muted)]">
        Unable to load budget analysis data.
      </div>
    );
  }

  const chartData = DIGIT_LABELS.map((d, i) => ({
    digit: d,
    'Observed Frequency': data.observed_pct?.[i] ?? 0,
    'Expected Frequency': BENFORD_EXPECTED[i],
  }));

  const hasDeviation = data.flag;

  return (
    <div className="space-y-4 animate-fade-in">
      {/* Status Banner */}
      <div className={`card p-4 flex items-center gap-3 ${hasDeviation ? 'border-l-4' : ''}`}
           style={hasDeviation ? { borderLeftColor: 'var(--color-critical)' } : {}}>
        {hasDeviation ? (
          <AlertTriangle className="w-5 h-5 text-[var(--color-critical)] flex-shrink-0" />
        ) : (
          <CheckCircle className="w-5 h-5 text-[var(--color-low)] flex-shrink-0" />
        )}
        <div>
          <p className="text-sm font-medium text-[var(--color-text-primary)]">
            {hasDeviation
              ? 'Budget figures show signs of possible fabrication'
              : 'Budget figures follow expected natural patterns'}
          </p>
          <p className="text-xs text-[var(--color-text-muted)] mt-0.5">
            Analyzed {data.n?.toLocaleString()} sanction amounts using natural number distribution analysis
          </p>
        </div>
      </div>

      {/* Chart */}
      <div className="card p-5">
        <h3 className="text-sm font-semibold text-[var(--color-text-primary)] mb-4">
          Budget Amount First-Digit Pattern
        </h3>
        <ResponsiveContainer width="100%" height={320}>
          <ComposedChart data={chartData} margin={{ top: 5, right: 20, bottom: 5, left: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border-light)" />
            <XAxis dataKey="digit" tick={{ fontSize: 12 }} label={{ value: 'Leading Digit', position: 'insideBottom', offset: -2, fontSize: 11, fill: 'var(--color-text-muted)' }} />
            <YAxis tick={{ fontSize: 12 }} label={{ value: 'Frequency (%)', angle: -90, position: 'insideLeft', fontSize: 11, fill: 'var(--color-text-muted)' }} />
            <Tooltip
              contentStyle={{ borderRadius: 8, border: '1px solid var(--color-border)', fontSize: 12 }}
              formatter={(val) => `${val.toFixed(1)}%`}
            />
            <Legend wrapperStyle={{ fontSize: 12, paddingTop: 8 }} />
            <Bar dataKey="Observed Frequency" fill="var(--color-brand)" radius={[4, 4, 0, 0]} />
            <Line dataKey="Expected Frequency" stroke="var(--color-critical)" strokeWidth={2} dot={{ r: 4 }} type="monotone" />
          </ComposedChart>
        </ResponsiveContainer>

        {/* Color Legend */}
        <div className="flex items-center justify-center gap-6 mt-3 pt-3 border-t border-[var(--color-border-light)]">
          <div className="flex items-center gap-2">
            <div className="w-4 h-3 rounded-sm" style={{ background: 'var(--color-brand)' }} />
            <span className="text-xs text-[var(--color-text-secondary)]">Observed budget amounts</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-6 h-0.5 rounded" style={{ background: 'var(--color-critical)' }} />
            <span className="text-xs text-[var(--color-text-secondary)]">Expected natural pattern</span>
          </div>
        </div>
      </div>

      {/* Progressive Disclosure */}
      <button
        onClick={() => { setShowAdvanced(!showAdvanced); loadEntityScan(); }}
        className="btn-ghost text-xs"
      >
        {showAdvanced ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
        {showAdvanced ? 'Hide Statistical Details' : 'Show Statistical Details'}
      </button>

      {showAdvanced && (
        <div className="card p-4 animate-fade-in">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-xs">
            <div>
              <span className="text-[var(--color-text-muted)]">Chi-Square Statistic:</span>
              <span className="ml-1 font-mono font-medium">{data.chi_square ?? 'Not available'}</span>
            </div>
            <div>
              <span className="text-[var(--color-text-muted)]">Statistical Significance:</span>
              <span className="ml-1 font-mono font-medium">{data.p_value != null ? data.p_value.toFixed(4) : 'Not available'}</span>
            </div>
            <div>
              <span className="text-[var(--color-text-muted)]">Mean Absolute Deviation:</span>
              <span className="ml-1 font-mono font-medium">{data.mad ?? 'Not available'}</span>
            </div>
            <div>
              <span className="text-[var(--color-text-muted)]">Conformity:</span>
              <span className="ml-1 font-medium">{data.conformity}</span>
            </div>
          </div>

          {entityData && entityData.length > 0 && (
            <div className="mt-4 pt-4 border-t border-[var(--color-border-light)]">
              <h4 className="text-xs font-semibold text-[var(--color-text-secondary)] mb-2">
                Per-Constituency Analysis (flagged entries)
              </h4>
              <div className="max-h-48 overflow-y-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-[var(--color-border-light)]">
                      <th className="text-left py-1.5 text-[var(--color-text-muted)]">Member of Parliament</th>
                      <th className="text-right py-1.5 text-[var(--color-text-muted)]">Samples</th>
                      <th className="text-right py-1.5 text-[var(--color-text-muted)]">Conformity</th>
                      <th className="text-center py-1.5 text-[var(--color-text-muted)]">Flagged</th>
                    </tr>
                  </thead>
                  <tbody>
                    {entityData.filter(e => e.flag).slice(0, 20).map((e, i) => (
                      <tr key={i} className="border-b border-[var(--color-border-light)]">
                        <td className="py-1.5 font-mono">{e.mp_id}</td>
                        <td className="py-1.5 text-right">{e.n}</td>
                        <td className="py-1.5 text-right">{e.conformity}</td>
                        <td className="py-1.5 text-center">
                          {e.flag ? '⚠️' : '✓'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
