export default function RiskBadge({ tier, score }) {
  const config = {
    CRITICAL: { label: 'Critical', bg: 'var(--color-critical)', text: '#fff', bgLight: 'var(--color-critical-bg)' },
    HIGH:     { label: 'High Risk', bg: 'var(--color-high)', text: '#000', bgLight: 'var(--color-high-bg)' },
    MEDIUM:   { label: 'Needs Review', bg: 'var(--color-review)', text: '#fff', bgLight: 'var(--color-review-bg)' },
    LOW:      { label: 'Low Risk', bg: 'var(--color-low)', text: '#fff', bgLight: 'var(--color-low-bg)' },
  };
  const c = config[tier] || config.LOW;

  return (
    <span
      className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold whitespace-nowrap"
      style={{ background: c.bg, color: c.text }}
    >
      <span className="w-1.5 h-1.5 rounded-full" style={{ background: c.text, opacity: 0.6 }} />
      {c.label}
      {score !== undefined && <span className="opacity-80 font-normal">({Math.round(score)})</span>}
    </span>
  );
}
