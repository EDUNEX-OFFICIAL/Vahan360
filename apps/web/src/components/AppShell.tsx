'use client';

import { useEffect, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import Sidebar from '@/components/Sidebar';
import {
  LEGACY_JWT_STORAGE_KEY,
  clearSpybotToken,
  getApiBaseUrl,
  getSpybotToken,
} from '@/lib/api-client';
const MIGRATION_DONE_KEY = '__spybot_migration_done__';

const routeLabels: Record<string, string> = {
  leads: 'Leads Analysis',
  pipeline: 'Pipeline',
  khanansoft: 'Khanan Soft',
  'failed-vehicles': 'Failed Assets',
  testing: 'Testing',
  login: 'Login',
  'scrape-console': 'Scrape console',
  'vehicle-intelligence': 'Vehicle Intelligence',
  compliance: 'Compliance',
  trips: 'Trips',
  districts: 'Districts',
  'raw-khanan': 'Raw Khanan',
  'raw-vehicle': 'Raw Vehicle',
  'raw-challan': 'Raw Challan',
  'ingest-jobs': 'Ingest jobs',
  'ops-snapshot': 'Ops snapshot',
  'audit-logs': 'Audit logs',
  'failed-jobs': 'Failed jobs',
  consigners: 'Consigners',
  permits: 'Permits',
  insurance: 'Insurance',
  'selector-health': 'Selector health',
};

function toTitleCase(value: string) {
  return value
    .split('-')
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function readCookie(name: string): string | null {
  if (typeof window === 'undefined') return null;
  const encoded = `${encodeURIComponent(name)}=`;
  const chunks = document.cookie ? document.cookie.split('; ') : [];
  for (const chunk of chunks) {
    if (!chunk.startsWith(encoded)) continue;
    try {
      return decodeURIComponent(chunk.slice(encoded.length));
    } catch {
      return chunk.slice(encoded.length);
    }
  }
  return null;
}

export default function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const isLogin = pathname === '/login';
  const [headerSearch, setHeaderSearch] = useState('');
  /**
   * Gate only protected routes — login renders immediately.
   * On client, if user hits a dashboard URL without a token, stay on loading until effect redirects.
   */
  const [isCheckingAuth, setIsCheckingAuth] = useState(!isLogin);
  const [showMigrationBanner, setShowMigrationBanner] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const w = window as typeof window & {
      __spybotFetchWrapped?: boolean;
      __spybotOriginalFetch?: typeof window.fetch;
    };
    if (w.__spybotFetchWrapped) return;

    const base = getApiBaseUrl().replace(/\/$/, '');
    const original = window.fetch.bind(window);
    w.__spybotOriginalFetch = original;
    w.__spybotFetchWrapped = true;
    window.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const raw = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      const isApiCall = raw.startsWith(base) || raw.startsWith('/api/');
      if (!isApiCall) return original(input, init);

      const withCreds = { ...(init || {}), credentials: 'include' as const };
      const res = await original(input, withCreds);
      if (res.status !== 401) return res;

      const method = String(withCreds.method || 'GET').toUpperCase();
      if (method !== 'GET' && method !== 'HEAD') return res;
      if (raw.includes('/api/auth/refresh') || raw.includes('/api/auth/generate-token')) return res;

      const csrf = readCookie('spybot_csrf');
      const refreshHeaders: Record<string, string> = {};
      if (csrf) refreshHeaders['X-CSRF-Token'] = csrf;
      const refresh = await original(`${base}/api/auth/refresh`, {
        method: 'POST',
        credentials: 'include',
        headers: refreshHeaders,
      });
      if (!refresh.ok) return res;

      return original(input, withCreds);
    }) as typeof window.fetch;
  }, []);

  // One-time sweep: clear legacy localStorage JWT key; sessionStorage avoids redirect loops.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      if (sessionStorage.getItem(MIGRATION_DONE_KEY)) return;
      const hasLegacy = Boolean(localStorage.getItem(LEGACY_JWT_STORAGE_KEY));
      if (!hasLegacy) return;
      clearSpybotToken();
      sessionStorage.setItem(MIGRATION_DONE_KEY, '1');
      queueMicrotask(() => {
        setShowMigrationBanner(true);
        setTimeout(() => setShowMigrationBanner(false), 5000);
      });
      // If no active cookie session on a protected page, push to login.
      if (!isLogin && !getSpybotToken()) {
        router.replace('/login');
      }
    } catch {
      // localStorage/sessionStorage blocked in strict privacy modes — safe to ignore.
    }
  }, [isLogin, router]);

  useEffect(() => {
    if (typeof window === 'undefined') return;

    if (isLogin) {
      const token = getSpybotToken();
      if (token) {
        router.replace('/dashboard/leads');
      }
      return;
    }

    const token = getSpybotToken();
    if (!token) {
      router.replace('/login');
      return;
    }

    queueMicrotask(() => setIsCheckingAuth(false));
  }, [isLogin, pathname, router]);

  if (isLogin) {
    return (
      <div className="min-h-screen w-full">
        {showMigrationBanner && (
          <div
            role="status"
            aria-live="polite"
            className="fixed top-4 right-4 z-[9999] flex items-center gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-2 text-xs text-amber-300 backdrop-blur-sm shadow-lg"
          >
            <svg className="h-3.5 w-3.5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden>
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
            </svg>
            Session migrated — please log in again with your cookie-secured session.
          </div>
        )}
        {children}
      </div>
    );
  }

  if (isCheckingAuth) {
    return (
      <div
        className="min-h-screen w-full bg-[#05070a] flex items-center justify-center"
        aria-busy="true"
        aria-label="Checking session"
      >
        <span className="text-slate-500 text-sm">Loading...</span>
      </div>
    );
  }

  const pathParts = pathname.split('/').filter(Boolean);
  const firstSeg = pathParts[0];
  const analyticsAppRoutes = new Set([
    'districts',
    'raw-khanan',
    'raw-vehicle',
    'raw-challan',
    'ingest-jobs',
    'ops-snapshot',
    'audit-logs',
    'failed-jobs',
  ]);
  const mainCrumb =
    firstSeg && analyticsAppRoutes.has(firstSeg)
      ? 'Analytics'
      : firstSeg
        ? routeLabels[firstSeg] || toTitleCase(firstSeg)
        : 'Dashboard';
  const subCrumb =
    firstSeg && analyticsAppRoutes.has(firstSeg)
      ? routeLabels[firstSeg] || toTitleCase(firstSeg)
      : pathParts[1]
        ? routeLabels[pathParts[1]] || toTitleCase(pathParts[1])
        : 'Overview';

  return (
    <>
      {showMigrationBanner && (
        <div
          role="status"
          aria-live="polite"
          className="fixed top-4 right-4 z-[9999] flex items-center gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-2 text-xs text-amber-300 backdrop-blur-sm shadow-lg"
        >
          <svg className="h-3.5 w-3.5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden>
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
          </svg>
          Session migrated to secure cookies — please log in again if prompted.
        </div>
      )}

      {/* ── Fixed blob layer — behind everything ── */}
      <div className="pointer-events-none fixed inset-0 z-0 overflow-hidden" aria-hidden>
        {/* Top-left — indigo (brand) */}
        <div className="animate-blob-a absolute left-0 top-0 h-[480px] w-[480px] rounded-full bg-indigo-500/[0.07] blur-[110px]" />
        {/* Bottom-right — teal */}
        <div className="animate-blob-b absolute bottom-0 right-0 h-[520px] w-[520px] rounded-full bg-teal-500/[0.06] blur-[120px]" style={{ animationDelay: '5s' }} />
        {/* Top-right — rose */}
        <div className="animate-blob-c absolute right-0 top-0 h-[400px] w-[400px] rounded-full bg-rose-500/[0.05] blur-[100px]" style={{ animationDelay: '2s' }} />
        {/* Bottom-left — amber */}
        <div className="animate-blob-b absolute bottom-0 left-0 h-[360px] w-[360px] rounded-full bg-amber-500/[0.04] blur-[110px]" style={{ animationDelay: '8s' }} />
      </div>

      <Sidebar />

      <div className="relative z-10 flex-1 min-w-0 flex flex-col min-h-screen">
        <header className="h-16 bg-[#0b0f16]/80 backdrop-blur-md border-b border-[#1f2937]/60 flex items-center justify-between px-8 sticky top-0 z-30" style={{ boxShadow: '0 1px 0 0 rgba(99,102,241,0.08)' }}>
          <div className="flex items-center text-sm font-medium text-slate-400">
            <span className="hover:text-white cursor-pointer transition-colors">{mainCrumb}</span>
            <span className="mx-3 text-slate-700">/</span>
            <span className="bg-gradient-to-r from-white to-indigo-300 bg-clip-text text-transparent font-bold">{subCrumb}</span>
          </div>
          <div className="flex items-center space-x-6">
            <div className="relative group">
              <input
                type="text"
                placeholder="Search vehicle / leads..."
                value={headerSearch}
                onChange={(e) => setHeaderSearch(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && headerSearch.trim()) {
                    const q = encodeURIComponent(headerSearch.trim());
                    // Route to vehicle-intelligence for VRN-like queries, else leads
                    const isVrn = /^[A-Z]{2}\d{1,2}[A-Z]{1,3}\d{1,4}$/i.test(headerSearch.trim());
                    router.push(
                      isVrn
                        ? `/vehicle-intelligence?q=${q}`
                        : `/dashboard/leads?q=${q}`
                    );
                  }
                }}
                className="bg-[#05070a] border border-[#1f2937] rounded-lg px-10 py-1.5 text-xs text-white focus:outline-none focus:ring-1 focus:ring-blue-500/50 w-72 transition-all group-hover:border-slate-500"
              />
              <svg className="w-3.5 h-3.5 text-slate-500 absolute left-3.5 top-2.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
            </div>
          </div>
        </header>

        <main className="flex-1 min-w-0 overflow-y-auto overflow-x-hidden bg-[#05070a] p-8">{children}</main>
      </div>
    </>
  );
}
