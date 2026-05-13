'use client';

import Link from 'next/link';
import { useMemo, useState, useEffect } from 'react';

const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL ?? '';
const STATS_SNAPSHOT_KEY = 'khanan_stats_snapshot_v1';
const ALERT_HISTORY_KEY = 'khanan_alert_history_v1';

const SCRAPE_MAX_RANGE_DAYS = (() => {
  const n = Number.parseInt(process.env.NEXT_PUBLIC_SCRAPE_MAX_RANGE_DAYS || '31', 10);
  return Number.isFinite(n) && n > 0 ? n : 31;
})();
const RANGE_CONFIRM_THRESHOLD_DAYS = 7;

function inclusiveDayCount(fromIso: string, toIso: string): number {
  const a = new Date(`${fromIso}T12:00:00`);
  const b = new Date(`${toIso}T12:00:00`);
  if (Number.isNaN(a.getTime()) || Number.isNaN(b.getTime())) return Number.NaN;
  return Math.abs(Math.round((b.getTime() - a.getTime()) / (24 * 60 * 60 * 1000))) + 1;
}

const CARD_ACCENTS = [
  {
    gradient: 'bg-gradient-to-br from-indigo-500/8 via-transparent to-transparent',
    border: 'hover:border-indigo-500/40',
    iconColor: 'text-indigo-400',
    glowClass: 'hover:animate-pulse-indigo',
  },
  {
    gradient: 'bg-gradient-to-br from-green-500/8 via-transparent to-transparent',
    border: 'hover:border-green-500/40',
    iconColor: 'text-green-400',
    glowClass: 'hover:animate-pulse-green',
  },
  {
    gradient: 'bg-gradient-to-br from-amber-500/8 via-transparent to-transparent',
    border: 'hover:border-amber-500/40',
    iconColor: 'text-amber-400',
    glowClass: '',
  },
  {
    gradient: 'bg-gradient-to-br from-blue-500/8 via-transparent to-transparent',
    border: 'hover:border-blue-500/40',
    iconColor: 'text-blue-400',
    glowClass: 'hover:animate-pulse-blue',
  },
] as const;

interface KhananStats {
  totalRecords: number;
  totalQuantity: number;
  districtCount: number;
  mineralCount: number;
  uniqueVehicleCount: number;
}

interface ScraperStatus {
  running: boolean;
  details: string;
  lastRun?: {
    startedAt?: string | null;
    endedAt?: string | null;
    success?: boolean | null;
    error?: string | null;
  } | null;
}

interface DashboardToast {
  id: number;
  type: 'success' | 'error' | 'info';
  message: string;
}

interface TrendIndicator {
  value: string;
  tone: string;
  icon: string;
  meta: string;
}

interface AlertHistoryItem {
  id: string;
  severity: 'warning' | 'error';
  title: string;
  detail: string;
  fingerprint: string;
  lastSeenAt: number;
  status: 'open' | 'resolved';
}

function getTrendIndicator(current: number, previous: number | null | undefined): TrendIndicator {
  if (previous == null) {
    return {
      value: 'No prior data',
      tone: 'text-slate-400',
      icon: 'M5 12h14',
      meta: 'collecting trend data',
    };
  }

  if (previous === 0) {
    if (current === 0) {
      return {
        value: 'No change',
        tone: 'text-slate-400',
        icon: 'M5 12h14',
        meta: 'same as last refresh',
      };
    }
    return {
      value: '+100%',
      tone: 'text-green-400',
      icon: 'M5 15l7-7 7 7',
      meta: 'new data vs last refresh',
    };
  }

  const deltaPct = ((current - previous) / previous) * 100;
  const absPct = Math.abs(deltaPct).toFixed(1);
  if (deltaPct > 0) {
    return {
      value: `+${absPct}%`,
      tone: 'text-green-400',
      icon: 'M5 15l7-7 7 7',
      meta: 'vs last refresh',
    };
  }
  if (deltaPct < 0) {
    return {
      value: `-${absPct}%`,
      tone: 'text-amber-400',
      icon: 'M19 9l-7 7-7-7',
      meta: 'vs last refresh',
    };
  }
  return {
    value: 'No change',
    tone: 'text-slate-400',
    icon: 'M5 12h14',
    meta: 'same as last refresh',
  };
}

export default function Home() {
  const [activeTab, setActiveTab] = useState<'overview' | 'logs' | 'config'>('overview');
  const [logFilter, setLogFilter] = useState<'all' | 'open' | 'resolved'>('all');
  const [stats, setStats] = useState<KhananStats | null>(null);
  const [previousStats, setPreviousStats] = useState<KhananStats | null>(null);
  const [scraperStatus, setScraperStatus] = useState<ScraperStatus | null>(null);
  const [hasSession, setHasSession] = useState(false);
  const [loading, setLoading] = useState(true);
  const [scraping, setScraping] = useState(false);
  const [rangeScraping, setRangeScraping] = useState(false);
  const [rangeConfirmOpen, setRangeConfirmOpen] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [stopping, setStopping] = useState(false);
  const [filtering, setFiltering] = useState(false);
  const [districts, setDistricts] = useState<string[]>([]);
  const [minerals, setMinerals] = useState<string[]>([]);
  const [previewCount, setPreviewCount] = useState<number | null>(null);
  const [toasts, setToasts] = useState<DashboardToast[]>([]);
  const [alertHistory, setAlertHistory] = useState<AlertHistoryItem[]>([]);
  const [filters, setFilters] = useState({
    fromDate: '',
    toDate: '',
    district: '',
    mineral: '',
  });
  const [error, setError] = useState<string | null>(null);

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
  const showErrorChip = Boolean(error);
  const actionLabel =
    stopping ? 'Stopping' : refreshing ? 'Refreshing' : scraping || rangeScraping ? 'Starting' : engineRunning ? 'Executing' : 'Ready';
  const statusLabel = showErrorChip ? 'Error' : engineRunning ? 'Running' : 'Idle';
  const metricsUpdatedAt = new Date().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });
  const detailsLower = String(scraperStatus?.details || '').toLowerCase();

  let runStage = 'Idle';
  let runProgress = 0;
  if (showErrorChip) {
    runStage = 'Error';
    runProgress = 100;
  } else if (scraping || rangeScraping) {
    runStage = 'Initializing';
    runProgress = 20;
  } else if (engineRunning) {
    if (detailsLower.includes('processing')) {
      runStage = 'Processing';
      runProgress = 65;
    } else if (detailsLower.includes('saving')) {
      runStage = 'Saving';
      runProgress = 85;
    } else {
      runStage = 'Running';
      runProgress = 50;
    }
  } else if (scraperStatus?.lastRun) {
    runStage = 'Completed';
    runProgress = 100;
  }

  const getLastRunTimestamp = (lastRun?: ScraperStatus['lastRun']) => {
    if (!lastRun || typeof lastRun !== 'object') return null;
    return lastRun.endedAt || lastRun.startedAt || null;
  };
  const safeFormatDateTime = (value?: string | null) => {
    if (!value) return null;
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) return null;
    return parsed.toLocaleString('en-IN');
  };
  const safeFormatTime = (value?: string | null) => {
    if (!value) return null;
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) return null;
    return parsed.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });
  };

  const lastRunTimestamp = getLastRunTimestamp(scraperStatus?.lastRun);
  const lastRunDisplay = safeFormatDateTime(lastRunTimestamp) || 'N/A';

  const recordsTrend = getTrendIndicator(stats?.totalRecords ?? 0, previousStats?.totalRecords);
  const mineralsTrend = getTrendIndicator(stats?.mineralCount ?? 0, previousStats?.mineralCount);
  const regionsTrend = getTrendIndicator(stats?.districtCount ?? 0, previousStats?.districtCount);

  const uptimeScore = error
    ? 85
    : scraperStatus?.lastRun?.success === false
      ? 92
      : engineRunning
        ? 99.9
        : 99.5;

  const uptimeTrend = scraperStatus?.lastRun?.success === false
    ? { value: 'Attention', tone: 'text-amber-400', icon: 'M19 9l-7 7-7-7', meta: 'last run needs review' }
    : engineRunning
      ? { value: 'Live', tone: 'text-green-400', icon: 'M5 15l7-7 7 7', meta: 'scraper is active' }
      : { value: 'Stable', tone: 'text-indigo-300', icon: 'M5 12h14', meta: 'service health normal' };

  const activityEvents: Array<{ type: 'success' | 'info' | 'warning' | 'error'; title: string; detail: string; time: string }> = [];
  if (error) {
    activityEvents.push({ type: 'error', title: 'Refresh error', detail: error, time: new Date().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' }) });
  }
  if (scraping || rangeScraping) {
    activityEvents.push({
      type: 'info',
      title: 'Initialization started',
      detail: 'Scraper start request submitted to backend.',
      time: new Date().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' }),
    });
  }
  if (engineRunning) {
    activityEvents.push({ type: 'warning', title: 'Scraper executing', detail: scraperStatus?.details || 'Backend reports active scraping run.', time: new Date().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' }) });
  }
  if (!engineRunning && scraperStatus?.lastRun) {
    activityEvents.push({ type: 'success', title: 'Last run completed', detail: 'Most recent scraping cycle finished successfully.', time: safeFormatTime(lastRunTimestamp) || new Date().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' }) });
  }
  if (activityEvents.length === 0) {
    activityEvents.push({
      type: 'info',
      title: 'System idle',
      detail: 'No active scraper run. Use Quick (yesterday) or Range (from filters).',
      time: new Date().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' }),
    });
  }

  const issueLogs = useMemo(() => {
    const logs: Array<{ severity: 'warning' | 'error'; title: string; detail: string; time: string }> = [];
    if (error) {
      logs.push({ severity: 'error', title: 'Dashboard refresh failure', detail: error, time: new Date().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' }) });
    }
    if (scraperStatus?.lastRun?.success === false) {
      logs.push({ severity: 'warning', title: 'Last update needs attention', detail: scraperStatus.lastRun.error || 'Latest update finished with a warning. Please review and try again if needed.', time: safeFormatTime(lastRunTimestamp) || new Date().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' }) });
    }
    return logs;
  }, [error, scraperStatus?.lastRun?.success, scraperStatus?.lastRun?.error, lastRunTimestamp]);

  const filteredAlertHistory = useMemo(() => {
    if (logFilter === 'all') return alertHistory;
    return alertHistory.filter((item) => item.status === logFilter);
  }, [alertHistory, logFilter]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const raw = localStorage.getItem(ALERT_HISTORY_KEY);
    if (!raw) return;
    try {
      const parsed = JSON.parse(raw) as AlertHistoryItem[];
      if (Array.isArray(parsed)) {
        const safe = parsed.filter(
          (item) =>
            item &&
            typeof item.id === 'string' &&
            typeof item.title === 'string' &&
            typeof item.detail === 'string' &&
            (item.severity === 'warning' || item.severity === 'error') &&
            (item.status === 'open' || item.status === 'resolved') &&
            typeof item.lastSeenAt === 'number'
        );
        setAlertHistory(safe.slice(0, 20));
      }
    } catch {
      localStorage.removeItem(ALERT_HISTORY_KEY);
    }
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    setAlertHistory((prev) => {
      const now = Date.now();
      const activeFingerprints = new Set(issueLogs.map((item) => `${item.severity}|${item.title}|${item.detail}`));
      const updated = prev.map((item) =>
        activeFingerprints.has(item.fingerprint) ? { ...item, status: 'open' as const, lastSeenAt: now } : { ...item, status: 'resolved' as const }
      );
      for (const issue of issueLogs) {
        const fingerprint = `${issue.severity}|${issue.title}|${issue.detail}`;
        const existingIndex = updated.findIndex((entry) => entry.fingerprint === fingerprint);
        if (existingIndex >= 0) {
          updated[existingIndex] = { ...updated[existingIndex], status: 'open', lastSeenAt: now };
          continue;
        }
        updated.unshift({ id: `${now}-${Math.random().toString(36).slice(2, 8)}`, severity: issue.severity, title: issue.title, detail: issue.detail, fingerprint, lastSeenAt: now, status: 'open' });
      }
      const compact = updated.sort((a, b) => b.lastSeenAt - a.lastSeenAt).slice(0, 20);
      localStorage.setItem(ALERT_HISTORY_KEY, JSON.stringify(compact));
      return compact;
    });
  }, [error, scraperStatus?.lastRun?.success, scraperStatus?.lastRun?.error, issueLogs]);

  const pushToast = (type: DashboardToast['type'], message: string) => {
    const id = Date.now() + Math.floor(Math.random() * 1000);
    setToasts((prev) => [...prev, { id, type, message }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 3500);
  };

  const buildFilterParams = () => {
    const params = new URLSearchParams();
    if (filters.fromDate) params.set('fromDate', filters.fromDate);
    if (filters.toDate) params.set('toDate', filters.toDate);
    if (filters.district) params.set('district', filters.district);
    if (filters.mineral) params.set('mineralName', filters.mineral);
    return params;
  };

  const fetchStats = async (token: string) => {
    try {
      const statsParams = new URLSearchParams();
      if (filters.fromDate) statsParams.set('fromDate', filters.fromDate);
      if (filters.toDate) statsParams.set('toDate', filters.toDate);
      const response = await fetch(`${API_BASE_URL}/api/khanan/stats?${statsParams.toString()}`, { headers: { Authorization: `Bearer ${token}` } });
      if (response.ok) {
        const data = await response.json();
        if (stats) setPreviousStats(stats);
        setStats(data);
        localStorage.setItem(STATS_SNAPSHOT_KEY, JSON.stringify(data));
      } else if (response.status === 401) {
        localStorage.removeItem('spybot_token');
        setHasSession(false);
        setError('Authentication expired. Please sign in again.');
      } else {
        setError('Failed to fetch khanan statistics');
      }
    } catch (err) {
      console.error('Stats error:', err);
      setError('Failed to fetch khanan statistics');
    }
  };

  const fetchFilterOptions = async (token: string) => {
    try {
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
    } catch (err) {
      console.error('Filter options error:', err);
    }
  };

  const fetchFilteredPreview = async (token: string) => {
    try {
      const params = buildFilterParams();
      params.set('page', '1');
      params.set('limit', '1');
      const response = await fetch(`${API_BASE_URL}/api/khanan/data?${params.toString()}`, { headers: { Authorization: `Bearer ${token}` } });
      if (response.ok) {
        const data = await response.json();
        const total = Number(data?.pagination?.total);
        setPreviewCount(Number.isFinite(total) ? total : null);
      }
    } catch (err) {
      console.error('Preview count error:', err);
    }
  };

  const fetchScraperStatus = async (token: string) => {
    try {
      const response = await fetch(`${API_BASE_URL}/api/selenium/status`, { headers: { Authorization: `Bearer ${token}` } });
      if (response.ok) {
        const data = await response.json();
        setScraperStatus(data);
      } else if (response.status === 401) {
        localStorage.removeItem('spybot_token');
        setHasSession(false);
        setError('Authentication expired. Please sign in again.');
      } else {
        setError('Failed to fetch scraper status');
      }
    } catch (err) {
      console.error('Status error:', err);
      setError('Failed to fetch scraper status');
    }
  };

  useEffect(() => {
    const initialize = async () => {
      try {
        const token = localStorage.getItem('spybot_token');
        const cachedSnapshot = localStorage.getItem(STATS_SNAPSHOT_KEY);
        if (cachedSnapshot) {
          try {
            const parsed = JSON.parse(cachedSnapshot) as KhananStats;
            if (parsed && typeof parsed.totalRecords === 'number' && typeof parsed.mineralCount === 'number' && typeof parsed.districtCount === 'number') {
              setPreviousStats(parsed);
            }
          } catch {
            localStorage.removeItem(STATS_SNAPSHOT_KEY);
          }
        }
        if (token) {
          setHasSession(true);
          await Promise.all([fetchStats(token), fetchScraperStatus(token), fetchFilterOptions(token), fetchFilteredPreview(token)]);
        } else {
          setError('Authentication required. Please sign in.');
        }
      } catch (err) {
        console.error('Init error:', err);
        setError('Initialization failed');
      } finally {
        setLoading(false);
      }
    };
    void initialize();
  }, []);

  const startQuickYesterdayScrape = async () => {
    if (scraping || rangeScraping) return;
    const token = localStorage.getItem('spybot_token');
    if (!token) return;
    setScraping(true);
    try {
      const response = await fetch(`${API_BASE_URL}/api/selenium/dailyScraping`, { headers: { Authorization: `Bearer ${token}` } });
      const data = (await response.json().catch(() => ({}))) as { error?: string };
      if (response.ok) {
        pushToast('success', 'Quick run started (yesterday).');
        void fetchScraperStatus(token);
      } else if (response.status === 409) {
        pushToast('error', typeof data.error === 'string' ? data.error : 'Scraper already running.');
      } else {
        setError('Failed to start scraping engine');
        pushToast('error', typeof data.error === 'string' ? data.error : 'Failed to start scraper.');
      }
    } catch (err) {
      console.error('Scraping start error:', err);
      setError('Engine failure during startup');
      pushToast('error', 'Engine failure during startup.');
    } finally {
      setScraping(false);
    }
  };

  const executeRangeScrape = async () => {
    if (rangeScraping || scraping) return;
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
          typeof n === 'number' ? `Range scrape started (${n} day${n === 1 ? '' : 's'}).` : 'Range scrape started.'
        );
        void fetchScraperStatus(token);
      } else if (response.status === 409) {
        pushToast('error', typeof data.error === 'string' ? data.error : 'Scraper already running.');
      } else if (response.status === 400) {
        pushToast('error', typeof data.error === 'string' ? data.error : 'Invalid range.');
      } else {
        pushToast('error', typeof data.error === 'string' ? data.error : `Range scrape failed (${response.status}).`);
      }
    } catch (err) {
      console.error('Range scrape error:', err);
      pushToast('error', 'Range scrape request failed.');
    } finally {
      setRangeScraping(false);
      setRangeConfirmOpen(false);
    }
  };

  const requestRangeScrape = () => {
    if (!filters.fromDate || !filters.toDate) {
      pushToast('info', 'Pehle From aur To date select karo.');
      return;
    }
    const dayCount = inclusiveDayCount(filters.fromDate, filters.toDate);
    if (Number.isNaN(dayCount)) {
      pushToast('error', 'Invalid date range.');
      return;
    }
    if (dayCount > SCRAPE_MAX_RANGE_DAYS) {
      pushToast('error', `Range is ${dayCount} days; maximum allowed is ${SCRAPE_MAX_RANGE_DAYS}.`);
      return;
    }
    if (dayCount > RANGE_CONFIRM_THRESHOLD_DAYS) {
      setRangeConfirmOpen(true);
      return;
    }
    void executeRangeScrape();
  };

  const refreshDashboard = async () => {
    const token = localStorage.getItem('spybot_token');
    if (!token) {
      setHasSession(false);
      setError('Authentication required. Please sign in.');
      return;
    }
    setRefreshing(true);
    setFiltering(true);
    setError(null);
    try {
      await Promise.all([fetchStats(token), fetchScraperStatus(token), fetchFilteredPreview(token)]);
      pushToast('info', 'Dashboard refreshed.');
    } finally {
      setRefreshing(false);
      setFiltering(false);
    }
  };

  const stopScraping = async () => {
    if (!engineRunning || scraping || rangeScraping || stopping) return;
    setStopping(true);
    try {
      setError('Stop action is not available in current backend. Please wait for the active run to complete.');
      pushToast('info', 'Stop endpoint not available in backend.');
    } finally {
      setStopping(false);
    }
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

  if (loading) {
    return (
      <div className="mx-auto max-w-7xl space-y-6 pb-20">
        <div className="h-28 animate-pulse rounded-3xl border border-[#1f2937] bg-[#0b0f16]" />
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
          {[0, 1, 2, 3].map((k) => (
            <div key={k} className="h-32 animate-pulse rounded-2xl border border-[#1f2937] bg-[#0b0f16]" />
          ))}
        </div>
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
          <div className="h-72 animate-pulse rounded-[28px] border border-[#1f2937] bg-[#0b0f16] lg:col-span-2" />
          <div className="h-72 animate-pulse rounded-[28px] border border-[#1f2937] bg-[#0b0f16]" />
        </div>
      </div>
    );
  }

  if (!hasSession) {
    return (
      <div className="mx-auto max-w-xl rounded-3xl border border-[#1f2937] bg-[#0b0f16] p-10 text-center shadow-2xl">
        <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full border border-indigo-500/30 bg-indigo-600/15 text-indigo-300">
          <svg className="h-7 w-7" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 10l4.553-4.553a2 2 0 10-2.828-2.828L12.172 7.17a4 4 0 00-1.414 2.828L10 14l3.999-.758a4 4 0 002.829-1.415zM5 19h14" />
          </svg>
        </div>
        <h1 className="mb-2 text-2xl font-semibold tracking-tight text-white">Khanan Soft Access Required</h1>
        <p className="mb-6 text-sm text-slate-400">Sign in on the SpyBot login page to load scraper analytics and controls.</p>
        {error && (
          <div className="mb-6 rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">{error}</div>
        )}
        <Link href="/login" className="inline-flex items-center rounded-lg bg-[#0056b3] px-8 py-3 text-sm font-semibold tracking-wide text-white transition hover:bg-[#004494]">
          Go to sign in
        </Link>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-7xl space-y-8 pb-20">

      {/* ── Toast Notifications ── */}
      <div className="fixed right-4 top-4 z-50 space-y-2">
        {toasts.map((toast) => (
          <div
            key={toast.id}
            className={`animate-slide-right min-w-[260px] rounded-xl border px-4 py-3 text-sm shadow-2xl backdrop-blur ${
              toast.type === 'success'
                ? 'border-green-500/40 bg-green-500/15 text-green-100'
                : toast.type === 'error'
                  ? 'border-red-500/40 bg-red-500/15 text-red-100'
                  : 'border-indigo-500/40 bg-indigo-500/15 text-indigo-100'
            }`}
          >
            <div className="flex items-center gap-2">
              <div className={`h-1.5 w-1.5 rounded-full ${toast.type === 'success' ? 'bg-green-400' : toast.type === 'error' ? 'bg-red-400' : 'bg-indigo-400'}`} />
              {toast.message}
            </div>
          </div>
        ))}
      </div>

      {rangeConfirmOpen && filters.fromDate && filters.toDate && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/65 px-4 backdrop-blur-[2px]">
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="range-scrape-confirm-title"
            className="w-full max-w-md rounded-2xl border border-[#1f2937] bg-[#0b0f16] p-6 shadow-2xl"
          >
            <h3 id="range-scrape-confirm-title" className="text-lg font-semibold text-white">
              Confirm range scrape
            </h3>
            <p className="mt-3 text-sm leading-relaxed text-slate-400">
              This will run up to{' '}
              <span className="font-semibold text-slate-200">{inclusiveDayCount(filters.fromDate, filters.toDate)}</span> calendar{' '}
              {inclusiveDayCount(filters.fromDate, filters.toDate) === 1 ? 'day' : 'days'} of scraping ({filters.fromDate} → {filters.toDate}).
            </p>
            <div className="mt-6 flex flex-wrap justify-end gap-2">
              <button
                type="button"
                onClick={() => setRangeConfirmOpen(false)}
                className="rounded-xl border border-slate-600/60 bg-slate-800/40 px-4 py-2 text-sm font-medium text-slate-200 transition hover:bg-slate-700/50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void executeRangeScrape()}
                className="rounded-xl border border-amber-500/50 bg-amber-500/20 px-4 py-2 text-sm font-semibold text-amber-100 transition hover:bg-amber-500/30"
              >
                Run range
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Error Banner ── */}
      {error && (
        <section className="rounded-2xl border border-red-500/30 bg-red-500/10 p-4 md:p-5">
          <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <div className="flex items-start gap-3">
              <svg className="mt-0.5 h-5 w-5 text-red-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v4m0 4h.01M3.055 11a9 9 0 1117.89 0 9 9 0 01-17.89 0z" />
              </svg>
              <div>
                <p className="text-sm font-semibold text-red-200">Khanan module failed to refresh</p>
                <p className="text-sm text-red-300">{error}</p>
              </div>
            </div>
            <button
              onClick={refreshDashboard}
              disabled={refreshing}
              className="inline-flex items-center rounded-lg border border-red-400/40 bg-red-500/20 px-4 py-2 text-sm font-medium text-red-100 transition hover:bg-red-500/30 disabled:opacity-60"
            >
              {refreshing ? 'Retrying...' : 'Retry'}
            </button>
          </div>
        </section>
      )}

      {/* ── Page Header ── */}
      <section className="relative overflow-hidden rounded-3xl border border-[#1f2937] bg-gradient-to-br from-[#0d1020] via-[#0b0f16] to-[#05070a] p-6 md:p-8">
        {/* Ambient background glow */}
        <div className="animate-glow-drift pointer-events-none absolute -right-20 -top-20 h-64 w-64 rounded-full bg-indigo-600/10 blur-3xl" />
        <div className="animate-glow-drift pointer-events-none absolute -bottom-10 left-10 h-40 w-40 rounded-full bg-blue-600/8 blur-2xl" style={{ animationDelay: '2s' }} />

        <div className="relative flex flex-col gap-5 md:flex-row md:items-end md:justify-between">
          <div>
            <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.25em] text-indigo-400">External Tools</p>
            <h1 className="mb-1 bg-gradient-to-r from-white via-indigo-100 to-indigo-400 bg-clip-text text-4xl font-extrabold tracking-tight text-transparent md:text-5xl">
              Khanan Soft
            </h1>
            <p className="text-sm font-medium tracking-wide text-slate-400">Data updates and summary</p>
          </div>

          {/* Tab Switcher */}
          <div className="inline-flex overflow-hidden rounded-2xl border border-[#1f2937] bg-[#0b0f16] p-1">
            {(['overview', 'logs', 'config'] as const).map((tab) => (
              <button
                key={tab}
                type="button"
                onClick={() => setActiveTab(tab)}
                className={`rounded-xl px-5 py-2 text-[11px] tracking-wide transition-all ${
                  activeTab === tab
                    ? 'bg-indigo-600/20 font-semibold text-indigo-200 shadow-[inset_0_0_0_1px_rgba(99,102,241,0.3)]'
                    : 'font-medium text-slate-400 hover:text-white'
                }`}
              >
                {tab.charAt(0).toUpperCase() + tab.slice(1)}
              </button>
            ))}
          </div>
        </div>
      </section>

      {/* ══════════════ OVERVIEW TAB ══════════════ */}
      {activeTab === 'overview' && (
        <>
          {/* ── Quick Filters ── */}
          <section className="space-y-3 rounded-2xl border border-[#1f2937] bg-[#0b0f16] p-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h3 className="text-sm font-semibold text-white">Quick Filters</h3>
                <p className="text-xs text-slate-500">
                  Filter metrics and preview records by date/district/mineral. <span className="text-slate-600">Range scrape (Actions) uses From / To.</span>
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <button onClick={() => applyQuickRange(0)} className="rounded-lg border border-slate-600/50 bg-slate-700/20 px-3 py-1.5 text-xs text-slate-200 transition hover:bg-slate-700/35 hover:text-white">Today</button>
                <button onClick={() => applyQuickRange(7)} className="rounded-lg border border-slate-600/50 bg-slate-700/20 px-3 py-1.5 text-xs text-slate-200 transition hover:bg-slate-700/35 hover:text-white">Last 7d</button>
                <button onClick={() => applyQuickRange(30)} className="rounded-lg border border-slate-600/50 bg-slate-700/20 px-3 py-1.5 text-xs text-slate-200 transition hover:bg-slate-700/35 hover:text-white">Last 30d</button>
              </div>
            </div>
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-5">
              <input
                type="date"
                value={filters.fromDate}
                onChange={(e) => setFilters((prev) => ({ ...prev, fromDate: e.target.value }))}
                className="rounded-lg border border-[#1f2937] bg-[#05070a] px-3 py-2 text-sm text-slate-200 outline-none transition focus:border-indigo-500/60 focus:ring-1 focus:ring-indigo-500/20"
              />
              <input
                type="date"
                value={filters.toDate}
                onChange={(e) => setFilters((prev) => ({ ...prev, toDate: e.target.value }))}
                className="rounded-lg border border-[#1f2937] bg-[#05070a] px-3 py-2 text-sm text-slate-200 outline-none transition focus:border-indigo-500/60 focus:ring-1 focus:ring-indigo-500/20"
              />
              <select
                value={filters.district}
                onChange={(e) => setFilters((prev) => ({ ...prev, district: e.target.value }))}
                className="rounded-lg border border-[#1f2937] bg-[#05070a] px-3 py-2 text-sm text-slate-200 outline-none transition focus:border-indigo-500/60"
              >
                <option value="">All districts</option>
                {districts.map((district) => <option key={district} value={district}>{district}</option>)}
              </select>
              <select
                value={filters.mineral}
                onChange={(e) => setFilters((prev) => ({ ...prev, mineral: e.target.value }))}
                className="rounded-lg border border-[#1f2937] bg-[#05070a] px-3 py-2 text-sm text-slate-200 outline-none transition focus:border-indigo-500/60"
              >
                <option value="">All minerals</option>
                {minerals.map((mineral) => <option key={mineral} value={mineral}>{mineral}</option>)}
              </select>
              <div className="flex gap-2">
                <button
                  onClick={refreshDashboard}
                  disabled={refreshing || filtering}
                  className="flex-1 rounded-lg border border-indigo-500/40 bg-indigo-500/15 px-3 py-2 text-sm text-indigo-100 transition hover:bg-indigo-500/25 disabled:opacity-60"
                >
                  {refreshing || filtering ? 'Applying...' : 'Apply'}
                </button>
                <button
                  onClick={clearFilters}
                  className="rounded-lg border border-slate-600/50 bg-slate-700/20 px-3 py-2 text-sm text-slate-200 transition hover:bg-slate-700/35"
                >
                  Reset
                </button>
              </div>
            </div>
            <p className="text-xs text-slate-500">
              Filtered preview records: <span className="text-slate-300">{previewCount ?? 'N/A'}</span>
            </p>
          </section>

          {/* ── Metric Cards ── */}
          <section className="space-y-4">
            <div>
              <h2 className="text-lg font-semibold text-white">Overview</h2>
              <p className="text-sm text-slate-500">Key metrics from khanan aggregation and scraper operations.</p>
            </div>
            {!stats ? (
              <div className="rounded-2xl border border-[#1f2937] bg-[#0b0f16] p-8">
                <div className="flex flex-col items-center text-center">
                  <svg className="mb-3 h-8 w-8 text-slate-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 17v-2m3 2v-4m3 4V7m3 10H6a2 2 0 01-2-2V5a2 2 0 012-2h12a2 2 0 012 2v10a2 2 0 01-2 2z" />
                  </svg>
                  <p className="text-sm font-medium text-slate-300">No analytics snapshot available yet</p>
                  <p className="mt-1 text-sm text-slate-500">Run scraper or refresh the module to populate dashboard metrics.</p>
                  <button
                    onClick={refreshDashboard}
                    disabled={refreshing}
                    className="mt-4 rounded-lg border border-slate-600/60 bg-slate-700/20 px-4 py-2 text-sm font-medium text-slate-200 transition hover:bg-slate-700/40 disabled:opacity-60"
                  >
                    {refreshing ? 'Refreshing...' : 'Refresh now'}
                  </button>
                </div>
              </div>
            ) : (
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
                {[
                  {
                    label: 'Records',
                    value: (stats?.totalRecords || 0).toLocaleString(),
                    trend: recordsTrend.value,
                    trendTone: recordsTrend.tone,
                    trendIcon: recordsTrend.icon,
                    meta: recordsTrend.meta,
                    icon: 'M4 6h16M4 10h16M4 14h16M4 18h16',
                  },
                  {
                    label: 'Minerals',
                    value: (stats?.mineralCount || 0).toLocaleString(),
                    trend: mineralsTrend.value,
                    trendTone: mineralsTrend.tone,
                    trendIcon: mineralsTrend.icon,
                    meta: mineralsTrend.meta,
                    icon: 'M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10',
                  },
                  {
                    label: 'Regions',
                    value: (stats?.districtCount || 0).toLocaleString(),
                    trend: regionsTrend.value,
                    trendTone: regionsTrend.tone,
                    trendIcon: regionsTrend.icon,
                    meta: regionsTrend.meta,
                    icon: 'M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z',
                  },
                  {
                    label: 'Uptime',
                    value: `${uptimeScore.toFixed(1)}%`,
                    trend: uptimeTrend.value,
                    trendTone: uptimeTrend.tone,
                    trendIcon: uptimeTrend.icon,
                    meta: uptimeTrend.meta,
                    icon: 'M13 10V3L4 14h7v7l9-11h-7z',
                  },
                ].map((stat, i) => {
                  const accent = CARD_ACCENTS[i];
                  return (
                    <div
                      key={i}
                      className={`animate-fade-up group relative overflow-hidden rounded-2xl border border-[#1f2937] p-5 transition-all duration-300 ${accent.gradient} ${accent.border} ${accent.glowClass}`}
                      style={{ animationDelay: `${i * 80}ms` }}
                    >
                      <div className="mb-4 flex items-start justify-between">
                        <div className="flex items-center space-x-2.5">
                          <div className={`flex h-7 w-7 items-center justify-center rounded-lg bg-current/10 ${accent.iconColor}`}>
                            <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d={stat.icon} />
                            </svg>
                          </div>
                          <span className="text-[11px] font-medium tracking-wide text-slate-400">{stat.label}</span>
                        </div>
                        <span className="text-[10px] text-slate-500">Updated {metricsUpdatedAt}</span>
                      </div>
                      <div className={`mb-2 text-2xl font-bold ${accent.iconColor}`}>{stat.value}</div>
                      <div className="flex items-center gap-2 text-[11px]">
                        <span className={`inline-flex items-center gap-1.5 rounded-md border border-current/20 bg-current/5 px-1.5 py-0.5 font-semibold ${stat.trendTone}`}>
                          <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d={stat.trendIcon} />
                          </svg>
                          {stat.trend}
                        </span>
                        <span className="text-slate-500">{stat.meta}</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </section>

          {/* ── Actions Section ── */}
          <section className="space-y-4">
            <div>
              <h2 className="text-lg font-semibold text-white">Actions</h2>
              <p className="text-sm text-slate-500">
                Start updates, refresh data, and track current progress. Leads page uses vehicle summaries; run Leads Sync Vehicles after scrape.
              </p>
              <div className="mt-2.5 flex flex-wrap gap-2">
                {/* Status chip */}
                <span className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium ${
                  showErrorChip
                    ? 'border-red-500/40 bg-red-500/10 text-red-300'
                    : engineRunning
                      ? 'border-green-500/40 bg-green-500/10 text-green-300'
                      : 'border-slate-600/60 bg-slate-700/20 text-slate-300'
                }`}>
                  {engineRunning && !showErrorChip ? (
                    <span className="relative flex h-2 w-2">
                      <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75" />
                      <span className="relative inline-flex h-2 w-2 rounded-full bg-green-500" />
                    </span>
                  ) : (
                    <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      {showErrorChip ? (
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v4m0 4h.01M3.055 11a9 9 0 1117.89 0 9 9 0 01-17.89 0z" />
                      ) : (
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                      )}
                    </svg>
                  )}
                  STATUS: {statusLabel}
                </span>

                {/* Action chip */}
                <span className="inline-flex items-center gap-1.5 rounded-full border border-indigo-500/30 bg-indigo-500/10 px-3 py-1 text-xs font-medium text-indigo-200">
                  <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                  </svg>
                  ACTION: {actionLabel}
                </span>

                {/* Last run chip */}
                <span className="inline-flex items-center gap-1.5 rounded-full border border-slate-600/60 bg-slate-700/20 px-3 py-1 text-xs font-medium text-slate-300">
                  <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                  </svg>
                  LAST RUN: {lastRunDisplay}
                </span>
              </div>
            </div>

            <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
              {/* System Deployment Panel */}
              <div className="relative overflow-hidden rounded-[28px] border border-[#1f2937] bg-gradient-to-br from-[#0d1020] via-[#0b0f16] to-[#05070a] p-8 shadow-2xl lg:col-span-2">
                {/* Ambient radial glow */}
                <div className="pointer-events-none absolute inset-0 rounded-[28px] bg-[radial-gradient(ellipse_at_top_right,rgba(99,102,241,0.1)_0%,transparent_65%)]" />
                {engineRunning && (
                  <div className="animate-glow-drift pointer-events-none absolute left-0 top-0 h-40 w-40 rounded-full bg-green-500/5 blur-2xl" />
                )}

                {/* Background bolt icon */}
                <div className="absolute right-6 top-6 opacity-[0.07]">
                  <svg className="h-36 w-36 text-indigo-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M13 10V3L4 14h7v7l9-11h-7z" />
                  </svg>
                </div>

                <h3 className="relative mb-6 text-sm font-semibold uppercase tracking-[0.2em] text-slate-500">System Deployment</h3>

                <div className="relative flex flex-col items-center justify-between gap-8 md:flex-row">
                  {/* Status info */}
                  <div className="space-y-3.5">
                    <div className="flex items-center space-x-4">
                      {/* Animated status dot */}
                      {engineRunning ? (
                        <span className="relative flex h-3 w-3">
                          <span className="animate-ping-slow absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75" />
                          <span className="relative inline-flex h-3 w-3 rounded-full bg-green-500 shadow-[0_0_14px_rgba(34,197,94,0.8)]" />
                        </span>
                      ) : (
                        <span className="h-3 w-3 rounded-full bg-slate-700 shadow-inner" />
                      )}
                      <span className="text-2xl font-semibold tracking-tight text-white">
                        {engineRunning ? 'Engine Online' : 'System Idle'}
                      </span>
                    </div>
                    <p className="max-w-sm text-sm leading-relaxed text-slate-400">
                      {scraperStatus?.details || 'Awaiting manual trigger for daily synchronization task.'}
                    </p>
                    {error && <p className="max-w-sm text-sm font-medium text-red-400">{error}</p>}

                    {/* Progress tracker */}
                    <div className="max-w-md space-y-2 rounded-xl border border-[#1f2937] bg-[#05070a]/80 p-3.5">
                      <div className="flex items-center justify-between text-[11px]">
                        <span className="font-medium tracking-wide text-slate-400">Run Stage</span>
                        <span className={`font-semibold ${showErrorChip ? 'text-red-400' : engineRunning ? 'text-green-400' : 'text-slate-300'}`}>
                          {runStage}
                        </span>
                      </div>
                      <div className="h-2 w-full overflow-hidden rounded-full bg-slate-800/80">
                        <div
                          className={`h-full rounded-full transition-all duration-700 ${
                            showErrorChip
                              ? 'bg-red-500'
                              : engineRunning || scraping || rangeScraping
                                ? 'animate-bar-shimmer'
                                : runProgress === 100
                                  ? 'bg-green-600'
                                  : 'bg-slate-600'
                          }`}
                          style={{ width: `${runProgress}%` }}
                        />
                      </div>
                      <div className="text-[11px] text-slate-500">{runProgress}% complete</div>
                    </div>
                  </div>

                  {/* Action Buttons */}
                  <div className="w-full max-w-md rounded-2xl border border-[#1f2937] bg-[#060a12]/80 p-2">
                    <div className="grid grid-cols-2 gap-1.5">
                      <button
                        type="button"
                        title="Scrape yesterday only"
                        onClick={() => void startQuickYesterdayScrape()}
                        disabled={scraping || rangeScraping || engineRunning || refreshing || stopping}
                        className={`relative inline-flex flex-col items-center justify-center gap-0.5 rounded-xl px-3 py-2.5 text-xs font-semibold transition-all active:scale-95 sm:flex-row sm:gap-2 sm:px-4 sm:py-3 sm:text-sm ${
                          scraping || rangeScraping || engineRunning || refreshing || stopping
                            ? 'border border-slate-800 bg-slate-900 text-slate-700'
                            : 'animate-pulse-indigo border border-indigo-500/50 bg-indigo-500/20 text-indigo-100 hover:bg-indigo-500/30 hover:border-indigo-400/70'
                        }`}
                      >
                        <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-current" />
                        <span>{scraping ? '…' : 'RUN'}</span>
                        <span className="text-[10px] font-normal text-indigo-200/80 sm:hidden">yesterday</span>
                      </button>

                      <button
                        type="button"
                        title="Use From / To filters above"
                        onClick={() => requestRangeScrape()}
                        disabled={scraping || rangeScraping || engineRunning || refreshing || stopping || !canRunRange}
                        className={`inline-flex flex-col items-center justify-center gap-0.5 rounded-xl border px-3 py-2.5 text-xs font-semibold transition-all active:scale-95 sm:flex-row sm:gap-2 sm:px-4 sm:py-3 sm:text-sm ${
                          scraping || rangeScraping || engineRunning || refreshing || stopping || !canRunRange
                            ? 'border-slate-700 bg-slate-900 text-slate-600'
                            : 'border-amber-500/40 bg-amber-500/15 text-amber-100 hover:bg-amber-500/25 hover:border-amber-400/60'
                        }`}
                      >
                        <span>{rangeScraping ? '…' : 'Range'}</span>
                        <span className="text-[10px] font-normal text-amber-200/70 sm:hidden">from filters</span>
                      </button>

                      <button
                        type="button"
                        onClick={() => void refreshDashboard()}
                        disabled={refreshing || scraping || rangeScraping || stopping}
                        className={`inline-flex items-center justify-center gap-2 rounded-xl border px-4 py-3 text-sm font-semibold transition-all active:scale-95 ${
                          refreshing || scraping || rangeScraping || stopping
                            ? 'border-slate-700 bg-slate-900 text-slate-600'
                            : 'border-slate-500/50 bg-slate-700/25 text-slate-100 hover:bg-slate-700/40 hover:border-slate-400/60'
                        }`}
                      >
                        <svg className={`h-3.5 w-3.5 ${refreshing ? 'animate-spin' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582M20 20v-5h-.581M5.341 15A8 8 0 0018.66 9M18.659 9A8 8 0 005.34 15" />
                        </svg>
                        {refreshing ? '...' : 'SYNC'}
                      </button>

                      <button
                        type="button"
                        onClick={() => void stopScraping()}
                        disabled={!engineRunning || scraping || rangeScraping || refreshing || stopping}
                        className={`inline-flex items-center justify-center gap-2 rounded-xl border px-4 py-3 text-sm font-semibold transition-all active:scale-95 ${
                          !engineRunning || scraping || rangeScraping || refreshing || stopping
                            ? 'border-slate-700 bg-slate-900 text-slate-700'
                            : 'border-red-500/50 bg-red-500/20 text-red-100 hover:bg-red-500/30 hover:border-red-400/70'
                        }`}
                      >
                        <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 6h12v12H6z" />
                        </svg>
                        {stopping ? '...' : 'STOP'}
                      </button>
                    </div>
                    {rangeValidationMessage && (
                      <p className="mt-2 px-1 text-[11px] text-slate-500">{rangeValidationMessage}</p>
                    )}
                  </div>
                </div>
              </div>

              {/* Node Stats Panel */}
              <div className="relative flex flex-col justify-between overflow-hidden rounded-[28px] border border-[#1f2937] bg-gradient-to-br from-[#0d1020] to-[#0b0f16] p-8 shadow-2xl">
                <div className="pointer-events-none absolute inset-0 rounded-[28px] bg-[radial-gradient(ellipse_at_bottom_left,rgba(99,102,241,0.07)_0%,transparent_60%)]" />
                <h3 className="relative mb-6 text-sm font-semibold uppercase tracking-[0.2em] text-slate-500">Node Stats</h3>
                <div className="relative space-y-5">
                  {[
                    { label: 'Database Nodes', value: stats?.totalRecords || 0, color: 'text-indigo-300' },
                    { label: 'Unique Targets', value: stats?.uniqueVehicleCount || 0, color: 'text-green-300' },
                    { label: 'Active Regions', value: stats?.districtCount || 0, color: 'text-amber-300' },
                  ].map((s, i) => (
                    <div key={i} className="flex items-end justify-between border-b border-[#1f2937] pb-3.5 last:border-0">
                      <span className="text-[11px] font-medium tracking-wide text-slate-400">{s.label}</span>
                      <span className={`text-xl font-bold ${s.color}`}>{s.value.toLocaleString()}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </section>

          {/* ── Recent Activity ── */}
          <section className="space-y-4">
            <div>
              <h2 className="text-lg font-semibold text-white">Recent Activity</h2>
              <p className="text-sm text-slate-500">Latest updates and refresh actions.</p>
            </div>
            <div className="rounded-2xl border border-[#1f2937] bg-[#0b0f16] p-5 md:p-6">
              <div className="space-y-1">
                {activityEvents.map((event, index) => (
                  <div
                    key={`${event.title}-${index}`}
                    className={`animate-fade-up flex items-start gap-0 overflow-hidden rounded-xl transition-all ${
                      event.type === 'success'
                        ? 'bg-green-500/5 hover:bg-green-500/8'
                        : event.type === 'warning'
                          ? 'bg-amber-500/5 hover:bg-amber-500/8'
                          : event.type === 'error'
                            ? 'bg-red-500/5 hover:bg-red-500/8'
                            : 'bg-indigo-500/5 hover:bg-indigo-500/8'
                    }`}
                    style={{ animationDelay: `${index * 60}ms` }}
                  >
                    {/* Color bar */}
                    <div className={`w-1 self-stretch shrink-0 rounded-l-xl ${
                      event.type === 'success' ? 'bg-green-500' :
                      event.type === 'warning' ? 'bg-amber-500' :
                      event.type === 'error'   ? 'bg-red-500'   :
                                                  'bg-indigo-500'
                    }`} />
                    <div className="flex-1 min-w-0 px-4 py-3">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <p className="text-sm font-semibold text-slate-100">{event.title}</p>
                        <span className="text-xs text-slate-500">{event.time}</span>
                      </div>
                      <p className="mt-0.5 text-sm text-slate-400">{event.detail}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </section>
        </>
      )}

      {/* ══════════════ LOGS TAB ══════════════ */}
      {activeTab === 'logs' && (
        <section className="space-y-5 rounded-2xl border border-[#1f2937] bg-[#0b0f16] p-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-lg font-semibold text-white">Updates & Alerts</h2>
              <p className="text-sm text-slate-500">See recent updates and any important alerts in one place.</p>
            </div>
            <div className="flex items-center gap-2">
              <span className="rounded-full border border-[#1f2937] bg-[#05070a] px-3 py-1 text-xs text-slate-300">
                Open alerts: {alertHistory.filter((item) => item.status === 'open').length}
              </span>
              <button
                type="button"
                onClick={() => {
                  setAlertHistory([]);
                  localStorage.removeItem(ALERT_HISTORY_KEY);
                  pushToast('info', 'Alert history cleared.');
                }}
                className="rounded-full border border-[#1f2937] bg-[#05070a] px-3 py-1 text-xs text-slate-300 transition hover:border-slate-500 hover:text-white"
              >
                Clear history
              </button>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {[
              { key: 'all', label: `All (${alertHistory.length})` },
              { key: 'open', label: `Open (${alertHistory.filter((item) => item.status === 'open').length})` },
              { key: 'resolved', label: `Resolved (${alertHistory.filter((item) => item.status === 'resolved').length})` },
            ].map((filter) => (
              <button
                key={filter.key}
                type="button"
                onClick={() => setLogFilter(filter.key as 'all' | 'open' | 'resolved')}
                className={`rounded-full border px-3 py-1 text-xs transition ${
                  logFilter === filter.key
                    ? 'border-indigo-500/40 bg-indigo-500/15 text-indigo-100'
                    : 'border-[#1f2937] bg-[#05070a] text-slate-300 hover:border-slate-500 hover:text-white'
                }`}
              >
                {filter.label}
              </button>
            ))}
          </div>

          {filteredAlertHistory.length === 0 ? (
            <div className="rounded-xl border border-[#1f2937] bg-[#05070a] p-6 text-center">
              <p className="text-sm font-medium text-slate-200">
                {logFilter === 'all' ? 'No alerts yet.' : logFilter === 'open' ? 'No open alerts right now.' : 'No resolved alerts yet.'}
              </p>
              <p className="mt-1 text-sm text-slate-500">
                {logFilter === 'all' ? 'Alerts will appear here whenever attention is needed.' : 'Try switching filters to view other alert records.'}
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              {filteredAlertHistory.map((item, idx) => (
                <div
                  key={`${item.id}-${idx}`}
                  className={`animate-fade-up rounded-xl border px-4 py-3 ${
                    item.severity === 'error' ? 'border-red-500/30 bg-red-500/10' : 'border-amber-500/30 bg-amber-500/10'
                  }`}
                  style={{ animationDelay: `${idx * 40}ms` }}
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <p className={`text-sm font-semibold ${item.severity === 'error' ? 'text-red-200' : 'text-amber-200'}`}>{item.title}</p>
                      <span className={`rounded-full border px-2 py-0.5 text-[10px] font-medium ${
                        item.status === 'open'
                          ? 'border-red-400/40 bg-red-500/15 text-red-100'
                          : 'border-green-400/40 bg-green-500/15 text-green-100'
                      }`}>
                        {item.status === 'open' ? 'Open' : 'Resolved'}
                      </span>
                    </div>
                    <span className="text-xs text-slate-400">
                      {new Date(item.lastSeenAt).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}
                    </span>
                  </div>
                  <p className={`mt-1 text-sm ${item.severity === 'error' ? 'text-red-300' : 'text-amber-300'}`}>{item.detail}</p>
                </div>
              ))}
            </div>
          )}

          <div className="rounded-xl border border-[#1f2937] bg-[#05070a] p-4">
            <h3 className="text-sm font-semibold text-white">Recent updates</h3>
            <div className="mt-3 space-y-1">
              {activityEvents.map((event, index) => (
                <div
                  key={`log-event-${index}`}
                  className={`flex items-start gap-0 overflow-hidden rounded-lg ${
                    event.type === 'success' ? 'bg-green-500/5' :
                    event.type === 'warning' ? 'bg-amber-500/5' :
                    event.type === 'error'   ? 'bg-red-500/5'   :
                                               'bg-indigo-500/5'
                  }`}
                >
                  <div className={`w-0.5 self-stretch shrink-0 ${
                    event.type === 'success' ? 'bg-green-500' :
                    event.type === 'warning' ? 'bg-amber-500' :
                    event.type === 'error'   ? 'bg-red-500'   :
                                               'bg-indigo-500'
                  }`} />
                  <div className="flex flex-1 items-start justify-between gap-3 px-3 py-2">
                    <p className="text-sm text-slate-300">{event.title}</p>
                    <span className="text-xs text-slate-500 shrink-0">{event.time}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>
      )}

      {/* ══════════════ CONFIG TAB ══════════════ */}
      {activeTab === 'config' && (
        <section className="rounded-2xl border border-[#1f2937] bg-[#0b0f16] p-8 text-center">
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full border border-slate-700 bg-slate-800/60 text-slate-400">
            <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
          </div>
          <h2 className="text-lg font-semibold text-white">Settings</h2>
          <p className="mt-2 text-sm text-slate-500">More settings will be available soon.</p>
        </section>
      )}
    </div>
  );
}
