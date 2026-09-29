import { useState, useEffect, useRef, useCallback } from 'react';
import { Search, Shield, LogOut, User, ChevronDown } from 'lucide-react';
import { searchMPs, searchVendors, fetchAllMPs, fetchAllVendors } from '../api';

function ComboBox({ icon: Icon, placeholder, searchFn, fetchAllFn, onSelect, id, displayKey }) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [allItems, setAllItems] = useState(null);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const ref = useRef(null);
  const listRef = useRef(null);
  const debounceRef = useRef(null);
  const inputRef = useRef(null);

  // Prefetch full list once for dropdown-on-focus
  useEffect(() => {
    (async () => {
      try {
        const items = await fetchAllFn();
        setAllItems(items);
      } catch { /* ignore prefetch errors */ }
    })();
  }, [fetchAllFn]);

  // Click-outside to close
  useEffect(() => {
    const handler = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  // Show full list on focus if query is empty
  const handleFocus = () => {
    if (query.trim().length < 2 && allItems && allItems.length > 0) {
      setResults(allItems);
      setOpen(true);
      setActiveIndex(-1);
    } else if (results.length > 0) {
      setOpen(true);
    }
  };

  const handleChange = (val) => {
    setQuery(val);
    setActiveIndex(-1);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (val.trim().length === 0) {
      if (allItems && allItems.length > 0) {
        setResults(allItems);
        setOpen(true);
      } else {
        setResults([]);
        setOpen(false);
      }
      return;
    }

    // Instant local filtering across the complete dataset
    const qLower = val.toLowerCase().trim();
    if (allItems && allItems.length > 0) {
      const localMatches = allItems.filter(item => {
        const name = (item[displayKey] || '').toLowerCase();
        const state = (item.state || '').toLowerCase();
        const dist = (item.district || '').toLowerCase();
        return name.includes(qLower) || state.includes(qLower) || dist.includes(qLower);
      });
      setResults(localMatches);
      setOpen(true);
    }

    // Corroborate with fuzzy backend search
    debounceRef.current = setTimeout(async () => {
      setLoading(true);
      try {
        const data = await searchFn(val);
        if (data && data.length > 0) {
          // Merge preserving unique items
          setResults(prev => {
            const seen = new Set(prev.map(p => p[displayKey]));
            const merged = [...prev];
            data.forEach(d => {
              if (!seen.has(d[displayKey])) {
                seen.add(d[displayKey]);
                merged.push(d);
              }
            });
            return merged;
          });
          setOpen(true);
        }
      } catch { /* keep local matches */ }
      setLoading(false);
    }, 200);
  };

  // Keyboard navigation
  const handleKeyDown = (e) => {
    if (!open || results.length === 0) return;
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        setActiveIndex(prev => Math.min(prev + 1, results.length - 1));
        break;
      case 'ArrowUp':
        e.preventDefault();
        setActiveIndex(prev => Math.max(prev - 1, 0));
        break;
      case 'Enter':
        e.preventDefault();
        if (activeIndex >= 0 && activeIndex < results.length) {
          selectItem(results[activeIndex]);
        }
        break;
      case 'Escape':
        setOpen(false);
        setActiveIndex(-1);
        break;
    }
  };

  // Scroll active item into view
  useEffect(() => {
    if (activeIndex >= 0 && listRef.current) {
      const el = listRef.current.children[activeIndex];
      if (el) el.scrollIntoView({ block: 'nearest' });
    }
  }, [activeIndex]);

  const selectItem = (item) => {
    onSelect(item);
    setOpen(false);
    setQuery(item[displayKey] || '');
    setActiveIndex(-1);
  };

  const listboxId = `${id}-listbox`;

  return (
    <div ref={ref} className="relative">
      <div className="relative">
        <Icon className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--color-text-muted)]" />
        <input
          ref={inputRef}
          id={id}
          type="text"
          value={query}
          onChange={(e) => handleChange(e.target.value)}
          onFocus={handleFocus}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          role="combobox"
          aria-expanded={open}
          aria-controls={listboxId}
          aria-activedescendant={activeIndex >= 0 ? `${id}-option-${activeIndex}` : undefined}
          aria-autocomplete="list"
          className="w-full pl-9 pr-8 py-2 rounded-lg text-sm bg-[var(--color-background)] border border-[var(--color-border)]
                     focus:outline-none focus:ring-2 focus:ring-[var(--color-brand-light)] focus:border-transparent
                     transition-all duration-200 placeholder:text-[var(--color-text-muted)]"
        />
        <div className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center gap-1">
          {loading && (
            <div className="w-4 h-4 border-2 border-[var(--color-brand-light)] border-t-transparent rounded-full animate-spin" />
          )}
          <ChevronDown className={`w-3.5 h-3.5 text-[var(--color-text-muted)] transition-transform duration-200 ${open ? 'rotate-180' : ''}`} />
        </div>
      </div>
      {open && (
        <div
          ref={listRef}
          id={listboxId}
          role="listbox"
          className="absolute top-full left-0 right-0 mt-1 bg-white rounded-lg shadow-xl border border-[var(--color-border-light)] z-50 max-h-80 overflow-y-auto animate-fade-in"
        >
          {results.length > 0 && (
            <div className="px-3 py-1.5 bg-slate-50 text-[11px] font-medium text-[var(--color-text-muted)] border-b border-[var(--color-border-light)] sticky top-0 z-10">
              {results.length} records available — scroll through full list
            </div>
          )}
          {results.length === 0 ? (
            <div className="px-4 py-3 text-sm text-[var(--color-text-muted)] text-center">No matches found</div>
          ) : results.map((item, i) => (
            <button
              key={i}
              id={`${id}-option-${i}`}
              role="option"
              aria-selected={i === activeIndex}
              onClick={() => selectItem(item)}
              className={`w-full text-left px-4 py-2.5 text-sm transition-colors cursor-pointer
                         border-b border-[var(--color-border-light)] last:border-b-0
                         ${i === activeIndex
                           ? 'bg-[var(--color-brand-light)]/10 text-[var(--color-brand)]'
                           : 'hover:bg-[var(--color-background)]'}`}
            >
              <span className="font-medium text-[var(--color-text-primary)]">
                {item[displayKey]}
              </span>
              {item.state && (
                <span className="text-[var(--color-text-muted)] ml-2">• {item.state}</span>
              )}
              {item.district && (
                <span className="text-[var(--color-text-muted)] ml-1">• {item.district}</span>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export default function Header({ user, onLogout, onSelectMP, onSelectVendor }) {
  return (
    <header className="sticky top-0 z-40 bg-white/80 backdrop-blur-lg border-b border-[var(--color-border-light)]">
      <div className="max-w-[1440px] mx-auto px-6 py-3">
        <div className="flex items-center gap-6">
          {/* Brand */}
          <div className="flex items-center gap-3 flex-shrink-0">
            <div className="w-9 h-9 rounded-xl flex items-center justify-center"
                 style={{ background: 'linear-gradient(135deg, #1e40af, #3b82f6)' }}>
              <Shield className="w-5 h-5 text-white" />
            </div>
            <div className="hidden md:block">
              <h1 className="text-sm font-bold text-[var(--color-text-primary)] leading-tight">
                MPLADS-Sentinel
              </h1>
              <p className="text-[11px] text-[var(--color-text-muted)] leading-tight">
                Public Fund Integrity Engine
              </p>
            </div>
          </div>

          {/* Dual Combobox Search */}
          <div className="flex-1 grid grid-cols-1 md:grid-cols-2 gap-3 max-w-2xl">
            <ComboBox
              id="search-mp"
              icon={Search}
              placeholder="Search Member of Parliament..."
              searchFn={searchMPs}
              fetchAllFn={fetchAllMPs}
              onSelect={onSelectMP}
              displayKey="mp_name"
            />
            <ComboBox
              id="search-vendor"
              icon={Search}
              placeholder="Search Contractor / Vendor..."
              searchFn={searchVendors}
              fetchAllFn={fetchAllVendors}
              onSelect={onSelectVendor}
              displayKey="vendor_name"
            />
          </div>

          {/* User */}
          <div className="flex items-center gap-3 flex-shrink-0">
            <div className="hidden lg:flex items-center gap-2 text-sm">
              <div className="w-7 h-7 rounded-full bg-[var(--color-brand)] flex items-center justify-center">
                <User className="w-3.5 h-3.5 text-white" />
              </div>
              <span className="text-[var(--color-text-secondary)] font-medium">
                {user?.displayName || 'Auditor'}
              </span>
            </div>
            <button onClick={onLogout} className="btn-ghost text-xs" id="logout-button">
              <LogOut className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Sign Out</span>
            </button>
          </div>
        </div>
      </div>
    </header>
  );
}
