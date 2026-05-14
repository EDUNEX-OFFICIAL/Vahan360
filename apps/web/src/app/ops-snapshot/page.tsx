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
import { logAndUserFacingHttpError, logRequestDiagnostics, userFacingHttpError } from '@/lib/user-facing-errors';

type WorkerRow = {
  workerId: string;
  queueName: string | null;
  status: string;
  lastHeartbeat: string;
};

type QueueMetricRow = {
  id: string;
  queueName: string;
  recordedAt: string;
};

export default function OpsSnapshotPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [workers, setWorkers] = useState<WorkerRow[] | null>(null);
  const [queueMetrics, setQueueMetrics] = useState<QueueMetricRow[] | null>(null);
  const [asOf, setAsOf] = useState<string | null>(null);
  const [opsSnapshotUnavailable, setOpsSnapshotUnavailable] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const load = useCallback(async () => {
    const token = getSpybotToken();
    if (!token) {
      setLoading(false);
      setErrorMsg(NO_SPYBOT_JWT_MESSAGE);
      setWorkers(null);
      setQueueMetrics(null);
      setAsOf(null);
      setOpsSnapshotUnavailable(false);
      return;
    }

    setLoading(true);
    setErrorMsg(null);
    setOpsSnapshotUnavailable(false);
    setWorkers(null);
    setQueueMetrics(null);
    setAsOf(null);

    const url = apiUrl('/api/v2/ingest/ops/snapshot');

    try {
      const res = await fetch(url, {
        method: 'GET',
        headers: getAuthHeaders(token, { acceptJson: true }),
      });
      const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      let pathForLog = '/api/v2/ingest/ops/snapshot';
      try {
        pathForLog = new URL(url).pathname;
      } catch {
        /* ignore */
      }

      if (res.status === 401) {
        clearSpybotToken();
        router.replace('/login');
        return;
      }

      if (!res.ok) {
        setErrorMsg(logAndUserFacingHttpError(res, data, pathForLog));
        return;
      }

      if (data.status === 'not_implemented') {
        logRequestDiagnostics({ path: pathForLog, body: data }, 'Ops snapshot not_implemented');
        setAsOf(typeof data.asOf === 'string' ? data.asOf : null);
        setOpsSnapshotUnavailable(true);
        return;
      }

      if (data.status === 'ok' && Array.isArray(data.workers) && Array.isArray(data.queueMetrics)) {
        setAsOf(typeof data.asOf === 'string' ? data.asOf : null);
        setWorkers(data.workers as WorkerRow[]);
        setQueueMetrics(data.queueMetrics as QueueMetricRow[]);
        return;
      }

      logRequestDiagnostics({ path: pathForLog, body: data }, 'Unexpected ops snapshot response');
      setErrorMsg(userFacingHttpError(502, null));
    } catch {
      setErrorMsg(NEST_V2_PROXY_NETWORK_ERROR);
    } finally {
      setLoading(false);
    }
  }, [router]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="mx-auto max-w-6xl space-y-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.2em] text-indigo-400">Analytics</p>
          <h1 className="mt-2 text-2xl font-bold tracking-tight text-white">Ops snapshot</h1>
        </div>
        <div className="flex flex-wrap gap-3">
          <button
            type="button"
            disabled={loading}
            onClick={() => void load()}
            className="shrink-0 rounded-xl bg-gradient-to-r from-indigo-600 to-blue-600 px-5 py-2.5 text-sm font-bold text-white shadow-lg shadow-indigo-900/30 hover:from-indigo-500 hover:to-blue-500 disabled:opacity-50"
          >
            {loading ? 'Loading…' : 'Reload'}
          </button>
          <Link
            href="/ingest-jobs"
            className="self-center text-xs font-semibold uppercase tracking-wider text-indigo-400 hover:text-indigo-300"
          >
            Ingest jobs
          </Link>
        </div>
      </div>

      {errorMsg && (
        <div className="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">
          <p>{errorMsg}</p>
        </div>
      )}

      {opsSnapshotUnavailable && (
        <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-200">
          <p>Ye snapshot abhi uplabdh nahi / This snapshot is not available yet.</p>
        </div>
      )}

      {!loading && workers && queueMetrics && (
        <p className="text-xs font-semibold uppercase tracking-wider text-emerald-500/90">
          {asOf ? `asOf ${asOf}` : ''}
          {asOf ? ' · ' : ''}
          {workers.length} workers · {queueMetrics.length} queue metrics
        </p>
      )}

      <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
        <section className="rounded-2xl border border-[#1f2937] bg-[#0b0f16]/80 p-5 shadow-lg">
          <h2 className="mb-3 text-sm font-bold uppercase tracking-widest text-slate-500">WorkerStatus</h2>
          {loading && <p className="text-sm text-slate-500">Loading…</p>}
          {!loading && workers && workers.length === 0 && (
            <p className="text-sm text-slate-500">No rows.</p>
          )}
          {!loading && workers && workers.length > 0 && (
            <div className="overflow-x-auto rounded-xl border border-[#1f2937] bg-[#05070a]">
              <table className="w-full min-w-[280px] border-collapse text-left text-sm text-slate-200">
                <thead>
                  <tr className="border-b border-[#1f2937] bg-[#0b0f16] text-[11px] font-bold uppercase tracking-wider text-slate-500">
                    <th className="px-2 py-2">workerId</th>
                    <th className="px-2 py-2">queue</th>
                    <th className="px-2 py-2">status</th>
                    <th className="px-2 py-2">lastHeartbeat</th>
                  </tr>
                </thead>
                <tbody>
                  {workers.map((w) => (
                    <tr key={w.workerId} className="border-b border-[#1f2937]/80 align-top last:border-0">
                      <td className="px-2 py-2 font-mono text-xs text-slate-400">{w.workerId}</td>
                      <td className="px-2 py-2 font-mono text-xs text-indigo-200/90">
                        {w.queueName ?? '—'}
                      </td>
                      <td className="px-2 py-2 font-mono text-xs">{w.status}</td>
                      <td className="whitespace-nowrap px-2 py-2 font-mono text-[11px] text-slate-500">
                        {w.lastHeartbeat}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <section className="rounded-2xl border border-[#1f2937] bg-[#0b0f16]/80 p-5 shadow-lg">
          <h2 className="mb-3 text-sm font-bold uppercase tracking-widest text-slate-500">QueueMetric</h2>
          {loading && <p className="text-sm text-slate-500">Loading…</p>}
          {!loading && queueMetrics && queueMetrics.length === 0 && (
            <p className="text-sm text-slate-500">No rows.</p>
          )}
          {!loading && queueMetrics && queueMetrics.length > 0 && (
            <div className="overflow-x-auto rounded-xl border border-[#1f2937] bg-[#05070a]">
              <table className="w-full min-w-[240px] border-collapse text-left text-sm text-slate-200">
                <thead>
                  <tr className="border-b border-[#1f2937] bg-[#0b0f16] text-[11px] font-bold uppercase tracking-wider text-slate-500">
                    <th className="px-2 py-2">id</th>
                    <th className="px-2 py-2">queueName</th>
                    <th className="px-2 py-2">recordedAt</th>
                  </tr>
                </thead>
                <tbody>
                  {queueMetrics.map((q) => (
                    <tr key={q.id} className="border-b border-[#1f2937]/80 align-top last:border-0">
                      <td className="px-2 py-2 font-mono text-xs text-slate-400">{q.id}</td>
                      <td className="px-2 py-2 font-mono text-xs text-indigo-200/90">{q.queueName}</td>
                      <td className="whitespace-nowrap px-2 py-2 font-mono text-[11px] text-slate-500">
                        {q.recordedAt}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
