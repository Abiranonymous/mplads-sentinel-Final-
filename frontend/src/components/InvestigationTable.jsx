import { useState } from 'react';
import { Sparkles, FileSearch2, ChevronLeft, ChevronRight, Loader2 } from 'lucide-react';
import RiskBadge from './RiskBadge';
import AIBriefingModal from './AIBriefingModal';
import ForensicProofPanel from './ForensicProofPanel';
import { fetchBriefing } from '../api';

const PAGE_SIZE = 15;

export default function InvestigationTable({ records }) {
  const [page, setPage] = useState(0);
  const [briefingState, setBriefingState] = useState({ open: false, workId: null, text: null, loading: false, error: null });
  const [expandedRow, setExpandedRow] = useState(null);

  if (!records || records.length === 0) {
    return (
      <div className="card p-12 text-center">
        <p className="text-sm text-[var(--color-text-muted)]">No records match the current filters.</p>
      </div>
    );
  }

  const totalPages = Math.ceil(records.length / PAGE_SIZE);
  const paged = records.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);

  const handleBriefing = async (workId) => {
    setBriefingState({ open: true, workId, text: null, loading: true, error: null });
    try {
      const data = await fetchBriefing(workId);
      setBriefingState({ open: true, workId, text: data.briefing, loading: false, error: null });
    } catch (err) {
      setBriefingState({ open: true, workId, text: null, loading: false, error: err.message });
    }
  };

  const handleForensic = (record) => {
    setExpandedRow(expandedRow === record.work_id ? null : record.work_id);
  };

  return (
    <div>
      {/* Table */}
      <div className="card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-[var(--color-border-light)]">
                <th className="text-left px-5 py-3 text-xs font-semibold text-[var(--color-text-muted)] uppercase tracking-wider">Work Identifier</th>
                <th className="text-left px-5 py-3 text-xs font-semibold text-[var(--color-text-muted)] uppercase tracking-wider">Vendor Name</th>
                <th className="text-left px-5 py-3 text-xs font-semibold text-[var(--color-text-muted)] uppercase tracking-wider">State</th>
                <th className="text-right px-5 py-3 text-xs font-semibold text-[var(--color-text-muted)] uppercase tracking-wider">Contract Amount</th>
                <th className="text-center px-5 py-3 text-xs font-semibold text-[var(--color-text-muted)] uppercase tracking-wider">Risk Level</th>
                <th className="text-right px-5 py-3 text-xs font-semibold text-[var(--color-text-muted)] uppercase tracking-wider">Actions</th>
              </tr>
            </thead>
            <tbody>
              {paged.map((rec, i) => (
                <tr key={rec.work_id} className="group">
                  <td colSpan="6" className="p-0">
                    <div>
                      <div className={`grid items-center border-b border-[var(--color-border-light)]
                                       hover:bg-[var(--color-background)] transition-colors duration-150
                                       ${expandedRow === rec.work_id ? 'bg-[var(--color-background)]' : ''}`}
                           style={{ gridTemplateColumns: 'minmax(140px, 1fr) minmax(140px, 1.5fr) minmax(80px, 0.8fr) minmax(120px, 1fr) minmax(100px, 0.8fr) minmax(200px, auto)' }}>

                        <div className="px-5 py-3.5 text-sm font-mono text-[var(--color-text-primary)]">
                          {rec.work_id}
                        </div>
                        <div className="px-5 py-3.5 text-sm text-[var(--color-text-primary)]">
                          {rec.vendor_name || <span className="text-[var(--color-text-muted)] italic">Not assigned</span>}
                        </div>
                        <div className="px-5 py-3.5 text-sm text-[var(--color-text-secondary)]">
                          {rec.state}
                        </div>
                        <div className="px-5 py-3.5 text-sm text-right font-medium text-[var(--color-text-primary)]">
                          ₹{Number(rec.sanctioned_amount).toLocaleString('en-IN', { maximumFractionDigits: 2 })} Lakh
                        </div>
                        <div className="px-5 py-3.5 text-center">
                          <RiskBadge tier={rec.risk_tier} score={rec.risk_score} />
                        </div>
                        <div className="px-5 py-3.5 text-right flex items-center justify-end gap-2">
                          <button
                            onClick={() => handleBriefing(rec.work_id)}
                            className="btn-secondary text-xs"
                            id={`briefing-${rec.work_id}`}
                          >
                            <Sparkles className="w-3.5 h-3.5" />
                            Generate AI Briefing
                          </button>
                          <button
                            onClick={() => handleForensic(rec)}
                            className={`btn-ghost text-xs ${expandedRow === rec.work_id ? 'bg-[var(--color-background-alt)]' : ''}`}
                            id={`forensic-${rec.work_id}`}
                          >
                            <FileSearch2 className="w-3.5 h-3.5" />
                            View Forensic Proof
                          </button>
                        </div>
                      </div>

                      {/* Expanded Forensic Panel */}
                      {expandedRow === rec.work_id && (
                        <ForensicProofPanel
                          record={rec}
                          onClose={() => setExpandedRow(null)}
                        />
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        <div className="flex items-center justify-between px-5 py-3 border-t border-[var(--color-border-light)]">
          <span className="text-xs text-[var(--color-text-muted)]">
            Showing {page * PAGE_SIZE + 1} to {Math.min((page + 1) * PAGE_SIZE, records.length)} of {records.length.toLocaleString()} records
          </span>
          <div className="flex items-center gap-1">
            <button
              onClick={() => setPage(Math.max(0, page - 1))}
              disabled={page === 0}
              className="btn-ghost text-xs disabled:opacity-30 disabled:cursor-not-allowed"
            >
              <ChevronLeft className="w-3.5 h-3.5" />
              Previous
            </button>
            <span className="text-xs text-[var(--color-text-secondary)] px-3">
              Page {page + 1} of {totalPages}
            </span>
            <button
              onClick={() => setPage(Math.min(totalPages - 1, page + 1))}
              disabled={page >= totalPages - 1}
              className="btn-ghost text-xs disabled:opacity-30 disabled:cursor-not-allowed"
            >
              Next
              <ChevronRight className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      </div>

      {/* AI Briefing Modal */}
      {briefingState.open && (
        <AIBriefingModal
          workId={briefingState.workId}
          briefing={briefingState.text}
          loading={briefingState.loading}
          error={briefingState.error}
          onClose={() => setBriefingState({ open: false })}
        />
      )}
    </div>
  );
}
