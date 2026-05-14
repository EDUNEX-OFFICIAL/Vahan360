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

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function fetchKindFromRelativePath(relativePath: string): 'summary' | 'risk' | 'timeline' {
  const head = (relativePath.split('?')[0] ?? relativePath).trim();
  if (head === 'summary') return 'summary';
  if (head === 'risk') return 'risk';
  if (head === 'timeline') return 'timeline';
  return 'timeline';
}

function truncatePayloadJson(payload: unknown, maxLen: number): string {
  try {
    const s = JSON.stringify(payload);
    if (s.length <= maxLen) return s;
    return `${s.slice(0, maxLen)}…`;
  } catch {
    return String(payload);
  }
}

export default function VehicleIntelligencePage() {
  const router = useRouter();
  const [regNorm, setRegNorm] = useState('');
  const [loading, setLoading] = useState(false);
  const [jsonOut, setJsonOut] = useState<string | null>(null);
  const [parsed, setParsed] = useState<unknown>(null);
  const [fetchKind, setFetchKind] = useState<'summary' | 'risk' | 'timeline' | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [errorExtra, setErrorExtra] = useState<{
    status: number;
    requestId?: string;
    traceId?: string;
  } | null>(null);

  const fetchVehicleV2 = async (relativePath: string) => {
    const reg = regNorm.trim();
    if (!reg) {
      setErrorMsg('Enter a registration (regNorm).');
      setErrorExtra(null);
      setJsonOut(null);
      setParsed(null);
      setFetchKind(null);
      return;
    }

    const token = getSpybotToken();
    if (!token) {
      setErrorMsg(NO_SPYBOT_JWT_MESSAGE);
      setErrorExtra(null);
      setJsonOut(null);
      setParsed(null);
      setFetchKind(null);
      return;
    }

    setLoading(true);
    setErrorMsg(null);
    setErrorExtra(null);
    setJsonOut(null);
    setParsed(null);
    setFetchKind(null);

    const url = apiUrl(`/api/v2/vehicle/${encodeURIComponent(reg)}/${relativePath}`);

    try {
      const res = await fetch(url, {
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

      setJsonOut(JSON.stringify(data, null, 2));
      setParsed(data);
      setFetchKind(fetchKindFromRelativePath(relativePath));
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
          <p className="text-xs font-bold uppercase tracking-[0.2em] text-indigo-400">Intelligence</p>
          <h1 className="mt-2 text-2xl font-bold tracking-tight text-white">Vehicle Intelligence</h1>
          <p className="mt-1 text-sm text-slate-500">
            Nest vehicle endpoints via Express <code className="text-slate-400">/api/v2</code> proxy.
            Same secure cookie session as scrape console.
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
        <h2 className="mb-4 text-sm font-bold uppercase tracking-widest text-slate-500">Vehicle v2 (Nest stubs)</h2>

        <div className="flex flex-col gap-4 sm:flex-row sm:items-end">
          <label className="block min-w-0 flex-1">
            <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-slate-500">
              regNorm
            </span>
            <input
              value={regNorm}
              onChange={(e) => setRegNorm(e.target.value)}
              placeholder="e.g. BR01AB1234"
              className="w-full rounded-xl border border-[#1f2937] bg-[#05070a] px-3 py-2.5 text-sm text-slate-200 outline-none focus:border-indigo-500/50"
            />
          </label>
          <div className="flex shrink-0 flex-wrap gap-2">
            <button
              type="button"
              disabled={loading}
              onClick={() => void fetchVehicleV2('summary')}
              className="rounded-xl bg-gradient-to-r from-indigo-600 to-blue-600 px-4 py-2.5 text-sm font-bold text-white shadow-lg shadow-indigo-900/30 hover:from-indigo-500 hover:to-blue-500 disabled:opacity-50"
            >
              {loading ? 'Fetching…' : 'Fetch summary'}
            </button>
            <button
              type="button"
              disabled={loading}
              onClick={() => void fetchVehicleV2('timeline?limit=50')}
              className="rounded-xl border border-indigo-500/40 bg-indigo-950/40 px-4 py-2.5 text-sm font-bold text-indigo-100 hover:bg-indigo-900/50 disabled:opacity-50"
            >
              {loading ? 'Fetching…' : 'Fetch timeline'}
            </button>
            <button
              type="button"
              disabled={loading}
              onClick={() => void fetchVehicleV2('risk')}
              className="rounded-xl border border-indigo-500/40 bg-indigo-950/40 px-4 py-2.5 text-sm font-bold text-indigo-100 hover:bg-indigo-900/50 disabled:opacity-50"
            >
              {loading ? 'Fetching…' : 'Fetch risk'}
            </button>
          </div>
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

        {fetchKind === 'summary' &&
        parsed != null &&
        isRecord(parsed) &&
        parsed.status === 'ok' &&
        isRecord(parsed.data) &&
        typeof parsed.data.vehicleRegNo === 'string' &&
        typeof parsed.data.updatedAt === 'string' ? (
            <div className="mt-4 space-y-3 rounded-xl border border-emerald-500/25 bg-emerald-950/15 p-4">
              <p className="text-xs font-semibold uppercase tracking-wider text-emerald-400/90">Summary</p>
              <dl className="grid gap-3 text-sm text-slate-300 sm:grid-cols-2">
                <div>
                  <dt className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">vehicleRegNo</dt>
                  <dd className="mt-0.5 font-mono text-slate-100">{parsed.data.vehicleRegNo}</dd>
                </div>
                <div>
                  <dt className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">updatedAt</dt>
                  <dd className="mt-0.5 font-mono text-xs text-slate-300">{parsed.data.updatedAt}</dd>
                </div>
              </dl>
              <details className="rounded-lg border border-[#1f2937] bg-[#05070a]/80 p-3">
                <summary className="cursor-pointer text-xs font-semibold uppercase tracking-wider text-slate-400 hover:text-slate-300">
                  Snapshot (JSON)
                </summary>
                <pre className="mt-2 max-h-48 overflow-auto rounded-lg border border-[#1f2937] bg-[#05070a] p-3 font-mono text-xs leading-relaxed text-slate-200">
                  {JSON.stringify(parsed.data.snapshot, null, 2)}
                </pre>
              </details>
            </div>
          ) : null}

        {fetchKind === 'risk' &&
        parsed != null &&
        isRecord(parsed) &&
        parsed.status === 'ok' &&
        typeof parsed.score === 'number' &&
        typeof parsed.tier === 'string' &&
        Array.isArray(parsed.signals) ? (
            <div className="mt-4 space-y-3 rounded-xl border border-amber-500/25 bg-amber-950/15 p-4">
              <p className="text-xs font-semibold uppercase tracking-wider text-amber-400/90">Risk</p>
              <div className="flex flex-wrap items-baseline gap-4 text-sm text-slate-200">
                <div>
                  <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">score</span>
                  <p className="font-mono text-lg font-bold text-amber-200">{parsed.score}</p>
                </div>
                <div>
                  <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">tier</span>
                  <p className="font-mono text-lg font-bold capitalize text-amber-100/95">{parsed.tier}</p>
                </div>
              </div>
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">signals</p>
                <ul className="mt-1 list-inside list-disc space-y-1 font-mono text-xs text-slate-300">
                  {(parsed.signals as unknown[]).map((s, i) => (
                    <li key={i}>{typeof s === 'string' ? s : JSON.stringify(s)}</li>
                  ))}
                </ul>
              </div>
            </div>
          ) : null}

        {fetchKind === 'timeline' &&
        parsed != null &&
        isRecord(parsed) &&
        parsed.status === 'ok' &&
        Array.isArray(parsed.events) ? (
            <div className="mt-4 space-y-3 rounded-xl border border-sky-500/25 bg-sky-950/15 p-4">
              <p className="text-xs font-semibold uppercase tracking-wider text-sky-400/90">Timeline</p>
              <ul className="divide-y divide-[#1f2937] rounded-lg border border-[#1f2937] bg-[#05070a]/60">
                {(parsed.events as unknown[]).map((ev, i) => {
                  if (!isRecord(ev)) {
                    return (
                      <li key={i} className="px-3 py-2 font-mono text-xs text-slate-500">
                        {JSON.stringify(ev)}
                      </li>
                    );
                  }
                  const type = typeof ev.type === 'string' ? ev.type : '—';
                  const at =
                    typeof ev.occurredAt === 'string'
                      ? ev.occurredAt
                      : typeof ev.at === 'string'
                        ? ev.at
                        : '—';
                  return (
                    <li key={typeof ev.id === 'string' ? ev.id : i} className="px-3 py-2.5 text-sm">
                      <div className="flex flex-wrap items-baseline justify-between gap-2">
                        <span className="font-mono text-xs font-semibold text-sky-200/95">{type}</span>
                        <span className="font-mono text-[11px] text-slate-500">{at}</span>
                      </div>
                      <p className="mt-1 break-all font-mono text-[11px] leading-relaxed text-slate-400">
                        {truncatePayloadJson('payload' in ev ? ev.payload : ev.detail, 160)}
                      </p>
                    </li>
                  );
                })}
              </ul>
            </div>
          ) : null}

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
