import { useState, useEffect, useMemo } from 'react';
import { BarChart3, Search, Network, Users, Target, MapPin, Filter, X } from 'lucide-react';
import Login from './components/Login';
import Header from './components/Header';
import ExecutiveWidgets from './components/ExecutiveWidgets';
import InvestigationTable from './components/InvestigationTable';
import BenfordChart from './components/BenfordChart';
import CartelGraph from './components/CartelGraph';
import CoordinatedBiddingAlerts from './components/CoordinatedBiddingAlerts';
import ConstituencyOverview from './components/ConstituencyOverview';
import SystemAccuracyCheck from './components/SystemAccuracyCheck';
import { fetchStats, fetchScore } from './api';

const TABS = [
  { id: 'investigation', label: 'Priority Investigation List', icon: Search },
  { id: 'benford', label: 'Fabricated Budget Scanner', icon: BarChart3 },
  { id: 'cartel', label: 'Shared Identity Network', icon: Network },
  { id: 'bidding', label: 'Coordinated Bidding Alerts', icon: Users },
  { id: 'constituency', label: 'Constituency Overview', icon: MapPin },
  { id: 'accuracy', label: 'System Accuracy Check', icon: Target },
];

function FilterDropdown({ label, value, options, onChange, id, disabled }) {
  return (
    <div className="flex items-center gap-2">
      <label htmlFor={id} className="text-xs font-medium text-[var(--color-text-muted)] whitespace-nowrap">{label}</label>
      <select
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        className="text-sm px-3 py-1.5 rounded-lg bg-white border border-[var(--color-border)]
                   focus:outline-none focus:ring-2 focus:ring-[var(--color-brand-light)] focus:border-transparent
                   transition-all duration-200 disabled:opacity-40 disabled:cursor-not-allowed
                   min-w-[140px] cursor-pointer appearance-none"
        style={{
          backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='16' height='16' viewBox='0 0 24 24' fill='none' stroke='%2394a3b8' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpolyline points='6 9 12 15 18 9'%3E%3C/polyline%3E%3C/svg%3E")`,
          backgroundRepeat: 'no-repeat',
          backgroundPosition: 'right 8px center',
          paddingRight: '28px'
        }}
      >
        <option value="">All</option>
        {options.map(opt => (
          <option key={opt} value={opt}>{opt}</option>
        ))}
      </select>
    </div>
  );
}

export default function App() {
  // ── Auth State ──
  const [user, setUser] = useState(() => {
    try {
      const saved = sessionStorage.getItem('sentinel_session');
      return saved ? JSON.parse(saved) : null;
    } catch { return null; }
  });

  // ── App State ──
  const [activeTab, setActiveTab] = useState('investigation');
  const [stats, setStats] = useState(null);
  const [records, setRecords] = useState(null);
  const [loading, setLoading] = useState(true);
  const [selectedMP, setSelectedMP] = useState(null);

  // ── Global Filter State ──
  const [filterState, setFilterState] = useState('');
  const [filterDistrict, setFilterDistrict] = useState('');
  const [filterVendor, setFilterVendor] = useState('');

  useEffect(() => {
    if (!user) return;
    (async () => {
      setLoading(true);
      try {
        const [statsData, scoreData] = await Promise.all([fetchStats(), fetchScore()]);
        setStats(statsData);
        setRecords(scoreData.register || []);
      } catch (err) {
        console.error('Data load error:', err);
      }
      setLoading(false);
    })();
  }, [user]);

  // ── Derived filter options ──
  const stateOptions = useMemo(() => {
    if (!stats?.by_state) return [];
    return stats.by_state.map(s => s.state).sort();
  }, [stats]);

  const districtOptions = useMemo(() => {
    if (!records || !filterState) return [];
    const districts = new Set();
    records.forEach(r => {
      if (r.state === filterState && r.district) districts.add(r.district);
    });
    return Array.from(districts).sort();
  }, [records, filterState]);

  const vendorOptions = useMemo(() => {
    if (!records) return [];
    const vendors = new Set();
    records.forEach(r => {
      if (filterState && r.state !== filterState) return;
      if (filterDistrict && r.district !== filterDistrict) return;
      if (r.vendor_name) vendors.add(r.vendor_name);
    });
    return Array.from(vendors).sort();
  }, [records, filterState, filterDistrict]);

  // ── Filtered records ──
  const filteredRecords = useMemo(() => {
    if (!records) return null;
    let filtered = records;
    if (filterState) filtered = filtered.filter(r => r.state === filterState);
    if (filterDistrict) filtered = filtered.filter(r => r.district === filterDistrict);
    if (filterVendor) filtered = filtered.filter(r => r.vendor_name === filterVendor);
    return filtered;
  }, [records, filterState, filterDistrict, filterVendor]);

  const hasActiveFilters = filterState || filterDistrict || filterVendor;

  const clearFilters = () => {
    setFilterState('');
    setFilterDistrict('');
    setFilterVendor('');
  };

  // ── Reset cascading filters ──
  useEffect(() => { setFilterDistrict(''); setFilterVendor(''); }, [filterState]);
  useEffect(() => { setFilterVendor(''); }, [filterDistrict]);

  // ── Auth Handlers ──
  const handleLogin = (userData) => setUser(userData);
  const handleLogout = () => {
    sessionStorage.removeItem('sentinel_session');
    setUser(null);
    setStats(null);
    setRecords(null);
  };

  const handleSelectMP = (mp) => {
    setSelectedMP(mp);
    setActiveTab('constituency');
  };

  const handleSelectVendor = (vendor) => {
    // Filter records to show this vendor
    if (records) {
      setFilterVendor(vendor.vendor_name);
      setActiveTab('investigation');
    }
  };

  // ── Login Screen ──
  if (!user) return <Login onLogin={handleLogin} />;

  // ── Dashboard ──
  return (
    <div className="min-h-screen bg-[var(--color-background)]">
      <Header
        user={user}
        onLogout={handleLogout}
        onSelectMP={handleSelectMP}
        onSelectVendor={handleSelectVendor}
      />

      <main className="max-w-[1440px] mx-auto px-6 py-6">
        {/* Executive Widgets */}
        <div className="mb-6">
          <ExecutiveWidgets stats={stats} />
        </div>

        {/* ── Global Filter Bar ── */}
        <div className="mb-4 card p-3">
          <div className="flex items-center gap-4 flex-wrap">
            <div className="flex items-center gap-2 text-xs font-semibold text-[var(--color-text-secondary)]">
              <Filter className="w-3.5 h-3.5" />
              Filters
            </div>
            <div className="h-5 w-px bg-[var(--color-border)]" />
            <FilterDropdown
              id="filter-state"
              label="State"
              value={filterState}
              options={stateOptions}
              onChange={setFilterState}
            />
            <FilterDropdown
              id="filter-district"
              label="District"
              value={filterDistrict}
              options={districtOptions}
              onChange={setFilterDistrict}
              disabled={!filterState}
            />
            <FilterDropdown
              id="filter-vendor"
              label="Contractor"
              value={filterVendor}
              options={vendorOptions}
              onChange={setFilterVendor}
            />
            {hasActiveFilters && (
              <>
                <div className="h-5 w-px bg-[var(--color-border)]" />
                <button onClick={clearFilters} className="btn-ghost text-xs text-[var(--color-critical)]">
                  <X className="w-3 h-3" />
                  Clear Filters
                </button>
                <span className="text-[11px] text-[var(--color-text-muted)] px-2 py-0.5 rounded-full bg-[var(--color-background-alt)]">
                  {filteredRecords?.length.toLocaleString()} of {records?.length.toLocaleString()} records
                </span>
              </>
            )}
          </div>
        </div>

        {/* Tab Navigation */}
        <div className="mb-6 overflow-x-auto">
          <div className="flex gap-1 p-1 bg-[var(--color-background-alt)] rounded-xl w-fit min-w-full md:min-w-0">
            {TABS.map(({ id, label, icon: Icon }) => (
              <button
                key={id}
                onClick={() => setActiveTab(id)}
                className={`flex items-center gap-2 px-4 py-2.5 rounded-lg text-sm font-medium whitespace-nowrap
                           transition-all duration-200 cursor-pointer
                           ${activeTab === id
                             ? 'bg-white text-[var(--color-text-primary)] shadow-sm'
                             : 'text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)]'}`}
                id={`tab-${id}`}
              >
                <Icon className="w-4 h-4" />
                {label}
              </button>
            ))}
          </div>
        </div>

        {/* Tab Content */}
        <div className="animate-fade-in" key={activeTab}>
          {activeTab === 'investigation' && (
            <div>
              <div className="flex items-center justify-between mb-4">
                <div>
                  <h2 className="text-lg font-semibold text-[var(--color-text-primary)]">
                    Priority Investigation List
                  </h2>
                  <p className="text-sm text-[var(--color-text-muted)]">
                    Ranked by risk level — highest priority cases first
                  </p>
                </div>
                {filteredRecords && (
                  <span className="text-xs text-[var(--color-text-muted)] px-3 py-1 rounded-full bg-[var(--color-background-alt)]">
                    {filteredRecords.length.toLocaleString()} total records
                  </span>
                )}
              </div>
              <InvestigationTable records={filteredRecords} />
            </div>
          )}

          {activeTab === 'benford' && (
            <div>
              <div className="mb-4">
                <h2 className="text-lg font-semibold text-[var(--color-text-primary)]">
                  Fabricated Budget Scanner
                </h2>
                <p className="text-sm text-[var(--color-text-muted)]">
                  Checks whether budget amounts follow natural number patterns or show signs of manual fabrication
                </p>
              </div>
              <BenfordChart />
            </div>
          )}

          {activeTab === 'cartel' && (
            <div>
              <div className="mb-4">
                <h2 className="text-lg font-semibold text-[var(--color-text-primary)]">
                  Shared Identity Network
                </h2>
                <p className="text-sm text-[var(--color-text-muted)]">
                  Vendors linked through shared tax identifiers, bank accounts, or company directors
                </p>
              </div>
              <CartelGraph />
            </div>
          )}

          {activeTab === 'bidding' && (
            <div>
              <div className="mb-4">
                <h2 className="text-lg font-semibold text-[var(--color-text-primary)]">
                  Coordinated Bidding Alerts
                </h2>
                <p className="text-sm text-[var(--color-text-muted)]">
                  Detects vendors who file paperwork on suspiciously similar dates, suggesting one entity controls multiple vendor identities
                </p>
              </div>
              <CoordinatedBiddingAlerts />
            </div>
          )}

          {activeTab === 'constituency' && (
            <div>
              <div className="mb-4">
                <h2 className="text-lg font-semibold text-[var(--color-text-primary)]">
                  Constituency Overview
                </h2>
                <p className="text-sm text-[var(--color-text-muted)]">
                  Detailed portfolio analysis for a selected Member of Parliament
                </p>
              </div>
              <ConstituencyOverview
                mpId={selectedMP?.mp_id}
                mpName={selectedMP?.mp_name}
              />
            </div>
          )}

          {activeTab === 'accuracy' && (
            <div>
              <div className="mb-4">
                <h2 className="text-lg font-semibold text-[var(--color-text-primary)]">
                  System Accuracy Check
                </h2>
                <p className="text-sm text-[var(--color-text-muted)]">
                  How accurately the engine detects known fraud cases in the test dataset
                </p>
              </div>
              <SystemAccuracyCheck />
            </div>
          )}
        </div>
      </main>

      {/* Footer */}
      <footer className="border-t border-[var(--color-border-light)] mt-12 py-6">
        <div className="max-w-[1440px] mx-auto px-6 flex items-center justify-between">
          <p className="text-xs text-[var(--color-text-muted)]">
            MPLADS-Sentinel Public Fund Integrity Engine · Ministry of Statistics and Programme Implementation
          </p>
          <p className="text-xs text-[var(--color-text-muted)]">
            Offline Audit Mode · No data transmitted externally
          </p>
        </div>
      </footer>
    </div>
  );
}
