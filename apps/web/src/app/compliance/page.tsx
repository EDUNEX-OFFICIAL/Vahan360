'use client';

import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useState } from 'react';

import {
  apiUrl,
  clearSpybotToken,
  getAuthHeaders,
  getSpybotToken,
  NEST_V2_PROXY_NETWORK_ERROR,
  NO_SPYBOT_JWT_MESSAGE,
  withApiCredentials,
} from '@/lib/api-client';
import { aggregateColumnsFromSnapshot } from '@/lib/snapshot-summary-columns';
import { downloadCsv } from '@/lib/csv-export';
import { chartMonthBucketsFromIso } from '@/lib/analytics-charts';
import { StatusBarChart } from '@/components/StatusBarChart';

const DEFAULT_LIMIT = '50';

type ComplianceSummaryApiRow = {
  id: string;
  vehicleRegNo: string;
  snapshot: unknown;
  updatedAt: string;
};

async function fetchCompliance(opts: {
  qp: string;
  token: string;
  router: ReturnType<typeof useRouter>;
}): Promise<
  | { variant: 'ok'; rows: ComplianceSummaryApiRow[]; meta: { asOf?: string; totalApprox?: number } }
  | { variant: 'json'; raw: string }
  | { variant: 'error'; msg: string; status?: number }
> {
  const p = new URLSearchParams(opts.qp);
  const url = new URL(apiUrl('/api/v2/compliance/summary'));
  const lim = (p.get('limit') ?? DEFAULT_LIMIT).trim() || DEFAULT_LIMIT;
  url.searchParams.set('limit', lim);

  /** API still names this `district` historically — server maps it as `vehicleRegNo` substring filter. */
  const q = (p.get('q') ?? '').trim();
  if (q) url.searchParams.set('district', q);

  try {
    const res = await fetch(url.toString(), withApiCredentials({
      method: 'GET',
      headers: getAuthHeaders(opts.token, { acceptJson: true }),
    }));
    const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;

    if (res.status === 401) {
      clearSpybotToken();
      opts.router.replace('/login');
      return { variant: 'error', msg: NO_SPYBOT_JWT_MESSAGE };
    }

    if (!res.ok) {
      const msg =
        (typeof data.error === 'string' && data.error) ||
        (typeof data.message === 'string' && data.message) ||
        `HTTP ${res.status}`;
      return { variant: 'error', msg, status: res.status };
    }

    if (data.status === 'ok' && Array.isArray(data.rows)) {
      return {
        variant: 'ok',
        rows: data.rows as ComplianceSummaryApiRow[],
        meta: {
          asOf: typeof data.asOf === 'string' ? data.asOf : undefined,
          totalApprox: typeof data.totalApprox === 'number' ? data.totalApprox : undefined,
        },
      };
    }

    return { variant: 'json', raw: JSON.stringify(data, null, 2) };
  } catch {
    return { variant: 'error', msg: NEST_V2_PROXY_NETWORK_ERROR };
  }
}

function complianceHref(pathname: string, limit: string, q: string) {
  const p = new URLSearchParams();
  p.set('limit', limit.trim() || DEFAULT_LIMIT);
  const qc = q.trim();
  if (qc) p.set('q', qc);
  return `${pathname}?${p.toString()}`;
}

export default function CompliancePage() {
  return (
    <Suspense fallback={<div className="mx-auto max-w-5xl p-8 text-sm text-slate-500">Loading…</div>}>
      <CompliancePageBody />
    </Suspense>
  );
}

function CompliancePageBody() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [mounted, setMounted] = useState(false);
  const [draftLimit, setDraftLimit] = useState(DEFAULT_LIMIT);
  const [draftQ, setDraftQ] = useState('');
  const [serverCsvBusy, setServerCsvBusy] = useState(false);

  const qsKey = searchParams.toString();

  useEffect(() => void setMounted(true), []);

  useEffect(() => {
    const p = new URLSearchParams(qsKey);
    setDraftLimit(p.get('limit')?.trim() || DEFAULT_LIMIT);
    setDraftQ(p.get('q') ?? '');
  }, [qsKey]);

  const sessionOk = mounted && Boolean(getSpybotToken());

  const q = useQuery({
    queryKey: ['compliance-summary', qsKey] as const,
    enabled: sessionOk,
    queryFn: async ({ queryKey }) => {
      const token = getSpybotToken();
      if (!token) throw new Error(NO_SPYBOT_JWT_MESSAGE);
      return fetchCompliance({ qp: queryKey[1], token, router });
    },
  });

  const loading = sessionOk && q.isPending;

  let errorMsg: string | null = null;
  if (!sessionOk && mounted) errorMsg = NO_SPYBOT_JWT_MESSAGE;
  if (sessionOk && q.isError && !loading) {
    errorMsg =
      q.error instanceof Error ? q.error.message : NEST_V2_PROXY_NETWORK_ERROR;
  }

  const okPack = q.data?.variant === 'ok' ? q.data : null;

  async function downloadServerComplianceCsv() {
    const token = getSpybotToken();
    if (!token) return;
    setServerCsvBusy(true);
    try {
      const p = new URLSearchParams(qsKey);
      const url = new URL(apiUrl('/api/v2/compliance/summary/export.csv'));
      const lim = (p.get('limit') ?? DEFAULT_LIMIT).trim() || DEFAULT_LIMIT;
      url.searchParams.set('limit', lim);
      const qc = (p.get('q') ?? '').trim();
      if (qc) url.searchParams.set('district', qc);

      const res = await fetch(
        url.toString(),
        withApiCredentials({
          method: 'GET',
          headers: getAuthHeaders(token),
        }),
      );

      if (res.status === 401) {
        clearSpybotToken();
        router.replace('/login');
        return;
      }

      if (!res.ok) {
        const msg = await res.text().catch(() => '');
        throw new Error(msg.trim() || `HTTP ${res.status}`);
      }

      const blob = await res.blob();
      const href = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = href;
      a.download = `compliance-summary-server-${new Date().toISOString().slice(0, 10)}.csv`;
      a.rel = 'noopener';
      a.click();
      URL.revokeObjectURL(href);
    } catch (e) {
      window.alert(e instanceof Error ? e.message : NEST_V2_PROXY_NETWORK_ERROR);
    } finally {
      setServerCsvBusy(false);
    }
  }

  function applyFilters() {
    router.replace(complianceHref(pathname, draftLimit, draftQ), {
      scroll: false,
    });
  }

  return (
    <div className="mx-auto max-w-5xl space-y-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.2em] text-indigo-400">Compliance</p>
          <h1 className="mt-2 text-2xl font-bold tracking-tight text-white">Compliance summary</h1>
          <p className="mt-1 text-sm text-slate-500">
            URL <code className="text-slate-400">&amp;q=…</code> maps to Nest <code className="text-slate-400">district</code>{' '}
            query (= <code className="text-slate-400">vehicleRegNo</code> substring). Shareable bookmarks + TanStack keyed on search string.
          </p>
        </div>
        <Link
          href="/dashboard/leads"
          className="text-xs font-semibold uppercase tracking-wider text-indigo-400 hover:text-indigo-300"
        >
          Back to dashboard
        </Link>
      </div>

      <section className="rounded-2xl border border-[#1f2937] bg-[#0b0f16]/80 p-6 shadow-lg">
        <h2 className="mb-4 text-sm font-bold uppercase tracking-widest text-slate-500">Summary (v2)</h2>

        <div className="flex flex-col gap-4 sm:flex-row sm:flex-wrap sm:items-end">
          <label className="block min-w-0 flex-1 sm:max-w-[140px]">
            <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-slate-500">
              limit
            </span>
            <input
              value={draftLimit}
              onChange={(e) => setDraftLimit(e.target.value)}
              inputMode="numeric"
              className="w-full rounded-xl border border-[#1f2937] bg-[#05070a] px-3 py-2.5 text-sm text-slate-200 outline-none focus:border-indigo-500/50"
            />
          </label>
          <label className="block min-w-0 flex-1 sm:max-w-[320px]">
            <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-slate-500">
              q · vehicle registration contains
            </span>
            <input
              value={draftQ}
              onChange={(e) => setDraftQ(e.target.value)}
              className="w-full rounded-xl border border-[#1f2937] bg-[#05070a] px-3 py-2.5 text-sm text-slate-200 outline-none focus:border-indigo-500/50"
              placeholder="e.g. MH"
            />
          </label>
          <button
            type="button"
            disabled={loading}
            onClick={() => applyFilters()}
            className="shrink-0 rounded-xl bg-gradient-to-r from-indigo-600 to-blue-600 px-6 py-2.5 text-sm font-bold text-white shadow-lg shadow-indigo-900/30 hover:from-indigo-500 hover:to-blue-500 disabled:opacity-50"
          >
            {loading ? 'Fetching…' : 'Apply URL & fetch'}
          </button>
        </div>

        {errorMsg && (
          <div className="mt-4 rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">
            <p>{errorMsg}</p>
          </div>
        )}

        {sessionOk && q.data?.variant === 'error' && (
          <div className="mt-4 rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-200">
            <p>
              {q.data.msg}
              {typeof q.data.status === 'number' ? (
                <span className="ml-2 font-mono text-xs text-amber-100/85">HTTP {q.data.status}</span>
              ) : null}
            </p>
          </div>
        )}

        {okPack?.rows && okPack.rows.length > 0 && (
          <div className="mt-4 space-y-2">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="text-xs font-semibold uppercase tracking-wider text-emerald-500/90">
                ProcessedVehicleComplianceSummary (
                {okPack.meta?.totalApprox != null ? `~${okPack.meta.totalApprox} total` : 'slice'}
                {okPack.meta?.asOf ? ` · asOf ${okPack.meta.asOf}` : ''})
              </p>
              <div className="flex flex-wrap items-center justify-end gap-2">
              <button
                type="button"
                disabled={!sessionOk || serverCsvBusy}
                onClick={() => void downloadServerComplianceCsv()}
                className="shrink-0 rounded-lg border border-indigo-500/35 bg-indigo-950/40 px-3 py-1.5 text-[11px] font-bold uppercase tracking-wider text-indigo-200 hover:border-indigo-400/60 disabled:opacity-50"
              >
                {serverCsvBusy ? '↓ Server CSV…' : '↓ Server CSV'}
              </button>
              <button
                type="button"
                onClick={() => {
                  const colsData = okPack.rows.map((row) =>
                    aggregateColumnsFromSnapshot(row.snapshot)
                  );
                  downloadCsv({
                    filename: `compliance-summary-${new Date().toISOString().slice(0, 10)}`,
                    columns: ['id', 'vehicleRegNo', 'tripCount', 'tonnage', 'period', 'updatedAt'],
                    rows: okPack.rows.map((row, i) => [
                      row.id,
                      row.vehicleRegNo,
                      colsData[i].tripCount,
                      colsData[i].tonnage,
                      colsData[i].period,
                      row.updatedAt,
                    ]),
                  });
                }}
                className="shrink-0 rounded-lg border border-[#1f2937] bg-[#05070a] px-3 py-1.5 text-[11px] font-bold uppercase tracking-wider text-slate-400 hover:border-indigo-500/50 hover:text-indigo-300"
              >
                ↓ Export CSV
              </button>
              </div>
            </div>
            <div className="overflow-x-auto rounded-xl border border-[#1f2937] bg-[#05070a]">
              <table className="w-full min-w-[800px] border-collapse text-left text-sm text-slate-200">
                <thead>
                  <tr className="border-b border-[#1f2937] bg-[#0b0f16] text-[11px] font-bold uppercase tracking-wider text-slate-500">
                    <th className="px-3 py-2">id</th>
                    <th className="px-3 py-2">vehicleRegNo</th>
                    <th className="px-3 py-2">tripCount</th>
                    <th className="px-3 py-2">tonnage</th>
                    <th className="px-3 py-2">period</th>
                    <th className="px-3 py-2">updatedAt</th>
                  </tr>
                </thead>
                <tbody>
                  {okPack.rows.map((row) => {
                    const { tripCount, tonnage, period } =
                      aggregateColumnsFromSnapshot(row.snapshot);
                    return (
                      <tr key={row.id} className="border-b border-[#1f2937]/80 last:border-0">
                        <td className="px-3 py-2 font-mono text-xs text-slate-500">{row.id}</td>
                        <td className="px-3 py-2 font-mono text-xs text-indigo-200/95">{row.vehicleRegNo}</td>
                        <td className="px-3 py-2">{tripCount}</td>
                        <td className="px-3 py-2">{tonnage}</td>
                        <td className="px-3 py-2 text-slate-400">{period}</td>
                        <td className="px-3 py-2 font-mono text-xs text-slate-500">{row.updatedAt}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            {(() => {
              const chartData = chartMonthBucketsFromIso(okPack.rows);
              if (chartData.length === 0) return null;
              return (
                <div className="rounded-xl border border-[#1f2937] bg-[#05070a] p-4">
                  <StatusBarChart
                    data={chartData}
                    title="updatedAt · UTC month distribution (this slice)"
                    height={Math.max(80, chartData.length * 28 + 16)}
                  />
                </div>
              );
            })()}
          </div>
        )}

        {okPack?.rows?.length === 0 && (
          <p className="mt-4 text-sm text-slate-500">API returned status ok but no rows in this slice.</p>
        )}

        {q.data?.variant === 'json' && (
          <div className="mt-4">
            <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-emerald-500/90">Response</p>
            <pre className="max-h-[480px] overflow-auto rounded-xl border border-[#1f2937] bg-[#05070a] p-4 font-mono text-xs leading-relaxed text-slate-200">
              {q.data.raw}
            </pre>
          </div>
        )}

      </section>
    </div>
  );
}
