'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL || 'http://localhost:5000';
const KHANAN_PORTAL_ENTRY =
  process.env.NEXT_PUBLIC_SCRAPING_URL || 'https://khanansoft.bihar.gov.in/portal/CitizenRpt/epassreportAllDist.aspx';

const SCRAPE_MAX_RANGE_DAYS = (() => {
  const n = Number.parseInt(process.env.NEXT_PUBLIC_SCRAPE_MAX_RANGE_DAYS || '31', 10);
  return Number.isFinite(n) && n > 0 ? n : 31;
})();

function inclusiveDayCount(fromIso: string, toIso: string): number {
  const a = new Date(`${fromIso}T12:00:00`);
  const b = new Date(`${toIso}T12:00:00`);
  if (Number.isNaN(a.getTime()) || Number.isNaN(b.getTime())) return Number.NaN;
  return Math.abs(Math.round((b.getTime() - a.getTime()) / (24 * 60 * 60 * 1000))) + 1;
}

interface KhananStats {
  totalRecords: number;
  totalQuantity: number;
  districtCount: number;
  mineralCount: number;
  uniqueVehicleCount: number;
}

interface RunStatsShape {
  mode?: string;
  fromDate?: string | null;
  toDate?: string | null;
  startedAt?: string | null;
  endedAt?: string | null;
  success?: boolean | null;
  insertedCount?: number;
  duplicateSkipped?: number;
  error?: string | null;
}

interface ScraperStatus {
  running: boolean;
  details: string;
  lastRun?: RunStatsShape | null;
  liveRun?: RunStatsShape | null;
  stopRequested?: boolean;
}

interface DashboardToast {
  id: number;
  type: 'success' | 'error' | 'info';
  message: string;
}

const STAT_CARD_COLORS = ['text-blue-400', 'text-green-400', 'text-amber-400', 'text-purple-400', 'text-cyan-400'];

const WIPE_SCRAPE_CONFIRM = 'WIPE_KHANAN_SCRAPE_DATA';

interface KhananRowBrief {
  id?: string;
  _id?: string;
  challanNo?: string;
  district?: string;
  date?: string;
  consignerName?: string;
  mineralName?: string;
  sourceType?: string;
}

export default function KhananSoftPage() {
  const [stats, setStats] = useState<KhananStats | null>(null);
  const [scraperStatus, setScraperStatus] = useState<ScraperStatus | null>(null);
  const [hasSession, setHasSession] = useState(false);
  const [loading, setLoading] = useState(true);
  const [scraping, setScraping] = useState(false);
  const [rangeScraping, setRangeScraping] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [districts, setDistricts] = useState<string[]>([]);
  const [minerals, setMinerals] = useState<string[]>([]);
  const [previewCount, setPreviewCount] = useState<number | null>(null);
  const [toasts, setToasts] = useState<DashboardToast[]>([]);
  const [lastPollAt, setLastPollAt] = useState<string | null>(null);
  const [filters, setFilters] = useState({
    fromDate: '',
    toDate: '',
    district: '',
    mineral: '',
  });
  const [error, setError] = useState<string | null>(null);
  const [stopSubmitting, setStopSubmitting] = useState(false);
  const [wipeConfirmInput, setWipeConfirmInput] = useState('');
  const [wipeVehicleSummaries, setWipeVehicleSummaries] = useState(false);
  const [wipeLoading, setWipeLoading] = useState(false);
  const [inspectRows, setInspectRows] = useState<KhananRowBrief[]>([]);
  const [inspectLoading, setInspectLoading] = useState(false);
  const [inspectDetail, setInspectDetail] = useState<Record<string, unknown> | null>(null);
  const [inspectDetailLoading, setInspectDetailLoading] = useState(false);

  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const prevEngineRunning = useRef(false);

  const engineRunning = Boolean(scraperStatus?.running);
  const rangeDayCount =
    filters.fromDate && filters.toDate ? inclusiveDayCount(filters.fromDate, filters.toDate) : null;
  const canRunRange =
    Boolean(filters.fromDate && filters.toDate) &&
    rangeDayCount != null &&
    !Number.isNaN(rangeDayCount) &&
    rangeDayCount <= SCRAPE_MAX_RANGE_DAYS;
  const rangeValidationMessage =
    filters.fromDate && filters.toDate
      ? rangeDayCount == null || Number.isNaN(rangeDayCount)
        ? 'Date range invalid'
        : rangeDayCount > SCRAPE_MAX_RANGE_DAYS
          ? `Max ${SCRAPE_MAX_RANGE_DAYS} days allowed`
          : null
      : null;

  const pushToast = useCallback((type: DashboardToast['type'], message: string) => {
    const id = Date.now() + Math.floor(Math.random() * 1000);
    setToasts((prev) => [...prev, { id, type, message }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 4500);
  }, []);

  const buildFilterParams = useCallback(() => {
    const params = new URLSearchParams();
    if (filters.fromDate) params.set('fromDate', filters.fromDate);
    if (filters.toDate) params.set('toDate', filters.toDate);
    if (filters.district) params.set('district', filters.district);
    if (filters.mineral) params.set('mineralName', filters.mineral);
    return params;
  }, [filters]);

  const fetchStats = useCallback(
    async (token: string) => {
      const statsParams = new URLSearchParams();
      if (filters.fromDate) statsParams.set('fromDate', filters.fromDate);
      if (filters.toDate) statsParams.set('toDate', filters.toDate);
      const response = await fetch(`${API_BASE_URL}/api/khanan/stats?${statsParams.toString()}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (response.ok) {
        const data = await response.json();
        setStats(data);
      } else if (response.status === 401) {
        localStorage.removeItem('spybot_token');
        setHasSession(false);
        setError('Session expired. Sign in again.');
      } else {
        setError('Could not load stats.');
      }
    },
    [filters.fromDate, filters.toDate]
  );

  const fetchFilterOptions = useCallback(async (token: string) => {
    const [districtRes, mineralRes] = await Promise.all([
      fetch(`${API_BASE_URL}/api/khanan/districts`, { headers: { Authorization: `Bearer ${token}` } }),
      fetch(`${API_BASE_URL}/api/khanan/minerals`, { headers: { Authorization: `Bearer ${token}` } }),
    ]);
    if (districtRes.ok) {
      const data = await districtRes.json();
      setDistricts(Array.isArray(data.districts) ? data.districts : []);
    }
    if (mineralRes.ok) {
      const data = await mineralRes.json();
      setMinerals(Array.isArray(data.minerals) ? data.minerals : []);
    }
  }, []);

  const fetchFilteredPreview = useCallback(
    async (token: string) => {
      const params = buildFilterParams();
      params.set('page', '1');
      params.set('limit', '1');
      const response = await fetch(`${API_BASE_URL}/api/khanan/data?${params.toString()}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (response.ok) {
        const data = await response.json();
        const total = Number(data?.pagination?.total);
        setPreviewCount(Number.isFinite(total) ? total : null);
      }
    },
    [buildFilterParams]
  );

  const fetchScraperStatus = useCallback(async (token: string) => {
    const response = await fetch(`${API_BASE_URL}/api/selenium/status`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (response.ok) {
      const data = await response.json();
      setScraperStatus(data);
      setLastPollAt(new Date().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', second: '2-digit' }));
    } else if (response.status === 401) {
      localStorage.removeItem('spybot_token');
      setHasSession(false);
      setError('Session expired. Sign in again.');
    }
  }, []);

  const loadAll = useCallback(async () => {
    const token = localStorage.getItem('spybot_token');
    if (!token) return;
    setSyncing(true);
    setError(null);
    try {
      await Promise.all([fetchStats(token), fetchScraperStatus(token), fetchFilterOptions(token), fetchFilteredPreview(token)]);
    } finally {
      setSyncing(false);
    }
  }, [fetchStats, fetchScraperStatus, fetchFilterOptions, fetchFilteredPreview]);

  useEffect(() => {
    let cancelled = false;
    const init = async () => {
      const token = localStorage.getItem('spybot_token');
      if (!token) {
        if (!cancelled) {
          setError('Please sign in.');
          setLoading(false);
        }
        return;
      }
      setHasSession(true);
      setSyncing(true);
      setError(null);
      try {
        await Promise.all([fetchStats(token), fetchScraperStatus(token), fetchFilterOptions(token), fetchFilteredPreview(token)]);
      } finally {
        if (!cancelled) {
          setSyncing(false);
          setLoading(false);
        }
      }
    };
    void init();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mount-only bootstrap
  }, []);

  const needsPoll = engineRunning || scraping || rangeScraping;
  const pollMs = needsPoll ? 2000 : 4000;

  useEffect(() => {
    if (!hasSession) return;
    if (!needsPoll) {
      if (pollRef.current) {
        clearInterval(pollRef.current);
        pollRef.current = null;
      }
      return;
    }
    const tick = () => {
      const token = localStorage.getItem('spybot_token');
      if (!token) return;
      void Promise.all([fetchScraperStatus(token), fetchStats(token), fetchFilteredPreview(token)]);
    };
    tick();
    pollRef.current = setInterval(tick, pollMs);
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
      pollRef.current = null;
    };
  }, [needsPoll, hasSession, pollMs, fetchScraperStatus, fetchStats, fetchFilteredPreview]);

  useEffect(() => {
    if (!hasSession) return;
    if (prevEngineRunning.current && !engineRunning) {
      void loadAll();
    }
    prevEngineRunning.current = engineRunning;
  }, [engineRunning, hasSession, loadAll]);

  const lastRunDisplay = useMemo(() => {
    const lr = scraperStatus?.lastRun;
    if (!lr) return '—';
    const ts = lr.endedAt || lr.startedAt;
    if (!ts) return '—';
    const d = new Date(ts);
    if (Number.isNaN(d.getTime())) return '—';
    return d.toLocaleString('en-IN');
  }, [scraperStatus?.lastRun]);

  const live = scraperStatus?.liveRun;
  const last = scraperStatus?.lastRun;

  const startTodayScrape = async () => {
    if (scraping || rangeScraping || engineRunning) return;
    const token = localStorage.getItem('spybot_token');
    if (!token) return;
    setScraping(true);
    try {
      const response = await fetch(`${API_BASE_URL}/api/selenium/dailyScraping`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = (await response.json().catch(() => ({}))) as { error?: string };
      if (response.ok) {
        pushToast('success', 'Khanan Soft scrape started for today (all districts → drill-down challans).');
        void fetchScraperStatus(token);
      } else if (response.status === 409) {
        pushToast('error', typeof data.error === 'string' ? data.error : 'Scraper already running.');
      } else {
        pushToast('error', typeof data.error === 'string' ? data.error : 'Could not start scrape.');
      }
    } catch {
      pushToast('error', 'Request failed.');
    } finally {
      setScraping(false);
    }
  };

  const fetchInspectRows = async () => {
    const token = localStorage.getItem('spybot_token');
    if (!token) return;
    setInspectLoading(true);
    try {
      const params = buildFilterParams();
      params.set('page', '1');
      params.set('limit', '25');
      const response = await fetch(`${API_BASE_URL}/api/khanan/data?${params.toString()}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (response.ok) {
        const data = await response.json();
        setInspectRows(Array.isArray(data.data) ? data.data : []);
      } else {
        pushToast('error', 'Could not load rows for inspection.');
      }
    } finally {
      setInspectLoading(false);
    }
  };

  const openInspectDetail = async (id: string) => {
    const token = localStorage.getItem('spybot_token');
    if (!token) return;
    setInspectDetail(null);
    setInspectDetailLoading(true);
    try {
      const response = await fetch(`${API_BASE_URL}/api/khanan/record/${encodeURIComponent(id)}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (response.ok) {
        const data = await response.json();
        setInspectDetail((data?.record && typeof data.record === 'object' ? data.record : null) as Record<string, unknown> | null);
      } else {
        pushToast('error', 'Record not found or failed to load.');
      }
    } finally {
      setInspectDetailLoading(false);
    }
  };

  const executeWipeScrapedData = async () => {
    if (wipeConfirmInput !== WIPE_SCRAPE_CONFIRM) {
      pushToast('error', `Type exactly: ${WIPE_SCRAPE_CONFIRM}`);
      return;
    }
    if (busy) {
      pushToast('error', 'Stop scraper first, then wipe.');
      return;
    }
    const token = localStorage.getItem('spybot_token');
    if (!token) return;
    setWipeLoading(true);
    try {
      const response = await fetch(`${API_BASE_URL}/api/khanan/wipe-scraped-data`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          confirm: WIPE_SCRAPE_CONFIRM,
          wipeVehicleSummaries: wipeVehicleSummaries,
        }),
      });
      const data = (await response.json().catch(() => ({}))) as {
        error?: string;
        deletedKhananRows?: number;
        deletedVehicleSummaries?: number;
      };
      if (response.ok) {
        pushToast(
          'success',
          `Wiped: ${data.deletedKhananRows ?? 0} khanan rows; vehicle summaries: ${data.deletedVehicleSummaries ?? 0}.`
        );
        setWipeConfirmInput('');
        setInspectRows([]);
        setInspectDetail(null);
        void loadAll();
      } else {
        pushToast('error', typeof data.error === 'string' ? data.error : 'Wipe failed.');
      }
    } catch {
      pushToast('error', 'Wipe request failed.');
    } finally {
      setWipeLoading(false);
    }
  };

  const requestStopScrape = async () => {
    if (!engineRunning || stopSubmitting) return;
    const token = localStorage.getItem('spybot_token');
    if (!token) return;
    setStopSubmitting(true);
    try {
      const response = await fetch(`${API_BASE_URL}/api/selenium/stop`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = (await response.json().catch(() => ({}))) as { error?: string; message?: string };
      if (response.ok) {
        pushToast('info', typeof data.message === 'string' ? data.message : 'Stop requested.');
        void fetchScraperStatus(token);
      } else {
        pushToast('error', typeof data.error === 'string' ? data.error : 'Stop request failed.');
      }
    } catch {
      pushToast('error', 'Stop request failed.');
    } finally {
      setStopSubmitting(false);
    }
  };

  const executeRangeScrape = async () => {
    if (rangeScraping || scraping || engineRunning) return;
    const token = localStorage.getItem('spybot_token');
    if (!token) return;
    setRangeScraping(true);
    try {
      const response = await fetch(`${API_BASE_URL}/api/selenium/scrape-range`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          fromDate: filters.fromDate,
          toDate: filters.toDate,
        }),
      });
      const data = (await response.json().catch(() => ({}))) as { error?: string; dayCount?: number };
      if (response.ok) {
        const n = data.dayCount;
        pushToast(
          'success',
          typeof n === 'number' ? `Range scrape started (${n} calendar day${n === 1 ? '' : 's'}).` : 'Range scrape started.'
        );
        void fetchScraperStatus(token);
      } else if (response.status === 409) {
        pushToast('error', typeof data.error === 'string' ? data.error : 'Scraper already running.');
      } else if (response.status === 400) {
        pushToast('error', typeof data.error === 'string' ? data.error : 'Invalid range.');
      } else {
        pushToast('error', typeof data.error === 'string' ? data.error : `Failed (${response.status}).`);
      }
    } catch {
      pushToast('error', 'Range request failed.');
    } finally {
      setRangeScraping(false);
    }
  };

  const requestRangeScrape = () => {
    if (!filters.fromDate || !filters.toDate) {
      pushToast('info', 'Set From and To dates first.');
      return;
    }
    const dayCount = inclusiveDayCount(filters.fromDate, filters.toDate);
    if (Number.isNaN(dayCount)) {
      pushToast('error', 'Invalid date range.');
      return;
    }
    if (dayCount > SCRAPE_MAX_RANGE_DAYS) {
      pushToast('error', `Range is ${dayCount} days; max ${SCRAPE_MAX_RANGE_DAYS}.`);
      return;
    }
    void executeRangeScrape();
  };

  const applyQuickRange = (days: 0 | 7 | 30) => {
    const today = new Date();
    const to = today.toISOString().slice(0, 10);
    if (days === 0) {
      setFilters((prev) => ({ ...prev, fromDate: to, toDate: to }));
      return;
    }
    const fromDate = new Date(today);
    fromDate.setDate(today.getDate() - days);
    const from = fromDate.toISOString().slice(0, 10);
    setFilters((prev) => ({ ...prev, fromDate: from, toDate: to }));
  };

  const clearFilters = () => {
    setFilters({ fromDate: '', toDate: '', district: '', mineral: '' });
    setPreviewCount(null);
  };

  const busy = scraping || rangeScraping || engineRunning;
  const stopQueued = Boolean(scraperStatus?.stopRequested);

  const cardStats = useMemo(() => {
    if (!stats) return [];
    return [
      { label: 'Records', value: stats.totalRecords },
      { label: 'Districts', value: stats.districtCount },
      { label: 'Minerals', value: stats.mineralCount },
      { label: 'Unique vehicles', value: stats.uniqueVehicleCount },
      { label: 'Total qty (MT)', value: Number(stats.totalQuantity?.toFixed?.(2) ?? stats.totalQuantity) },
    ];
  }, [stats]);

  if (loading) {
    return (
      <div className="mx-auto w-full max-w-[1500px] space-y-6 pb-10">
        <div className="h-36 animate-pulse rounded-3xl border border-[#1f2937] bg-[#0b0f16]" />
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-5">
          {[0, 1, 2, 3, 4].map((k) => (
            <div key={k} className="h-24 animate-pulse rounded-xl border border-[#1f2937] bg-[#0b0f16]" />
          ))}
        </div>
      </div>
    );
  }

  if (!hasSession) {
    return (
      <div className="mx-auto max-w-md rounded-2xl border border-[#1f2937] bg-[#0b0f16] p-10 text-center">
        <h1 className="text-lg font-semibold text-white">Sign in required</h1>
        <p className="mt-2 text-sm text-slate-400">Use SpyBot login to open Khanan Soft.</p>
        {error && <p className="mt-4 text-sm text-red-300">{error}</p>}
        <Link
          href="/login"
          className="mt-6 inline-flex items-center rounded-xl border border-indigo-500/40 bg-indigo-500/15 px-6 py-2 text-sm font-semibold text-indigo-100 transition hover:bg-indigo-500/25"
        >
          Go to login
        </Link>
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-[1500px] space-y-8 pb-10">
      <div className="fixed right-4 top-4 z-50 space-y-2">
        {toasts.map((toast) => (
          <div
            key={toast.id}
            className={`min-w-[260px] rounded-xl border px-4 py-3 text-sm shadow-lg ${
              toast.type === 'success'
                ? 'border-green-500/40 bg-green-500/10 text-green-100'
                : toast.type === 'error'
                  ? 'border-red-500/40 bg-red-500/10 text-red-100'
                  : 'border-indigo-500/40 bg-indigo-500/10 text-indigo-100'
            }`}
          >
            {toast.message}
          </div>
        ))}
      </div>

      {error && (
        <section className="rounded-2xl border border-red-500/30 bg-red-500/10 p-4 md:p-5">
          <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <div className="flex items-start gap-3">
              <svg className="mt-0.5 h-5 w-5 text-red-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v4m0 4h.01M3.055 11a9 9 0 1117.89 0 9 9 0 01-17.89 0z" />
              </svg>
              <div>
                <p className="text-sm font-semibold text-red-200">Khanan module error</p>
                <p className="text-sm text-red-300">{error}</p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => void loadAll()}
              className="inline-flex items-center rounded-lg border border-red-400/40 bg-red-500/20 px-4 py-2 text-sm font-medium text-red-100 transition hover:bg-red-500/30"
            >
              Retry
            </button>
          </div>
        </section>
      )}

      <section className="relative overflow-hidden rounded-3xl border border-[#1f2937] bg-gradient-to-br from-[#0d1020] via-[#0b0f16] to-[#05070a] p-6 md:p-8">
        <div className="pointer-events-none absolute -right-20 -top-20 h-64 w-64 rounded-full bg-indigo-600/10 blur-3xl" />
        <div className="pointer-events-none absolute -bottom-10 left-10 h-40 w-40 rounded-full bg-blue-600/8 blur-2xl" style={{ animationDelay: '2s' }} />
        <div className="relative flex flex-col gap-5 md:flex-row md:items-end md:justify-between">
          <div>
            <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.25em] text-indigo-400">External Tools</p>
            <h1 className="mb-1 bg-gradient-to-r from-white via-indigo-100 to-indigo-400 bg-clip-text text-4xl font-extrabold tracking-tight text-transparent md:text-5xl">
              Khanan Soft
            </h1>
            <p className="text-sm font-medium tracking-wide text-slate-400">
              Full Bihar Khanan Soft e‑pass pipeline (district grid → consigner → challan lines).{' '}
              <span className="text-slate-300">MCA / ministry company data is not used anywhere here.</span>
            </p>
            <p className="mt-2 max-w-3xl break-all text-xs text-slate-500">
              Source entry:{' '}
              <a href={KHANAN_PORTAL_ENTRY} target="_blank" rel="noreferrer" className="text-indigo-300 underline hover:text-indigo-200">
                {KHANAN_PORTAL_ENTRY}
              </a>
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => void loadAll()}
              disabled={syncing || busy}
              className="inline-flex items-center gap-2 rounded-xl border border-indigo-500/40 bg-indigo-500/15 px-4 py-2 text-xs font-semibold text-indigo-100 transition hover:bg-indigo-500/25 disabled:opacity-60"
            >
              {syncing ? (
                <>
                  <svg className="h-3.5 w-3.5 animate-spin" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582M20 20v-5h-.581M5.341 15A8 8 0 0018.66 9M18.659 9A8 8 0 005.34 15" />
                  </svg>
                  Refresh
                </>
              ) : (
                <>
                  <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582M20 20v-5h-.581M5.341 15A8 8 0 0018.66 9M18.659 9A8 8 0 005.34 15" />
                  </svg>
                  Refresh
                </>
              )}
            </button>
          </div>
        </div>
      </section>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-5">
        {cardStats.map((card, index) => (
          <div key={card.label} className="rounded-xl border border-spy-border bg-spy-surface-primary p-4">
            <div className={`text-center text-3xl font-semibold ${STAT_CARD_COLORS[index % STAT_CARD_COLORS.length]}`}>
              {typeof card.value === 'number' ? card.value.toLocaleString() : card.value}
            </div>
            <div className="text-center text-sm text-spy-text-secondary">{card.label}</div>
          </div>
        ))}
      </div>

      <div className="rounded-xl border border-spy-border bg-spy-surface-primary p-4 md:p-5">
        <p className="text-sm font-medium text-spy-text-primary">Portal flow (organized → DB)</p>
        <p className="mt-1 text-xs text-spy-text-secondary">
          Scraper har date ke liye neeche wale steps follow karta hai; har row DB mein same columns mein save hoti hai (
          <code className="text-spy-text-primary">challan_no</code> unique).
        </p>
        <ol className="mt-3 list-decimal space-y-2 pl-5 text-sm text-spy-text-secondary">
          <li>
            <span className="text-spy-text-primary">All districts summary</span> —{' '}
            <code className="text-xs text-indigo-300">epassreportAllDist.aspx</code> (Lessee / Dealer &quot;No. Of Pass&quot; links)
          </li>
          <li>
            <span className="text-spy-text-primary">All consigners (district + source)</span> —{' '}
            <code className="text-xs text-indigo-300">ePassReportAllConsigner.aspx</code>
          </li>
          <li>
            <span className="text-spy-text-primary">By consigner / mineral</span> —{' '}
            <code className="text-xs text-indigo-300">ePassRptByConsigner.aspx</code> (&quot;No. Of Challan&quot; links)
          </li>
          <li>
            <span className="text-spy-text-primary">Challan lines</span> —{' '}
            <code className="text-xs text-indigo-300">ePassRptChallansDetail.aspx</code> (View All → table → DB insert)
          </li>
        </ol>
      </div>

      <div className="rounded-xl border border-spy-border bg-spy-surface-primary p-4">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <p className="text-sm font-medium text-spy-text-primary">Filters</p>
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={() => applyQuickRange(0)} className="rounded-md border border-spy-border px-3 py-1.5 text-xs text-spy-text-secondary hover:bg-spy-surface-deep">
              Today
            </button>
            <button type="button" onClick={() => applyQuickRange(7)} className="rounded-md border border-spy-border px-3 py-1.5 text-xs text-spy-text-secondary hover:bg-spy-surface-deep">
              Last 7d
            </button>
            <button type="button" onClick={() => applyQuickRange(30)} className="rounded-md border border-spy-border px-3 py-1.5 text-xs text-spy-text-secondary hover:bg-spy-surface-deep">
              Last 30d
            </button>
          </div>
        </div>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-4">
          <label className="text-xs text-spy-text-secondary">
            From
            <input
              type="date"
              value={filters.fromDate}
              onChange={(e) => setFilters((p) => ({ ...p, fromDate: e.target.value }))}
              className="mt-1 w-full rounded-md border border-spy-border bg-spy-surface-deep px-3 py-2 text-sm text-spy-text-primary outline-none"
            />
          </label>
          <label className="text-xs text-spy-text-secondary">
            To
            <input
              type="date"
              value={filters.toDate}
              onChange={(e) => setFilters((p) => ({ ...p, toDate: e.target.value }))}
              className="mt-1 w-full rounded-md border border-spy-border bg-spy-surface-deep px-3 py-2 text-sm text-spy-text-primary outline-none"
            />
          </label>
          <label className="text-xs text-spy-text-secondary">
            District
            <select
              value={filters.district}
              onChange={(e) => setFilters((p) => ({ ...p, district: e.target.value }))}
              className="mt-1 w-full rounded-md border border-spy-border bg-spy-surface-deep px-3 py-2 text-sm text-spy-text-primary outline-none"
            >
              <option value="">All</option>
              {districts.map((d) => (
                <option key={d} value={d}>
                  {d}
                </option>
              ))}
            </select>
          </label>
          <label className="text-xs text-spy-text-secondary">
            Mineral
            <select
              value={filters.mineral}
              onChange={(e) => setFilters((p) => ({ ...p, mineral: e.target.value }))}
              className="mt-1 w-full rounded-md border border-spy-border bg-spy-surface-deep px-3 py-2 text-sm text-spy-text-primary outline-none"
            >
              <option value="">All</option>
              {minerals.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => void loadAll()}
            disabled={syncing}
            className="rounded-md border border-spy-border bg-spy-surface-deep px-4 py-2 text-sm font-medium text-spy-text-primary hover:bg-spy-surface-primary disabled:opacity-50"
          >
            {syncing ? 'Applying…' : 'Apply filters'}
          </button>
          <button type="button" onClick={clearFilters} className="rounded-md border border-spy-border px-4 py-2 text-sm text-spy-text-secondary hover:bg-spy-surface-deep">
            Clear
          </button>
        </div>
        <p className="mt-2 text-xs text-spy-text-secondary">
          Matching rows (preview): <span className="text-spy-text-primary">{previewCount ?? '—'}</span>
        </p>
      </div>

      <div className="rounded-xl border border-spy-border bg-spy-surface-primary p-4 md:p-6">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-sm font-semibold text-spy-text-primary">Scraper & live progress</h2>
          <div className="flex items-center gap-2 text-xs text-spy-text-secondary">
            {lastPollAt && <span>Last update: {lastPollAt}</span>}
            {busy && (
              <span className="inline-flex items-center gap-1.5 rounded-full border border-green-500/40 bg-green-500/10 px-2.5 py-0.5 font-medium text-green-200">
                <span className="relative flex h-2 w-2">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-green-400 opacity-75" />
                  <span className="relative inline-flex h-2 w-2 rounded-full bg-green-500" />
                </span>
                Live
              </span>
            )}
          </div>
        </div>

        {stopQueued && (
          <div className="mb-4 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm text-amber-100">
            Stop queued — current page/step complete hone ke baad scrape band ho jayega. Thodi der wait karein.
          </div>
        )}

        <div className="mb-4 rounded-lg border border-[#1f2937] bg-[#05070a]/80 p-4">
          <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Engine</p>
          <p className="mt-1 text-sm text-spy-text-primary">
            Status: <span className="font-semibold text-white">{engineRunning ? 'Running' : 'Idle'}</span>
            {syncing && !busy ? <span className="text-slate-500"> · refreshing…</span> : null}
          </p>
          <p className="mt-2 font-mono text-sm text-indigo-200/90">{scraperStatus?.details || '—'}</p>
        </div>

        {(live || engineRunning) && (
          <div className="mb-4 rounded-lg border border-green-500/25 bg-green-500/5 p-4">
            <p className="text-xs font-semibold uppercase tracking-wide text-green-300/90">This run (live)</p>
            {live ? (
              <dl className="mt-2 grid grid-cols-1 gap-2 text-sm sm:grid-cols-2">
                <div>
                  <dt className="text-spy-text-secondary">Date range</dt>
                  <dd className="font-medium text-white">
                    {live.fromDate || '—'} → {live.toDate || '—'}
                  </dd>
                </div>
                <div>
                  <dt className="text-spy-text-secondary">Started</dt>
                  <dd className="font-medium text-white">{live.startedAt ? new Date(live.startedAt).toLocaleString('en-IN') : '—'}</dd>
                </div>
                <div>
                  <dt className="text-spy-text-secondary">New rows inserted</dt>
                  <dd className="text-2xl font-bold text-green-400">{(live.insertedCount ?? 0).toLocaleString()}</dd>
                </div>
                <div>
                  <dt className="text-spy-text-secondary">Duplicate challans skipped</dt>
                  <dd className="text-2xl font-bold text-amber-300">{(live.duplicateSkipped ?? 0).toLocaleString()}</dd>
                </div>
              </dl>
            ) : (
              <p className="mt-2 text-sm text-spy-text-secondary">Connecting to scraper… live counters appear as batches save.</p>
            )}
            <p className="mt-3 text-xs text-slate-500">
              Numbers update every ~2s while running. Filtered cards above also move when new rows match your filters.
            </p>
          </div>
        )}

        <div className="rounded-lg border border-[#1f2937] bg-[#0b0f16]/80 p-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Last completed run</p>
          <p className="mt-1 text-sm text-spy-text-secondary">Ended: {lastRunDisplay}</p>
          {last && (
            <dl className="mt-2 grid grid-cols-1 gap-2 text-sm sm:grid-cols-2">
              <div>
                <dt className="text-spy-text-secondary">Inserted</dt>
                <dd className="text-spy-text-primary">{(last.insertedCount ?? 0).toLocaleString()}</dd>
              </div>
              <div>
                <dt className="text-spy-text-secondary">Duplicates skipped</dt>
                <dd className="text-spy-text-primary">{(last.duplicateSkipped ?? 0).toLocaleString()}</dd>
              </div>
            </dl>
          )}
          {last?.success === false && last.error && <p className="mt-2 text-xs text-amber-200">Error: {last.error}</p>}
        </div>

        {rangeValidationMessage && <p className="mt-3 text-xs text-amber-200">{rangeValidationMessage}</p>}

        <div className="mt-4 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => void startTodayScrape()}
            disabled={busy}
            className="rounded-xl border border-indigo-500/40 bg-indigo-500/15 px-5 py-2.5 text-sm font-semibold text-indigo-100 transition hover:bg-indigo-500/25 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {scraping ? 'Starting…' : 'Run (today — all Khanan)'}
          </button>
          <button
            type="button"
            onClick={() => requestRangeScrape()}
            disabled={busy || !canRunRange}
            className="rounded-xl border border-amber-500/40 bg-amber-500/15 px-5 py-2.5 text-sm font-semibold text-amber-100 transition hover:bg-amber-500/25 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {rangeScraping ? 'Starting…' : 'Run range'}
          </button>
          <button
            type="button"
            onClick={() => void requestStopScrape()}
            disabled={!engineRunning || stopSubmitting}
            className="rounded-xl border border-red-500/50 bg-red-500/15 px-5 py-2.5 text-sm font-semibold text-red-100 transition hover:bg-red-500/25 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {stopSubmitting ? 'Stopping…' : 'Stop scrape'}
          </button>
        </div>
        <p className="mt-4 text-xs text-spy-text-secondary">
          Run (today): server calendar date on the portal. Run range: each day in From→To, same full drill-down. Unique key:{' '}
          <code className="text-spy-text-primary">challan_no</code> — already in DB rows are skipped.
        </p>
      </div>

      <div className="rounded-xl border border-red-500/30 bg-red-950/20 p-4 md:p-6">
        <h2 className="text-sm font-semibold text-red-200">Databank reset (clean slate)</h2>
        <p className="mt-1 text-xs text-red-200/80">
          Saari <strong className="text-red-100">Khanan</strong> scraped rows delete ho jayengi + scraper status reset. Optional: Vehicle Leads
          summaries bhi hata do agar unhe bhi zero se dubara build karna ho.
        </p>
        <p className="mt-2 font-mono text-[11px] text-slate-400">
          Pehle confirm box mein yeh poora paste karo: <span className="text-white">{WIPE_SCRAPE_CONFIRM}</span>
        </p>
        <div className="mt-3 space-y-2">
          <input
            type="text"
            value={wipeConfirmInput}
            onChange={(e) => setWipeConfirmInput(e.target.value)}
            placeholder={WIPE_SCRAPE_CONFIRM}
            className="w-full max-w-md rounded-md border border-red-500/40 bg-[#0b0f16] px-3 py-2 text-sm text-white outline-none"
          />
          <label className="flex items-center gap-2 text-xs text-spy-text-secondary">
            <input
              type="checkbox"
              checked={wipeVehicleSummaries}
              onChange={(e) => setWipeVehicleSummaries(e.target.checked)}
              className="rounded border-spy-border"
            />
            Also delete all Vehicle Leads summaries (<code className="text-spy-text-primary">vehicle_trip_summary</code>)
          </label>
        </div>
        <button
          type="button"
          onClick={() => void executeWipeScrapedData()}
          disabled={wipeLoading || busy}
          className="mt-3 rounded-xl border border-red-500/60 bg-red-600/20 px-5 py-2 text-sm font-semibold text-red-100 hover:bg-red-600/30 disabled:opacity-40"
        >
          {wipeLoading ? 'Wiping…' : 'Wipe & prepare for fresh scrape'}
        </button>
      </div>

      <div className="rounded-xl border border-spy-border bg-spy-surface-primary p-4 md:p-6">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-semibold text-spy-text-primary">Row-by-row inspect (multi-layer output)</h2>
          <button
            type="button"
            onClick={() => void fetchInspectRows()}
            disabled={inspectLoading}
            className="rounded-md border border-spy-border bg-spy-surface-deep px-3 py-1.5 text-xs text-spy-text-primary hover:bg-spy-surface-primary disabled:opacity-50"
          >
            {inspectLoading ? 'Loading…' : 'Load sample (uses filters above)'}
          </button>
        </div>
        <p className="text-xs text-spy-text-secondary">
          Har row final layer (<code className="text-spy-text-primary">ePassRptChallansDetail</code>) se aayi fields dikhayenge — challan, vehicle,
          district, consigner, quantity, status, etc.
        </p>
        <div className="mt-3 overflow-x-auto rounded-lg border border-spy-border">
          <table className="min-w-full text-left text-xs text-spy-text-secondary">
            <thead className="border-b border-spy-border bg-spy-surface-deep text-[10px] uppercase tracking-wide">
              <tr>
                <th className="px-2 py-2">ID</th>
                <th className="px-2 py-2">Challan</th>
                <th className="px-2 py-2">District</th>
                <th className="px-2 py-2">Date</th>
                <th className="px-2 py-2">Consigner</th>
                <th className="px-2 py-2"> </th>
              </tr>
            </thead>
            <tbody>
              {inspectRows.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-3 py-4 text-center text-spy-text-secondary">
                    Load sample to list rows (current filters apply).
                  </td>
                </tr>
              ) : (
                inspectRows.map((row) => {
                  const id = row.id || row._id || '';
                  return (
                    <tr key={id} className="border-b border-spy-border/60 hover:bg-spy-surface-deep/50">
                      <td className="px-2 py-1.5 font-mono text-[10px] text-spy-text-primary">{id}</td>
                      <td className="max-w-[140px] truncate px-2 py-1.5 text-spy-text-primary">{row.challanNo}</td>
                      <td className="px-2 py-1.5">{row.district}</td>
                      <td className="px-2 py-1.5">{row.date}</td>
                      <td className="max-w-[180px] truncate px-2 py-1.5">{row.consignerName}</td>
                      <td className="px-2 py-1.5">
                        <button
                          type="button"
                          onClick={() => void openInspectDetail(String(id))}
                          className="text-indigo-300 underline hover:text-indigo-200"
                        >
                          View all fields
                        </button>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {(inspectDetailLoading || inspectDetail) && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/70 px-4" role="dialog">
          <div className="max-h-[85vh] w-full max-w-lg overflow-y-auto rounded-xl border border-spy-border bg-spy-surface-primary p-5 shadow-2xl">
            <div className="mb-3 flex items-center justify-between gap-2">
              <h3 className="text-sm font-semibold text-spy-text-primary">Full record</h3>
              <button type="button" onClick={() => setInspectDetail(null)} className="text-xs text-spy-text-secondary underline">
                Close
              </button>
            </div>
            {inspectDetailLoading ? (
              <p className="text-sm text-spy-text-secondary">Loading…</p>
            ) : inspectDetail ? (
              <dl className="space-y-2 text-sm">
                {Object.entries(inspectDetail).map(([key, val]) => (
                  <div key={key} className="border-b border-spy-border/50 pb-2">
                    <dt className="text-[11px] uppercase tracking-wide text-spy-text-secondary">{key}</dt>
                    <dd className="mt-0.5 break-words text-spy-text-primary">{String(val ?? '—')}</dd>
                  </div>
                ))}
              </dl>
            ) : null}
          </div>
        </div>
      )}
    </div>
  );
}
