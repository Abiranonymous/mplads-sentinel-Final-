import { DollarSign, AlertTriangle, Users, ShieldAlert } from 'lucide-react';

function Widget({ icon: Icon, label, value, subtitle, color, delay }) {
  return (
    <div className="card card-interactive p-5 animate-fade-in" style={{ animationDelay: `${delay}ms` }}>
      <div className="flex items-start justify-between mb-3">
        <div className="w-10 h-10 rounded-xl flex items-center justify-center" style={{ background: color + '15' }}>
          <Icon className="w-5 h-5" style={{ color }} />
        </div>
      </div>
      <div className="text-2xl font-bold text-[var(--color-text-primary)] tracking-tight">
        {value}
      </div>
      <div className="text-sm text-[var(--color-text-secondary)] mt-1 font-medium">
        {label}
      </div>
      {subtitle && (
        <div className="text-xs text-[var(--color-text-muted)] mt-1">{subtitle}</div>
      )}
    </div>
  );
}

export default function ExecutiveWidgets({ stats }) {
  if (!stats) {
    return (
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {[0, 1, 2, 3].map(i => (
          <div key={i} className="card p-5 h-32 animate-shimmer rounded-2xl" />
        ))}
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
      <Widget
        icon={DollarSign}
        label="Total Public Funds Monitored"
        value={`₹${stats.total_funds_monitored_cr?.toLocaleString('en-IN', { maximumFractionDigits: 2 })} Crore`}
        subtitle={`${stats.total_sanctions?.toLocaleString()} sanctions across ${stats.states} states`}
        color="#1e40af"
        delay={0}
      />
      <Widget
        icon={Users}
        label="Active Cartels Detected"
        value={stats.cartel_count ?? '—'}
        subtitle="Vendor groups sharing identities"
        color="#dc2626"
        delay={80}
      />
      <Widget
        icon={ShieldAlert}
        label="High Risk Works Flagged"
        value={stats.high_risk_flags?.toLocaleString() ?? '—'}
        subtitle={`${stats.critical_flags?.toLocaleString() ?? 0} marked as critical`}
        color="#f59e0b"
        delay={160}
      />
      <Widget
        icon={AlertTriangle}
        label="Estimated Leakage Intercepted"
        value={`₹${stats.potential_leakage_prevented_cr?.toLocaleString('en-IN', { maximumFractionDigits: 2 })} Crore`}
        subtitle="Value at risk in flagged works"
        color="#059669"
        delay={240}
      />
    </div>
  );
}
