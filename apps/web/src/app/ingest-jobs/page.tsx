'use client';

import { useQuery } from '@tanstack/react-query';
import { useVirtualizer } from '@tanstack/react-virtual';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useRef, useState } from 'react';

import {
  apiFetch,
  apiUrl,
  clearSpybotToken,
  getSpybotToken,
  NEST_V2_PROXY_NETWORK_ERROR,
  NO_SPYBOT_JWT_MESSAGE,
} from '@/lib/api-client';
import { StatusBarChart } from '@/components/StatusBarChart';
import { downloadCsv } from '@/lib/csv-export';

const DEFAULT_LIMIT = 50;

type ScrapeJobRow = {
  id: string;
  kind: string;
  status: string;
  priority: number;
  createdAt: string;
  updatedAt: string;
};

type SliceErrorDiag = {
  status: number;
  requestId?: string;
  traceId?: string;
};

async function fetchScrapeJobsSlice(opts: {
  limit: string;
  statusParam: string;
  queryParam: string;
  token: string;
  router: ReturnType<typeof useRouter>;
}): Promise<
  | {
      variant: 'ok';
      rows: ScrapeJobRow[];
      meta: {
        asOf?: string;
        totalApprox?: number;
        take?: number;
        limit?: number;
        filterStatus?: string | null;
        filterQuery?: string | null;
      };
    }
  | { variant: 'json'; raw: string }
  | { variant: 'error'; msg: string; extra: SliceErrorDiag }
> {
  const { limit, statusParam, queryParam, token, router } = opts;

  const url = new URL(apiUrl('/api/v2/ingest/scrape-jobs'));
  const lim = limit.trim() || String(DEFAULT_LIMIT);
  url.searchParams.set('limit', lim);
  const st = statusParam.trim();
  if (st) url.searchParams.set('status', st);
  const qc = queryParam.trim();
  if (qc) url.searchParams.set('q', qc);

  const res = await apiFetch(`${url.pathname}${url.search}`, token, { acceptJson: true });

  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  const headerRid = res.headers.get('x-request-id')?.trim() || undefined;

  if (res.status === 401) {
    clearSpybotToken();
    router.replace('/login');
    return {
      variant: 'error',
      msg: NO_SPYBOT_JWT_MESSAGE,
      extra: { status: res.status },
    };
  }

  if (!res.ok) {
    const msg =
      (typeof data.error === 'string' && data.error) ||
      (typeof data.message === 'string' && data.message) ||
      `HTTP ${res.status}`;
    const bodyRid = typeof data.requestId === 'string' ? data.requestId : undefined;
    const bodyTrace = typeof data.traceId === 'string' ? data.traceId : undefined;
    return {
      variant: 'error',
      msg,
      extra: {
        status: res.status,
        requestId: bodyRid || headerRid,
        traceId: bodyTrace,
      },
    };
  }

  if (data.status === 'ok' && Array.isArray(data.rows)) {
    const filters = data.filters as { status?: string | null; q?: string | null } | undefined;
    return {
      variant: 'ok',
      rows: data.rows as ScrapeJobRow[],
      meta: {
        asOf: typeof data.asOf === 'string' ? data.asOf : undefined,
        totalApprox: typeof data.totalApprox === 'number' ? data.totalApprox : undefined,
        take: typeof data.take === 'number' ? data.take : undefined,
        limit: typeof data.limit === 'number' ? data.limit : undefined,
        filterStatus: filters?.status ?? null,
        filterQuery: filters?.q ?? null,
      },
    };
  }

  return { variant: 'json', raw: JSON.stringify(data, null, 2) };
}

function ingestQsFromDraft(pathname: string, draftLimit: string, draftStatus: string, draftQ: string) {
  const p = new URLSearchParams();
  const lim = draftLimit.trim() || String(DEFAULT_LIMIT);
  p.set('limit', lim);
  const st = draftStatus.trim();
  if (st) p.set('status', st);
  const qc = draftQ.trim();
  if (qc) p.set('q', qc);
  return `${pathname}?${p.toString()}`;
}

export default function IngestJobsPage() {
  return (
    <Suspense
      fallback={
        <div className="mx-auto max-w-6xl px-6 py-10 text-sm text-slate-400">Loading ingest filters…</div>
      }
    >
      <IngestJobsPageBody />
    </Suspense>
  );
}

function IngestJobsPageBody() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const scrollParentRef = useRef<HTMLDivElement>(null);
  const [draftLimit, setDraftLimit] = useState(String(DEFAULT_LIMIT));
  const [draftStatus, setDraftStatus] = useState('');
  const [draftQ, setDraftQ] = useState('');
  const [mounted, setMounted] = useState(false);

  const qsKey = searchParams.toString();

  useEffect(() => {
    void setMounted(true);
  }, []);

  useEffect(() => {
    const p = new URLSearchParams(qsKey);
    const limRaw = p.get('limit');
    setDraftLimit(limRaw?.trim() && limRaw.trim() !== '' ? limRaw.trim() : String(DEFAULT_LIMIT));
    setDraftStatus(p.get('status') ?? '');
    setDraftQ(p.get('q') ?? '');
  }, [qsKey]);

  const sessionOk = mounted && Boolean(getSpybotToken());

  const ingestQuery = useQuery({
    queryKey: ['v2-ingest-scrape-jobs', qsKey] as const,
    enabled: sessionOk,
    queryFn: async ({ queryKey }) => {
      const token = getSpybotToken();
      if (!token) {
        throw new Error(NO_SPYBOT_JWT_MESSAGE);
      }
      const [, qp] = queryKey;
      const p = new URLSearchParams(qp);
      const limit = (p.get('limit') ?? String(DEFAULT_LIMIT)).trim() || String(DEFAULT_LIMIT);
      const statusParam = (p.get('status') ?? '').trim();
      const queryParam = (p.get('q') ?? '').trim();
      const result = await fetchScrapeJobsSlice({
        limit,
        statusParam,
        queryParam,
        token,
        router,
      });
      if (result.variant === 'error') {
        const err = Object.assign(new Error(result.msg), { diag: result.extra }) as Error & {
          diag: SliceErrorDiag;
        };
        throw err;
      }
      return result;
    },
  });

  const loading = Boolean(sessionOk) && ingestQuery.isPending;
  const rows = ingestQuery.data?.variant === 'ok' ? ingestQuery.data.rows : null;
  const meta = ingestQuery.data?.variant === 'ok' ? ingestQuery.data.meta : null;
  const jsonOut = ingestQuery.data?.variant === 'json' ? ingestQuery.data.raw : null;

  let errorMsg: string | null = null;
  let errorExtra: SliceErrorDiag | null = null;
  if (!sessionOk && mounted) {
    errorMsg = NO_SPYBOT_JWT_MESSAGE;
  }
  if (ingestQuery.isError && sessionOk && !loading) {
    const e = ingestQuery.error;
    if (e instanceof Error) {
      errorMsg = e.message;
      const diag = (e as Error & { diag?: SliceErrorDiag }).diag;
      if (diag) errorExtra = diag;
    } else {
      errorMsg = NEST_V2_PROXY_NETWORK_ERROR;
    }
  }

  const virtualizer = useVirtualizer({
    count: rows?.length ?? 0,
    getScrollElement: () => scrollParentRef.current,
    estimateSize: () => 52,
    overscan: 12,
  });

  function applyFiltersToUrl() {
    router.replace(ingestQsFromDraft(pathname, draftLimit, draftStatus, draftQ), {
      scroll: false,
    });
  }

  return (
    <div className="mx-auto max-w-6xl space-y-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.2em] text-indigo-400">Analytics</p>
          <h1 className="mt-2 text-2xl font-bold tracking-tight text-white">Ingest jobs</h1>
          <p className="mt-1 text-sm text-slate-500">
            Nest ingest <code className="text-slate-400">ScrapeJob</code> ·{' '}
            <code className="text-slate-400">GET /api/v2/ingest/scrape-jobs</code> accepts{' '}
            <code className="text-slate-400">limit</code>, optional{' '}
            <code className="text-slate-400">status</code>, optional{' '}
            <code className="text-slate-400">q</code> substring search{' '}
            <code className="text-slate-400">Bearer JWT</code> · httpOnly{' '}
            <code className="text-slate-400">spybot_access</code> cookie).
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <Link
            href="/raw-khanan"
            className="text-xs font-semibold uppercase tracking-wider text-indigo-400 hover:text-indigo-300"
          >
            Raw Khanan
          </Link>
          <Link
            href="/raw-fitness"
            className="text-xs font-semibold uppercase tracking-wider text-indigo-400 hover:text-indigo-300"
          >
            Raw fitness
          </Link>
        </div>
      </div>

      <section className="rounded-2xl border border-[#1f2937] bg-[#0b0f16]/80 p-6 shadow-lg">
        <h2 className="mb-4 text-sm font-bold uppercase tracking-widest text-slate-500">Ingest slice</h2>

        <div className="flex flex-col gap-4 sm:flex-row sm:flex-wrap sm:items-end">
          <label className="block min-w-0 flex-1 sm:max-w-[200px]">
            <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-slate-500">
              limit (1–200, default 50)
            </span>
            <input
              value={draftLimit}
              onChange={(e) => setDraftLimit(e.target.value)}
              inputMode="numeric"
              className="w-full rounded-xl border border-[#1f2937] bg-[#05070a] px-3 py-2.5 text-sm text-slate-200 outline-none focus:border-indigo-500/50"
            />
          </label>
          <label className="block min-w-0 flex-1 sm:max-w-[220px]">
            <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-slate-500">
              status (optional, exact)
            </span>
            <input
              value={draftStatus}
              onChange={(e) => setDraftStatus(e.target.value)}
              placeholder="e.g. queued"
              className="w-full rounded-xl border border-[#1f2937] bg-[#05070a] px-3 py-2.5 text-sm text-slate-200 outline-none focus:border-indigo-500/50"
            />
          </label>
          <label className="block min-w-0 flex-1 sm:max-w-[260px]">
            <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-slate-500">
              q · kind / status / error / id substring
            </span>
            <input
              value={draftQ}
              onChange={(e) => setDraftQ(e.target.value)}
              placeholder="Type & apply / reload below"
              className="w-full rounded-xl border border-[#1f2937] bg-[#05070a] px-3 py-2.5 text-sm text-slate-200 outline-none focus:border-indigo-500/50"
            />
          </label>
          <button
            type="button"
            disabled={loading}
            onClick={() => applyFiltersToUrl()}
            className="shrink-0 rounded-xl bg-gradient-to-r from-indigo-600 to-blue-600 px-6 py-2.5 text-sm font-bold text-white shadow-lg shadow-indigo-900/30 hover:from-indigo-500 hover:to-blue-500 disabled:opacity-50"
          >
            {loading ? 'Loading…' : 'Apply & reload'}
          </button>
        </div>

        {errorMsg && (
          <div className="mt-4 rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">
            <p>{errorMsg}</p>
            {errorExtra && (
              <div className="mt-2 space-y-1 border-t border-red-500/20 pt-2 font-mono text-[11px] text-red-200/90">
                <p>
                  HTTP <span className="select-all">{errorExtra.status}</span>
                </p>
                {errorExtra.requestId && (
                  <p>
                    requestId: <span className="select-all">{errorExtra.requestId}</span>
                  </p>
                )}
                {errorExtra.traceId && (
                  <p>
                    traceId: <span className="select-all">{errorExtra.traceId}</span>
                  </p>
                )}
              </div>
            )}
          </div>
        )}

        {rows && rows.length > 0 && (
          <div className="mt-4 space-y-2">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="text-xs font-semibold uppercase tracking-wider text-emerald-500/90">
                ScrapeJob
                {meta?.totalApprox != null ? ` · ${meta.totalApprox} total (approx.)` : ''}
                {rows.length ? ` · showing ${rows.length}` : ''}
                {meta?.limit != null ? ` · limit ${meta.limit}` : ''}
                {meta?.filterStatus != null && meta.filterStatus !== ''
                  ? ` · status filter ${meta.filterStatus}`
                  : ''}
                {meta?.filterQuery != null && meta.filterQuery !== ''
                  ? ` · q=${meta.filterQuery}`
                  : ''}
                {meta?.asOf ? ` · asOf ${meta.asOf}` : ''}
              </p>
              <button
                type="button"
                onClick={() =>
                  downloadCsv({
                    filename: `scrape-jobs-${new Date().toISOString().slice(0, 10)}`,
                    columns: ['id', 'kind', 'status', 'priority', 'createdAt', 'updatedAt'],
                    rows: rows.map((r) => [r.id, r.kind, r.status, r.priority, r.createdAt, r.updatedAt]),
                  })
                }
                className="shrink-0 rounded-lg border border-[#1f2937] bg-[#05070a] px-3 py-1.5 text-[11px] font-bold uppercase tracking-wider text-slate-400 hover:border-indigo-500/50 hover:text-indigo-300"
              >
                ↓ Export CSV
              </button>
            </div>
            <div className="overflow-x-auto rounded-xl border border-[#1f2937] bg-[#05070a]">
              <div className="min-w-[720px]">
                <div className="grid grid-cols-6 gap-2 border-b border-[#1f2937] bg-[#0b0f16] px-3 py-2 text-[11px] font-bold uppercase tracking-wider text-slate-500">
                  <span>id</span>
                  <span>kind</span>
                  <span>status</span>
                  <span>priority</span>
                  <span>createdAt</span>
                  <span>updatedAt</span>
                </div>
                <div ref={scrollParentRef} className="max-h-[min(60vh,480px)] overflow-auto">
                  <div
                    style={{ height: `${virtualizer.getTotalSize()}px` }}
                    className="relative w-full divide-y divide-[#1f2937]/80"
                  >
                    {virtualizer.getVirtualItems().map((vi) => {
                      const row = rows![vi.index];
                      return (
                        <div
                          key={vi.key}
                          className="absolute left-0 top-0 grid w-full grid-cols-6 gap-2 px-3 py-2 text-sm text-slate-200"
                          style={{ transform: `translateY(${vi.start}px)` }}
                        >
                          <span className="truncate font-mono text-xs text-slate-500" title={row.id}>
                            {row.id}
                          </span>
                          <span className="truncate font-mono text-xs text-indigo-200/95">{row.kind}</span>
                          <span className="truncate font-mono text-xs text-slate-300">{row.status}</span>
                          <span className="whitespace-nowrap font-mono text-xs text-slate-500">
                            {row.priority}
                          </span>
                          <span className="whitespace-nowrap font-mono text-xs text-slate-500">
                            {row.createdAt}
                          </span>
                          <span className="whitespace-nowrap font-mono text-xs text-slate-500">
                            {row.updatedAt}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {rows && rows.length === 0 && !loading && sessionOk && !errorMsg && (
          <p className="mt-4 text-sm text-slate-500">No rows returned for this slice.</p>
        )}

        {rows && rows.length > 0 && (() => {
          const statusCounts: Record<string, number> = {};
          for (const r of rows) statusCounts[r.status] = (statusCounts[r.status] ?? 0) + 1;
          const chartData = Object.entries(statusCounts)
            .sort((a, b) => b[1] - a[1])
            .map(([label, value]) => ({ label, value }));
          return (
            <div className="mt-6 rounded-xl border border-[#1f2937] bg-[#05070a] p-4">
              <StatusBarChart
                data={chartData}
                title="Status distribution (this slice)"
                height={Math.max(80, chartData.length * 28 + 16)}
              />
            </div>
          );
        })()}

        {jsonOut && (
          <div className="mt-4">
            <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-emerald-500/90">Response</p>
            <pre className="max-h-[480px] overflow-auto rounded-xl border border-[#1f2937] bg-[#05070a] p-4 font-mono text-xs leading-relaxed text-slate-200">
              {jsonOut}
            </pre>
          </div>
        )}
      </section>
    </div>
  );
}
