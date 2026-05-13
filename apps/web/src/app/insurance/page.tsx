'use client';

import Link from 'next/link';
import { useState } from 'react';
import { useRouter } from 'next/navigation';

import {
  apiUrl,
  clearSpybotToken,
  getAuthHeaders,
  getSpybotToken,
  NEST_V2_PROXY_NETWORK_ERROR,
  NO_SPYBOT_JWT_MESSAGE,
} from '@/lib/api-client';

const DEFAULT_DAYS = 30;

type RawInsuranceSliceRow = {
  id: string;
  scrapeJobId: string | null;
  contentHash: string;
  sourceUrl: string | null;
  capturedAt: string;
  payload: unknown;
};

function formatPayloadPreview(value: unknown, maxChars = 2400): string {
  try {
    const s = JSON.stringify(value, null, 2);
    return s.length > maxChars ? `${s.slice(0, maxChars)}\n… (truncated)` : s;
  } catch {
    return String(value);
  }
}

export default function InsurancePage() {
  const router = useRouter();
  const [days, setDays] = useState<string>(String(DEFAULT_DAYS));
  const [loading, setLoading] = useState(false);
  const [jsonOut, setJsonOut] = useState<string | null>(null);
  const [okRows, setOkRows] = useState<RawInsuranceSliceRow[] | null>(null);
  const [okMeta, setOkMeta] = useState<{
    asOf?: string;
    days?: number;
    totalApprox?: number;
  } | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [errorExtra, setErrorExtra] = useState<{
    status: number;
    requestId?: string;
    traceId?: string;
  } | null>(null);

  const fetchExpiring = async () => {
    const token = getSpybotToken();
    if (!token) {
      setErrorMsg(NO_SPYBOT_JWT_MESSAGE);
      setErrorExtra(null);
      setJsonOut(null);
      setOkRows(null);
      setOkMeta(null);
      return;
    }

    setLoading(true);
    setErrorMsg(null);
    setErrorExtra(null);
    setJsonOut(null);
    setOkRows(null);
    setOkMeta(null);

    const url = new URL(apiUrl('/api/v2/insurance/expiring'));
    const trimmed = days.trim();
    if (trimmed) url.searchParams.set('days', trimmed);
    else url.searchParams.set('days', String(DEFAULT_DAYS));

    try {
      const res = await fetch(url.toString(), {
        method: 'GET',
        headers: getAuthHeaders(token, { acceptJson: true }),
      });
      const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      const headerRid = res.headers.get('x-request-id')?.trim() || undefined;

      if (res.status === 401) {
        clearSpybotToken();
        router.replace('/login');
        return;
      }

      if (!res.ok) {
        const msg =
          (typeof data.error === 'string' && data.error) ||
          (typeof data.message === 'string' && data.message) ||
          `HTTP ${res.status}`;
        setErrorMsg(msg);
        const bodyRid = typeof data.requestId === 'string' ? data.requestId : undefined;
        const bodyTrace = typeof data.traceId === 'string' ? data.traceId : undefined;
        setErrorExtra({
          status: res.status,
          requestId: bodyRid || headerRid,
          traceId: bodyTrace,
        });
        return;
      }

      if (data.status === 'ok' && Array.isArray(data.rows)) {
        setOkRows(data.rows as RawInsuranceSliceRow[]);
        setOkMeta({
          asOf: typeof data.asOf === 'string' ? data.asOf : undefined,
          days: typeof data.days === 'number' ? data.days : undefined,
          totalApprox: typeof data.totalApprox === 'number' ? data.totalApprox : undefined,
        });
      } else {
        setJsonOut(JSON.stringify(data, null, 2));
      }
    } catch {
      setErrorMsg(NEST_V2_PROXY_NETWORK_ERROR);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="mx-auto max-w-5xl space-y-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.2em] text-indigo-400">Insurance</p>
          <h1 className="mt-2 text-2xl font-bold tracking-tight text-white">Insurance expiring</h1>
          <p className="mt-1 text-sm text-slate-500">
            Nest ingest <code className="text-slate-400">RawInsurance</code> via Express{' '}
            <code className="text-slate-400">/api/v2/insurance/expiring?days=30</code>. Bearer{' '}
            <code className="text-slate-400">Bearer JWT</code> (default <code className="text-slate-400">days=30</code>,
            clamped 1–365 by API).
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
        <h2 className="mb-4 text-sm font-bold uppercase tracking-widest text-slate-500">Expiring (v2)</h2>

        <div className="flex flex-col gap-4 sm:flex-row sm:flex-wrap sm:items-end">
          <label className="block min-w-0 flex-1 sm:max-w-[200px]">
            <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-slate-500">
              days (default 30)
            </span>
            <input
              value={days}
              onChange={(e) => setDays(e.target.value)}
              inputMode="numeric"
              placeholder="30"
              className="w-full rounded-xl border border-[#1f2937] bg-[#05070a] px-3 py-2.5 text-sm text-slate-200 outline-none focus:border-indigo-500/50"
            />
          </label>
          <button
            type="button"
            disabled={loading}
            onClick={() => void fetchExpiring()}
            className="shrink-0 rounded-xl bg-gradient-to-r from-indigo-600 to-blue-600 px-6 py-2.5 text-sm font-bold text-white shadow-lg shadow-indigo-900/30 hover:from-indigo-500 hover:to-blue-500 disabled:opacity-50"
          >
            {loading ? 'Fetching…' : 'Fetch expiring'}
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

        {okRows && okRows.length > 0 && (
          <div className="mt-4 space-y-2">
            <p className="text-xs font-semibold uppercase tracking-wider text-emerald-500/90">
              RawInsurance (
              {okMeta?.totalApprox != null ? `~${okMeta.totalApprox} total` : 'slice'}
              {okMeta?.asOf ? ` · asOf ${okMeta.asOf}` : ''}
              {okMeta?.days != null ? ` · days ${okMeta.days}` : ''})
            </p>
            <div className="overflow-x-auto rounded-xl border border-[#1f2937] bg-[#05070a]">
              <table className="w-full min-w-[960px] border-collapse text-left text-sm text-slate-200">
                <thead>
                  <tr className="border-b border-[#1f2937] bg-[#0b0f16] text-[11px] font-bold uppercase tracking-wider text-slate-500">
                    <th className="px-3 py-2">id</th>
                    <th className="px-3 py-2">scrapeJobId</th>
                    <th className="px-3 py-2">contentHash</th>
                    <th className="px-3 py-2">sourceUrl</th>
                    <th className="px-3 py-2">capturedAt</th>
                    <th className="min-w-[200px] px-3 py-2">payload</th>
                  </tr>
                </thead>
                <tbody>
                  {okRows.map((row) => (
                    <tr key={row.id} className="border-b border-[#1f2937]/80 align-top last:border-0">
                      <td className="px-3 py-2 font-mono text-xs text-slate-500">{row.id}</td>
                      <td className="px-3 py-2 font-mono text-xs text-slate-500">
                        {row.scrapeJobId ?? '—'}
                      </td>
                      <td className="max-w-[140px] px-3 py-2 font-mono text-[11px] break-all text-indigo-200/95">
                        {row.contentHash}
                      </td>
                      <td className="max-w-[180px] px-3 py-2 break-all text-xs text-slate-400">
                        {row.sourceUrl ?? '—'}
                      </td>
                      <td className="whitespace-nowrap px-3 py-2 font-mono text-xs text-slate-500">
                        {row.capturedAt}
                      </td>
                      <td className="px-3 py-2">
                        <pre className="max-h-40 overflow-auto rounded-lg border border-[#1f2937]/80 bg-[#05070a] p-2 font-mono text-[11px] leading-relaxed text-slate-300">
                          {formatPayloadPreview(row.payload)}
                        </pre>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {okRows && okRows.length === 0 && (
          <p className="mt-4 text-sm text-slate-500">API returned status ok but no rows in this slice.</p>
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
