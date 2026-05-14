'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';

import {
  apiFetch,
  apiUrl,
  clearSpybotToken,
  getSpybotToken,
  NEST_V2_PROXY_NETWORK_ERROR,
  NO_SPYBOT_JWT_MESSAGE,
} from '@/lib/api-client';
import { logAndUserFacingHttpError } from '@/lib/user-facing-errors';

const DEFAULT_LIMIT = 50;

type FailedJobRow = {
  id: string;
  queueName: string;
  jobName: string | null;
  bullJobId: string | null;
  correlationId: string | null;
  scrapeJobId: string | null;
  payload: unknown;
  errorMessage: string;
  errorStack: string | null;
  attempts: number;
  createdAt: string;
};

async function fetchFailedJobsSlice(opts: {
  limit: string;
  queueName: string;
  orderBy: 'desc' | 'asc';
  token: string;
  router: ReturnType<typeof useRouter>;
}): Promise<
  | { variant: 'ok'; rows: FailedJobRow[]; meta: { asOf?: string; totalApprox?: number } }
  | { variant: 'json'; raw: string }
  | { variant: 'error'; msg: string }
> {
  const { limit, queueName, orderBy, token, router } = opts;
  const url = new URL(apiUrl('/api/v2/system/failed-jobs'));
  const lim = limit.trim() || String(DEFAULT_LIMIT);
  url.searchParams.set('limit', lim);
  const qn = queueName.trim();
  if (qn) url.searchParams.set('queueName', qn);
  url.searchParams.set('orderBy', orderBy === 'asc' ? 'asc' : 'desc');

  const res = await apiFetch(`${url.pathname}${url.search}`, token, {
    acceptJson: true,
  });

  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;

  if (res.status === 401) {
    clearSpybotToken();
    router.replace('/login');
    return {
      variant: 'error',
      msg: NO_SPYBOT_JWT_MESSAGE,
    };
  }

  if (!res.ok) {
    return {
      variant: 'error',
      msg: logAndUserFacingHttpError(res, data, url.pathname),
    };
  }

  if (data.status === 'ok' && Array.isArray(data.rows)) {
    return {
      variant: 'ok',
      rows: data.rows as FailedJobRow[],
      meta: {
        asOf: typeof data.asOf === 'string' ? data.asOf : undefined,
        totalApprox: typeof data.totalApprox === 'number' ? data.totalApprox : undefined,
      },
    };
  }

  return { variant: 'json', raw: JSON.stringify(data, null, 2) };
}

export default function FailedJobsPage() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [limit, setLimit] = useState(String(DEFAULT_LIMIT));
  const [queueName, setQueueName] = useState('');
  const [orderBy, setOrderBy] = useState<'desc' | 'asc'>('desc');
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    void setMounted(true);
  }, []);

  const sessionOk = mounted && Boolean(getSpybotToken());

  const failedJobsQuery = useQuery({
    queryKey: ['v2-system-failed-jobs', limit, queueName, orderBy] as const,
    enabled: sessionOk,
    queryFn: async ({ queryKey }) => {
      const token = getSpybotToken();
      if (!token) {
        throw new Error(NO_SPYBOT_JWT_MESSAGE);
      }
      const [, limitKey, queueKey, orderKey] = queryKey;
      const result = await fetchFailedJobsSlice({
        limit: limitKey,
        queueName: queueKey,
        orderBy: orderKey,
        token,
        router,
      });
      if (result.variant === 'error') {
        throw new Error(result.msg);
      }
      return result;
    },
  });

  const replayMutation = useMutation({
    mutationFn: async (jobId: string) => {
      const token = getSpybotToken();
      if (!token) {
        throw new Error(NO_SPYBOT_JWT_MESSAGE);
      }
      const res = await apiFetch(`/api/v2/system/failed-jobs/${encodeURIComponent(jobId)}/replay`, token, {
        method: 'POST',
        acceptJson: true,
      });
      const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      if (res.status === 401) {
        clearSpybotToken();
        router.replace('/login');
        throw new Error(NO_SPYBOT_JWT_MESSAGE);
      }
      if (!res.ok) {
        throw new Error(logAndUserFacingHttpError(res, data, `/api/v2/system/failed-jobs/${jobId}/replay`));
      }
      return data as { status?: string; replayed?: boolean; queueName?: string; bullJobId?: string };
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['v2-system-failed-jobs'] });
      window.alert('Replay queue mein daal diya gaya / Replay was queued.');
    },
    onError: (e) => {
      window.alert(e instanceof Error ? e.message : NEST_V2_PROXY_NETWORK_ERROR);
    },
  });

  const loading = Boolean(sessionOk) && failedJobsQuery.isPending;

  let rows: FailedJobRow[] | null = null;
  let meta:
    | {
        asOf?: string;
        totalApprox?: number;
      }
    | null = null;
  let jsonOut: string | null = null;
  let errorMsg: string | null = null;

  if (!sessionOk && mounted) {
    errorMsg = NO_SPYBOT_JWT_MESSAGE;
  }

  const qPayload = failedJobsQuery.data;
  const qErr = failedJobsQuery.error;

  if (qPayload?.variant === 'ok') {
    rows = qPayload.rows;
    meta = qPayload.meta;
  } else if (qPayload?.variant === 'json') {
    jsonOut = qPayload.raw;
  }

  if (failedJobsQuery.isError && sessionOk && !loading) {
    if (qErr instanceof Error) {
      errorMsg = qErr.message;
    } else {
      errorMsg = NEST_V2_PROXY_NETWORK_ERROR;
    }
  }

  return (
    <div className="mx-auto max-w-6xl space-y-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.2em] text-indigo-400">Analytics</p>
          <h1 className="mt-2 text-2xl font-bold tracking-tight text-white">Failed jobs</h1>
        </div>
        <Link
          href="/audit-logs"
          className="text-xs font-semibold uppercase tracking-wider text-indigo-400 hover:text-indigo-300"
        >
          Audit logs
        </Link>
      </div>

      <section className="rounded-2xl border border-[#1f2937] bg-[#0b0f16]/80 p-6 shadow-lg">
        <h2 className="mb-4 text-sm font-bold uppercase tracking-widest text-slate-500">System slice</h2>

        <div className="flex flex-col gap-4 sm:flex-row sm:flex-wrap sm:items-end">
          <label className="block min-w-0 flex-1 sm:max-w-[200px]">
            <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-slate-500">
              limit (1–200, default 50)
            </span>
            <input
              value={limit}
              onChange={(e) => setLimit(e.target.value)}
              inputMode="numeric"
              className="w-full rounded-xl border border-[#1f2937] bg-[#05070a] px-3 py-2.5 text-sm text-slate-200 outline-none focus:border-indigo-500/50"
            />
          </label>
          <label className="block min-w-0 flex-1 sm:max-w-[240px]">
            <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-slate-500">
              queueName (optional, exact)
            </span>
            <input
              value={queueName}
              onChange={(e) => setQueueName(e.target.value)}
              placeholder="e.g. scrape-ingest"
              className="w-full rounded-xl border border-[#1f2937] bg-[#05070a] px-3 py-2.5 text-sm text-slate-200 outline-none focus:border-indigo-500/50"
            />
          </label>
          <label className="block min-w-0 flex-1 sm:max-w-[160px]">
            <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-slate-500">
              orderBy
            </span>
            <select
              value={orderBy}
              onChange={(e) => setOrderBy(e.target.value === 'asc' ? 'asc' : 'desc')}
              className="w-full rounded-xl border border-[#1f2937] bg-[#05070a] px-3 py-2.5 text-sm text-slate-200 outline-none focus:border-indigo-500/50"
            >
              <option value="desc">newest first (desc)</option>
              <option value="asc">oldest first (asc)</option>
            </select>
          </label>
          <button
            type="button"
            disabled={loading}
            onClick={() => void failedJobsQuery.refetch()}
            className="shrink-0 rounded-xl bg-gradient-to-r from-indigo-600 to-blue-600 px-6 py-2.5 text-sm font-bold text-white shadow-lg shadow-indigo-900/30 hover:from-indigo-500 hover:to-blue-500 disabled:opacity-50"
          >
            {loading ? 'Loading…' : 'Reload'}
          </button>
        </div>

        {errorMsg && (
          <div className="mt-4 rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">
            <p>{errorMsg}</p>
          </div>
        )}

        {rows && rows.length > 0 && (
          <div className="mt-4 space-y-2">
            <p className="text-xs font-semibold uppercase tracking-wider text-emerald-500/90">
              FailedJob
              {meta?.totalApprox != null ? ` · ${meta.totalApprox} total (approx.)` : ''}
              {rows.length ? ` · showing ${rows.length}` : ''}
              {meta?.asOf ? ` · asOf ${meta.asOf}` : ''}
            </p>
            <div className="overflow-x-auto rounded-xl border border-[#1f2937] bg-[#05070a]">
              <table className="w-full min-w-[960px] border-collapse text-left text-sm text-slate-200">
                <thead>
                  <tr className="border-b border-[#1f2937] bg-[#0b0f16] text-[11px] font-bold uppercase tracking-wider text-slate-500">
                    <th className="px-3 py-2">createdAt</th>
                    <th className="px-3 py-2">queue</th>
                    <th className="px-3 py-2">job</th>
                    <th className="px-3 py-2">scrapeJobId</th>
                    <th className="px-3 py-2">attempts</th>
                    <th className="px-3 py-2">error</th>
                    <th className="px-3 py-2 w-[100px]">replay</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => (
                    <tr key={row.id} className="border-b border-[#1f2937]/80 align-top last:border-0">
                      <td className="whitespace-nowrap px-3 py-2 font-mono text-xs text-slate-500">
                        {row.createdAt}
                      </td>
                      <td className="px-3 py-2 font-mono text-xs text-indigo-200/95">{row.queueName}</td>
                      <td className="px-3 py-2 font-mono text-xs text-slate-300">
                        {row.jobName ?? '—'}
                        {row.bullJobId ? (
                          <span className="mt-1 block text-[10px] text-slate-500">bull: {row.bullJobId}</span>
                        ) : null}
                      </td>
                      <td className="px-3 py-2 font-mono text-xs text-slate-400">{row.scrapeJobId ?? '—'}</td>
                      <td className="px-3 py-2 font-mono text-xs text-slate-400">{row.attempts}</td>
                      <td className="max-w-md px-3 py-2 font-mono text-xs text-rose-200/90">
                        <span className="line-clamp-3">{row.errorMessage}</span>
                        {row.errorStack ? (
                          <details className="mt-1 text-[10px] text-slate-500">
                            <summary className="cursor-pointer select-none text-slate-400">stack</summary>
                            <pre className="mt-1 max-h-40 overflow-auto whitespace-pre-wrap break-words">
                              {row.errorStack}
                            </pre>
                          </details>
                        ) : null}
                      </td>
                      <td className="px-3 py-2 align-top">
                        <button
                          type="button"
                          disabled={replayMutation.isPending && replayMutation.variables === row.id}
                          onClick={() => replayMutation.mutate(row.id)}
                          className="rounded-lg border border-indigo-500/40 bg-indigo-600/20 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide text-indigo-200 hover:bg-indigo-600/35 disabled:cursor-not-allowed disabled:opacity-40"
                        >
                          {replayMutation.isPending && replayMutation.variables === row.id ? '…' : 'Replay'}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {rows && rows.length === 0 && !loading && sessionOk && !errorMsg && (
          <p className="mt-4 text-sm text-slate-500">No results.</p>
        )}

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
