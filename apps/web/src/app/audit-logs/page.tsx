'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';

import {
  apiUrl,
  clearSpybotToken,
  getAuthHeaders,
  getSpybotToken,
  NEST_V2_PROXY_NETWORK_ERROR,
  NO_SPYBOT_JWT_MESSAGE,
} from '@/lib/api-client';

const DEFAULT_LIMIT = 50;

type AuditLogRow = {
  id: string;
  action: string;
  resource: string | null;
  createdAt: string;
  actor: string | null;
};

export default function AuditLogsPage() {
  const router = useRouter();
  const [limit, setLimit] = useState(String(DEFAULT_LIMIT));
  const [action, setAction] = useState('');
  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState<AuditLogRow[] | null>(null);
  const [meta, setMeta] = useState<{
    asOf?: string;
    totalApprox?: number;
  } | null>(null);
  const [jsonOut, setJsonOut] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [errorExtra, setErrorExtra] = useState<{
    status: number;
    requestId?: string;
    traceId?: string;
  } | null>(null);

  const load = useCallback(
    async (limitParam: string, actionParam: string) => {
      const token = getSpybotToken();
      if (!token) {
        setLoading(false);
        setErrorMsg(NO_SPYBOT_JWT_MESSAGE);
        setErrorExtra(null);
        setRows(null);
        setMeta(null);
        setJsonOut(null);
        return;
      }

      setLoading(true);
      setErrorMsg(null);
      setErrorExtra(null);
      setJsonOut(null);
      setRows(null);
      setMeta(null);

      const url = new URL(apiUrl('/api/v2/system/audit-logs'));
      const lim = limitParam.trim() || String(DEFAULT_LIMIT);
      url.searchParams.set('limit', lim);
      const ac = actionParam.trim();
      if (ac) url.searchParams.set('action', ac);

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
          setRows(data.rows as AuditLogRow[]);
          setMeta({
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
    },
    [router],
  );

  useEffect(() => {
    void load(String(DEFAULT_LIMIT), '');
  }, [load]);

  return (
    <div className="mx-auto max-w-6xl space-y-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.2em] text-indigo-400">Analytics</p>
          <h1 className="mt-2 text-2xl font-bold tracking-tight text-white">Audit logs</h1>
          <p className="mt-1 text-sm text-slate-500">
            Nest <code className="text-slate-400">system.AuditLog</code> via{' '}
            <code className="text-slate-400">GET /api/v2/system/audit-logs?limit=50</code> (optional{' '}
            <code className="text-slate-400">&amp;action=…</code> substring, Bearer{' '}
            <code className="text-slate-400">Bearer JWT</code>).
          </p>
        </div>
        <Link
          href="/ops-snapshot"
          className="text-xs font-semibold uppercase tracking-wider text-indigo-400 hover:text-indigo-300"
        >
          Ops snapshot
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
          <label className="block min-w-0 flex-1 sm:max-w-[220px]">
            <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-slate-500">
              action (optional, contains, case-insensitive)
            </span>
            <input
              value={action}
              onChange={(e) => setAction(e.target.value)}
              placeholder="substring"
              className="w-full rounded-xl border border-[#1f2937] bg-[#05070a] px-3 py-2.5 text-sm text-slate-200 outline-none focus:border-indigo-500/50"
            />
          </label>
          <button
            type="button"
            disabled={loading}
            onClick={() => void load(limit, action)}
            className="shrink-0 rounded-xl bg-gradient-to-r from-indigo-600 to-blue-600 px-6 py-2.5 text-sm font-bold text-white shadow-lg shadow-indigo-900/30 hover:from-indigo-500 hover:to-blue-500 disabled:opacity-50"
          >
            {loading ? 'Loading…' : 'Reload'}
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
            <p className="text-xs font-semibold uppercase tracking-wider text-emerald-500/90">
              AuditLog
              {meta?.totalApprox != null ? ` · ${meta.totalApprox} total (approx.)` : ''}
              {rows.length ? ` · showing ${rows.length}` : ''}
              {meta?.asOf ? ` · asOf ${meta.asOf}` : ''}
            </p>
            <div className="overflow-x-auto rounded-xl border border-[#1f2937] bg-[#05070a]">
              <table className="w-full min-w-[720px] border-collapse text-left text-sm text-slate-200">
                <thead>
                  <tr className="border-b border-[#1f2937] bg-[#0b0f16] text-[11px] font-bold uppercase tracking-wider text-slate-500">
                    <th className="px-3 py-2">id</th>
                    <th className="px-3 py-2">action</th>
                    <th className="px-3 py-2">resource</th>
                    <th className="px-3 py-2">createdAt</th>
                    <th className="px-3 py-2">actor</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => (
                    <tr key={row.id} className="border-b border-[#1f2937]/80 align-top last:border-0">
                      <td className="px-3 py-2 font-mono text-xs text-slate-500">{row.id}</td>
                      <td className="px-3 py-2 font-mono text-xs text-indigo-200/95">{row.action}</td>
                      <td className="px-3 py-2 font-mono text-xs text-slate-300">{row.resource ?? '—'}</td>
                      <td className="whitespace-nowrap px-3 py-2 font-mono text-xs text-slate-500">
                        {row.createdAt}
                      </td>
                      <td className="px-3 py-2 font-mono text-xs text-slate-400">{row.actor ?? '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {rows && rows.length === 0 && !loading && (
          <p className="mt-4 text-sm text-slate-500">No rows returned for this slice.</p>
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
