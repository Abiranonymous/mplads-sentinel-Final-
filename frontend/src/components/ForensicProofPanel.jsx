import { ChevronDown, ChevronUp, AlertCircle, Eye, EyeOff } from 'lucide-react';
import { useState } from 'react';
import RiskBadge from './RiskBadge';

export default function ForensicProofPanel({ record, onClose }) {
  const [showAdvanced, setShowAdvanced] = useState(false);

  if (!record) return null;

  const reasons = record.reasons || [];
  const chips = record.reason_chips || [];
  const exifFlags = record.exif_flags || [];

  return (
    <div className="animate-slide-down border-t border-[var(--color-border-light)]">
      <div className="p-5 bg-[var(--color-background)]">
        {/* Header */}
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-semibold text-[var(--color-text-primary)] flex items-center gap-2">
            <AlertCircle className="w-4 h-4 text-[var(--color-critical)]" />
            Forensic Evidence for {record.work_id}
          </h3>
          <button onClick={onClose} className="btn-ghost text-xs">
            <ChevronUp className="w-3.5 h-3.5" />
            Collapse
          </button>
        </div>

        {/* Summary Cards */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-4">
          <div className="card p-3">
            <div className="text-xs text-[var(--color-text-muted)] mb-1">Risk Level</div>
            <RiskBadge tier={record.risk_tier} score={record.risk_score} />
          </div>
          <div className="card p-3">
            <div className="text-xs text-[var(--color-text-muted)] mb-1">Contract Amount</div>
            <div className="text-sm font-semibold">₹{Number(record.sanctioned_amount).toLocaleString('en-IN', { maximumFractionDigits: 2 })} Lakh</div>
          </div>
          <div className="card p-3">
            <div className="text-xs text-[var(--color-text-muted)] mb-1">Amount Released</div>
            <div className="text-sm font-semibold">₹{Number(record.released_amount).toLocaleString('en-IN', { maximumFractionDigits: 2 })} Lakh</div>
          </div>
        </div>

        {/* Detected Issues */}
        {chips.length > 0 && (
          <div className="mb-4">
            <div className="text-xs font-semibold text-[var(--color-text-secondary)] mb-2 uppercase tracking-wider">
              Detected Issues
            </div>
            <div className="flex flex-wrap gap-2">
              {chips.map((chip, i) => (
                <span key={i} className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium"
                      style={{ background: 'var(--color-critical-bg)', color: 'var(--color-critical)' }}>
                  {chip}
                </span>
              ))}
            </div>
          </div>
        )}

        {/* EXIF Forensic Evidence */}
        {exifFlags.length > 0 && (
          <div className="mb-4">
            <div className="text-xs font-semibold text-[var(--color-text-secondary)] mb-2 uppercase tracking-wider">
              Photo Evidence Issues
            </div>
            <div className="flex flex-wrap gap-2">
              {exifFlags.map((flag, i) => (
                <span key={i} className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium"
                      style={{ background: '#fef3c7', color: '#92400e' }}>
                  {flag === 'METADATA_TAMPERED' ? 'Photo Metadata Stripped' :
                   flag === 'GEO_MISMATCH' ? `Location Mismatch (${record.photo_distance_km?.toFixed(1)} kilometers)` : flag}
                </span>
              ))}
            </div>
          </div>
        )}

        {/* Cartel / Ring Info */}
        {(record.cartel_id || record.ring_id) && (
          <div className="mb-4">
            <div className="text-xs font-semibold text-[var(--color-text-secondary)] mb-2 uppercase tracking-wider">
              Network Connections
            </div>
            <div className="flex gap-3">
              {record.cartel_id && (
                <span className="inline-flex items-center px-3 py-1.5 rounded-lg text-xs font-medium border"
                      style={{ borderColor: 'var(--color-critical)', color: 'var(--color-critical)', background: 'var(--color-critical-bg)' }}>
                  Shared Identity Network: {record.cartel_id}
                </span>
              )}
              {record.ring_id && (
                <span className="inline-flex items-center px-3 py-1.5 rounded-lg text-xs font-medium border"
                      style={{ borderColor: '#7c3aed', color: '#7c3aed', background: '#f5f3ff' }}>
                  Coordinated Bidding: {record.ring_id}
                </span>
              )}
            </div>
          </div>
        )}

        {/* Progressive Disclosure — Advanced Details */}
        <button
          onClick={() => setShowAdvanced(!showAdvanced)}
          className="btn-ghost text-xs mt-2"
        >
          {showAdvanced ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
          {showAdvanced ? 'Hide Advanced Details' : 'Show Advanced Details'}
          {showAdvanced ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
        </button>

        {showAdvanced && (
          <div className="mt-3 animate-fade-in">
            <div className="card p-4 bg-[var(--color-background-alt)]">
              <div className="text-xs font-semibold text-[var(--color-text-secondary)] mb-2 uppercase tracking-wider">
                Detailed Engine Findings
              </div>
              {reasons.length > 0 ? (
                <ul className="space-y-1.5">
                  {reasons.map((r, i) => (
                    <li key={i} className="text-xs text-[var(--color-text-secondary)] flex items-start gap-2">
                      <span className="text-[var(--color-text-muted)] mt-0.5">•</span>
                      {r}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-xs text-[var(--color-text-muted)]">No detailed findings available.</p>
              )}
              <div className="mt-3 pt-3 border-t border-[var(--color-border-light)] grid grid-cols-2 md:grid-cols-4 gap-3 text-xs">
                <div>
                  <span className="text-[var(--color-text-muted)]">Vendor:</span>
                  <span className="ml-1 font-medium">{record.vendor_name || 'Not assigned'}</span>
                </div>
                <div>
                  <span className="text-[var(--color-text-muted)]">Category:</span>
                  <span className="ml-1 font-medium">{record.work_category || 'Unknown'}</span>
                </div>
                <div>
                  <span className="text-[var(--color-text-muted)]">Status:</span>
                  <span className="ml-1 font-medium">{record.status}</span>
                </div>
                <div>
                  <span className="text-[var(--color-text-muted)]">Sanction Date:</span>
                  <span className="ml-1 font-medium">{record.sanction_date || '—'}</span>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
