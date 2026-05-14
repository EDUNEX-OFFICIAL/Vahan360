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
import { logAndUserFacingHttpError } from '@/lib/user-facing-errors';
import { aggregateColumnsFromSnapshot } from '@/lib/snapshot-summary-columns';

type ConsignerSummaryApiRow = {
  id: string;
  consignerKey: string;
  snapshot: unknown;
  updatedAt: string;
};

export default function ConsignersPage() {
  const router = useRouter();
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [loading, setLoading] = useState(false);
  const [jsonOut, setJsonOut] = useState<string | null>(null);
  const [okRows, setOkRows] = useState<ConsignerSummaryApiRow[] | null>(null);
  const [okMeta, setOkMeta] = useState<{ asOf?: string; totalApprox?: number } | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const fetchSummary = async () => {
    const token = getSpybotToken();
    if (!token) {
      setErrorMsg(NO_SPYBOT_JWT_MESSAGE);
      setJsonOut(null);
      return;
    }

    setLoading(true);
    setErrorMsg(null);
    setJsonOut(null);
    setOkRows(null);
    setOkMeta(null);

    const url = new URL(apiUrl('/api/v2/consigners/summary'));
    const f = from.trim();
    const t = to.trim();
    if (f) url.searchParams.set('from', f);
    if (t) url.searchParams.set('to', t);

    try {
      const res = await fetch(url.toString(), {
        method: 'GET',
        headers: getAuthHeaders(token, { acceptJson: true }),
      });
      const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;

      if (res.status === 401) {
        clearSpybotToken();
        router.replace('/login');
        return;
      }

      if (!res.ok) {
        setErrorMsg(logAndUserFacingHttpError(res, data, url.pathname));
        return;
      }

      if (data.status === 'ok' && Array.isArray(data.rows)) {
        setOkRows(data.rows as ConsignerSummaryApiRow[]);
        setOkMeta({
          asOf: typeof data.asOf === 'string' ? data.asOf : undefined,
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
          <p className="text-xs font-bold uppercase tracking-[0.2em] text-indigo-400">Consigners</p>
          <h1 className="mt-2 text-2xl font-bold tracking-tight text-white">Consigners summary</h1>
        </div>
        <Link
          href="/dashboard/leads"
          className="text-xs font-semibold uppercase tracking-wider text-indigo-400 hover:text-indigo-300"
        >
          Back to dashboard
        </Link>
      </div>

      <section className="rounded-2xl border border-[#1f2937] bg-[#0b0f16]/80 p-6 shadow-lg">
        <h2 className="mb-4 text-sm font-bold uppercase tracking-widest text-slate-500">Summary</h2>

        <div className="flex flex-col gap-4 sm:flex-row sm:flex-wrap sm:items-end">
          <label className="block min-w-0 flex-1 sm:max-w-[200px]">
            <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-slate-500">
              from
            </span>
            <input
              value={from}
              onChange={(e) => setFrom(e.target.value)}
              placeholder="2024-05-01"
              className="w-full rounded-xl border border-[#1f2937] bg-[#05070a] px-3 py-2.5 text-sm text-slate-200 outline-none focus:border-indigo-500/50"
            />
          </label>
          <label className="block min-w-0 flex-1 sm:max-w-[200px]">
            <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-slate-500">
              to
            </span>
            <input
              value={to}
              onChange={(e) => setTo(e.target.value)}
              placeholder="2024-05-31"
              className="w-full rounded-xl border border-[#1f2937] bg-[#05070a] px-3 py-2.5 text-sm text-slate-200 outline-none focus:border-indigo-500/50"
            />
          </label>
          <button
            type="button"
            disabled={loading}
            onClick={() => void fetchSummary()}
            className="shrink-0 rounded-xl bg-gradient-to-r from-indigo-600 to-blue-600 px-6 py-2.5 text-sm font-bold text-white shadow-lg shadow-indigo-900/30 hover:from-indigo-500 hover:to-blue-500 disabled:opacity-50"
          >
            {loading ? 'Fetching…' : 'Fetch summary'}
          </button>
        </div>

        {errorMsg && (
          <div className="mt-4 rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">
            <p>{errorMsg}</p>
          </div>
        )}

        {okRows && okRows.length > 0 && (
          <div className="mt-4 space-y-2">
            <p className="text-xs font-semibold uppercase tracking-wider text-emerald-500/90">
              ProcessedConsignerSummary ({okMeta?.totalApprox != null ? `~${okMeta.totalApprox} total` : 'slice'}
              {okMeta?.asOf ? ` · asOf ${okMeta.asOf}` : ''})
            </p>
            <div className="overflow-x-auto rounded-xl border border-[#1f2937] bg-[#05070a]">
              <table className="w-full min-w-[640px] border-collapse text-left text-sm text-slate-200">
                <thead>
                  <tr className="border-b border-[#1f2937] bg-[#0b0f16] text-[11px] font-bold uppercase tracking-wider text-slate-500">
                    <th className="px-3 py-2">consignerKey</th>
                    <th className="px-3 py-2">tripCount</th>
                    <th className="px-3 py-2">tonnage</th>
                    <th className="px-3 py-2">period</th>
                    <th className="px-3 py-2">updatedAt</th>
                  </tr>
                </thead>
                <tbody>
                  {okRows.map((row) => {
                    const { tripCount, tonnage, period } = aggregateColumnsFromSnapshot(row.snapshot);
                    return (
                      <tr key={row.id} className="border-b border-[#1f2937]/80 last:border-0">
                        <td className="px-3 py-2 font-mono text-xs text-indigo-200/95">{row.consignerKey}</td>
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
          </div>
        )}

        {okRows && okRows.length === 0 && (
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
