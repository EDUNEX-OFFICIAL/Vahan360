'use client';

import Link from 'next/link';
import { useCallback, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { ScrapeJobKind } from '@vahan360/contracts';
import { SCRAPE_JOB_KINDS } from '@vahan360/contracts';

import { apiUrl, clearSpybotToken, getAuthHeaders, getSpybotToken, NEST_V2_PROXY_NETWORK_ERROR } from '@/lib/api-client';
import {
  logAndUserFacingHttpError,
  logRequestDiagnostics,
  userFacingHttpError,
} from '@/lib/user-facing-errors';

const BULL_BOARD_URL = (process.env.NEXT_PUBLIC_BULL_BOARD_URL || '').trim();

function isoDate(d: Date) {
  return d.toISOString().slice(0, 10);
}

function parseSseBlock(block: string): { event: string; data: string } | null {
  let event = 'message';
  const dataLines: string[] = [];
  for (const line of block.split('\n')) {
    if (line.startsWith('event:')) {
      event = line.slice(6).trim();
    } else if (line.startsWith('data:')) {
      dataLines.push(line.slice(5).trimStart());
    }
  }
  if (dataLines.length === 0) return null;
  return { event, data: dataLines.join('\n') };
}

export default function ScrapeConsolePage() {
  const router = useRouter();
  const [kind, setKind] = useState<ScrapeJobKind>('khanan_date_range');
  const [correlationId, setCorrelationId] = useState(() => crypto.randomUUID());
  const [fromDate, setFromDate] = useState(() => isoDate(new Date()));
  const [toDate, setToDate] = useState(() => isoDate(new Date()));
  const [vehicleRegNo, setVehicleRegNo] = useState('');
  const [consignerKey, setConsignerKey] = useState('');
  const [idempotencyKey, setIdempotencyKey] = useState('');
  const [jobId, setJobId] = useState('');
  const [enqueueResult, setEnqueueResult] = useState<string | null>(null);
  const [enqueueError, setEnqueueError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const [streamJobId, setStreamJobId] = useState('');
  const [streamLines, setStreamLines] = useState<string[]>([]);
  const [lastEventJson, setLastEventJson] = useState<string | null>(null);
  const [streamError, setStreamError] = useState<string | null>(null);
  const [streaming, setStreaming] = useState(false);
  const streamAbortRef = useRef<AbortController | null>(null);

  const [workersJson, setWorkersJson] = useState<string | null>(null);
  const [workersError, setWorkersError] = useState<string | null>(null);
  const [workersLoading, setWorkersLoading] = useState(false);

  const buildEnqueueBody = useCallback(() => {
    const base = { kind, correlationId: correlationId.trim() };
    if (kind === 'khanan_date_range') {
      return { ...base, fromDate, toDate };
    }
    if (
      kind === 'vehicle_permit_snapshot' ||
      kind === 'vehicle_insurance_snapshot' ||
      kind === 'vehicle_fitness_snapshot' ||
      kind === 'vehicle_registration_snapshot' ||
      kind === 'trip_intelligence_rollup'
    ) {
      return { ...base, vehicleRegNo: vehicleRegNo.trim() };
    }
    if (kind === 'consigner_digest') {
      return { ...base, consignerKey: consignerKey.trim() };
    }
    return { ...base };
  }, [kind, correlationId, fromDate, toDate, vehicleRegNo, consignerKey]);

  const validateEnqueue = useCallback(() => {
    if (!correlationId.trim()) return 'Request ID zaroori / Reference ID is required.';
    if (kind === 'khanan_date_range') {
      if (!fromDate || !toDate) return 'Dono dates chunein / Please pick both dates.';
    }
    if (
      kind === 'vehicle_permit_snapshot' ||
      kind === 'vehicle_insurance_snapshot' ||
      kind === 'vehicle_fitness_snapshot' ||
      kind === 'vehicle_registration_snapshot' ||
      kind === 'trip_intelligence_rollup'
    ) {
      if (!vehicleRegNo.trim()) return 'Vehicle number zaroori / Vehicle number is required.';
    }
    if (kind === 'consigner_digest') {
      if (!consignerKey.trim()) return 'Consigner field zaroori / Consigner details are required.';
    }
    return null;
  }, [kind, correlationId, fromDate, toDate, vehicleRegNo, consignerKey]);

  const handleEnqueue = async (e: React.FormEvent) => {
    e.preventDefault();
    const err = validateEnqueue();
    if (err) {
      setEnqueueError(err);
      return;
    }
    const token = getSpybotToken();
    if (!token) {
      router.replace('/login');
      return;
    }

    setSubmitting(true);
    setEnqueueError(null);
    setEnqueueResult(null);

    const idem = idempotencyKey.trim() || crypto.randomUUID();
    const headers: Record<string, string> = {
      ...getAuthHeaders(token, { json: true }),
      'Idempotency-Key': idem,
    };

    try {
      const res = await fetch(apiUrl('/api/v1/scrape-jobs'), {
        method: 'POST',
        headers,
        body: JSON.stringify(buildEnqueueBody()),
      });
      const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;

      if (res.status === 401) {
        clearSpybotToken();
        router.replace('/login');
        return;
      }

      if (!res.ok) {
        setEnqueueError(logAndUserFacingHttpError(res, data, '/api/v1/scrape-jobs'));
        return;
      }

      const jid = typeof data.jobId === 'string' ? data.jobId : '';
      if (!jid) {
        logRequestDiagnostics({ body: data, path: '/api/v1/scrape-jobs' }, 'Enqueue missing jobId');
        setEnqueueError('Server se jawab poora nahi mila / Could not start the job.');
        return;
      }

      setJobId(jid);
      setStreamJobId(jid);
      setEnqueueResult(JSON.stringify({ ...data, idempotencyKey: idem }, null, 2));
    } catch {
      setEnqueueError(NEST_V2_PROXY_NETWORK_ERROR);
    } finally {
      setSubmitting(false);
    }
  };

  const stopStream = useCallback(() => {
    streamAbortRef.current?.abort();
    streamAbortRef.current = null;
    setStreaming(false);
  }, []);

  const startStream = async () => {
    const id = streamJobId.trim();
    if (!id) {
      setStreamError('Job ID zaroori / Job ID is required.');
      return;
    }
    const uuidRe =
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    if (!uuidRe.test(id)) {
      setStreamError('Job ID format galat hai / Job ID format is not valid.');
      return;
    }

    const token = getSpybotToken();
    if (!token) {
      router.replace('/login');
      return;
    }

    stopStream();
    setStreamError(null);
    setStreamLines([]);
    setLastEventJson(null);

    const ac = new AbortController();
    streamAbortRef.current = ac;
    setStreaming(true);

    const url = apiUrl(`/api/v1/scrape-jobs/${encodeURIComponent(id)}/stream`);

    try {
      const res = await fetch(url, {
        method: 'GET',
        headers: getAuthHeaders(token),
        signal: ac.signal,
      });

      if (res.status === 401) {
        clearSpybotToken();
        router.replace('/login');
        return;
      }

      if (!res.ok) {
        const t = await res.text();
        let pathForLog = '/api/v1/scrape-jobs/…/stream';
        try {
          pathForLog = new URL(url).pathname;
        } catch {
          /* ignore */
        }
        logRequestDiagnostics({ status: res.status, body: t, path: pathForLog }, 'SSE stream error');
        setStreamError(userFacingHttpError(res.status, t));
        setStreaming(false);
        return;
      }

      const reader = res.body?.getReader();
      if (!reader) {
        setStreamError(userFacingHttpError(502, null));
        setStreaming(false);
        return;
      }

      const decoder = new TextDecoder();
      let buffer = '';

      const pushLine = (line: string) => {
        setStreamLines((prev) => {
          const next = [...prev, line];
          return next.length > 500 ? next.slice(-500) : next;
        });
      };

      while (!ac.signal.aborted) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        let idx: number;
        while ((idx = buffer.indexOf('\n\n')) >= 0) {
          const rawBlock = buffer.slice(0, idx);
          buffer = buffer.slice(idx + 2);

          const trimmed = rawBlock.trim();
          if (!trimmed || trimmed.startsWith(':')) {
            if (trimmed.startsWith(':')) pushLine(trimmed);
            continue;
          }

          const parsed = parseSseBlock(rawBlock);
          if (!parsed) continue;
          const line = `[${parsed.event}] ${parsed.data}`;
          pushLine(line);
          try {
            setLastEventJson(JSON.stringify(JSON.parse(parsed.data), null, 2));
          } catch {
            setLastEventJson(parsed.data);
          }
        }
      }
    } catch (e: unknown) {
      const aborted = e instanceof DOMException && e.name === 'AbortError';
      if (!aborted) {
        logRequestDiagnostics({ body: e instanceof Error ? e.message : String(e) }, 'SSE stream failed');
        setStreamError(NEST_V2_PROXY_NETWORK_ERROR);
      }
    } finally {
      setStreaming(false);
      streamAbortRef.current = null;
    }
  };

  const refreshWorkers = async () => {
    const token = getSpybotToken();
    if (!token) {
      router.replace('/login');
      return;
    }
    setWorkersLoading(true);
    setWorkersError(null);
    try {
      const res = await fetch(apiUrl('/api/v1/workers/status?limit=20'), {
        headers: getAuthHeaders(token),
      });
      const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      if (res.status === 401) {
        clearSpybotToken();
        router.replace('/login');
        return;
      }
      if (!res.ok) {
        setWorkersError(logAndUserFacingHttpError(res, data, '/api/v1/workers/status'));
        return;
      }
      setWorkersJson(JSON.stringify(data, null, 2));
    } catch {
      setWorkersError(NEST_V2_PROXY_NETWORK_ERROR);
    } finally {
      setWorkersLoading(false);
    }
  };

  const showDateRange = kind === 'khanan_date_range';
  const showVehicle =
    kind === 'vehicle_permit_snapshot' ||
    kind === 'vehicle_insurance_snapshot' ||
    kind === 'vehicle_fitness_snapshot' ||
    kind === 'vehicle_registration_snapshot' ||
    kind === 'trip_intelligence_rollup';
  const showConsigner = kind === 'consigner_digest';

  const kindOptions = useMemo(() => [...SCRAPE_JOB_KINDS], []);

  return (
    <div className="mx-auto max-w-5xl space-y-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-white">Scrape console</h1>
        </div>
        <Link
          href="/dashboard/leads"
          className="text-xs font-semibold uppercase tracking-wider text-indigo-400 hover:text-indigo-300"
        >
          ← Dashboard
        </Link>
      </div>

      <section className="rounded-2xl border border-[#1f2937] bg-[#0b0f16]/80 p-6 shadow-lg">
        <h2 className="mb-4 text-sm font-bold uppercase tracking-widest text-slate-500">
          Enqueue job
        </h2>
        <form onSubmit={handleEnqueue} className="grid gap-4 md:grid-cols-2">
          <label className="block md:col-span-2">
            <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-slate-500">
              kind
            </span>
            <select
              value={kind}
              onChange={(e) => setKind(e.target.value as ScrapeJobKind)}
              className="w-full rounded-xl border border-[#1f2937] bg-[#05070a] px-3 py-2.5 text-sm text-slate-200 outline-none focus:border-indigo-500/50"
            >
              {kindOptions.map((k) => (
                <option key={k} value={k}>
                  {k}
                </option>
              ))}
            </select>
          </label>

          <label className="block md:col-span-2">
            <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-slate-500">
              correlationId
            </span>
            <div className="flex gap-2">
              <input
                value={correlationId}
                onChange={(e) => setCorrelationId(e.target.value)}
                className="min-w-0 flex-1 rounded-xl border border-[#1f2937] bg-[#05070a] px-3 py-2.5 font-mono text-xs text-slate-200 outline-none focus:border-indigo-500/50"
              />
              <button
                type="button"
                onClick={() => setCorrelationId(crypto.randomUUID())}
                className="shrink-0 rounded-xl border border-[#1f2937] px-3 py-2 text-xs font-bold uppercase tracking-wider text-slate-400 hover:border-indigo-500/40 hover:text-indigo-300"
              >
                New
              </button>
            </div>
          </label>

          {showDateRange && (
            <>
              <label className="block">
                <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                  fromDate
                </span>
                <input
                  type="date"
                  value={fromDate}
                  onChange={(e) => setFromDate(e.target.value)}
                  className="w-full rounded-xl border border-[#1f2937] bg-[#05070a] px-3 py-2.5 text-sm text-slate-200 outline-none focus:border-indigo-500/50"
                />
              </label>
              <label className="block">
                <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                  toDate
                </span>
                <input
                  type="date"
                  value={toDate}
                  onChange={(e) => setToDate(e.target.value)}
                  className="w-full rounded-xl border border-[#1f2937] bg-[#05070a] px-3 py-2.5 text-sm text-slate-200 outline-none focus:border-indigo-500/50"
                />
              </label>
            </>
          )}

          {showVehicle && (
            <label className="block md:col-span-2">
              <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                vehicleRegNo
              </span>
              <input
                value={vehicleRegNo}
                onChange={(e) => setVehicleRegNo(e.target.value)}
                placeholder="BR01AB1234"
                className="w-full rounded-xl border border-[#1f2937] bg-[#05070a] px-3 py-2.5 text-sm text-slate-200 outline-none focus:border-indigo-500/50"
              />
            </label>
          )}

          {showConsigner && (
            <label className="block md:col-span-2">
              <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                consignerKey
              </span>
              <input
                value={consignerKey}
                onChange={(e) => setConsignerKey(e.target.value)}
                placeholder=""
                className="w-full rounded-xl border border-[#1f2937] bg-[#05070a] px-3 py-2.5 text-sm text-slate-200 outline-none focus:border-indigo-500/50"
              />
            </label>
          )}

          <label className="block md:col-span-2">
            <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-slate-500">
              Idempotency-Key
            </span>
            <input
              value={idempotencyKey}
              onChange={(e) => setIdempotencyKey(e.target.value)}
              className="w-full rounded-xl border border-[#1f2937] bg-[#05070a] px-3 py-2.5 font-mono text-xs text-slate-200 outline-none focus:border-indigo-500/50"
            />
          </label>

          <div className="md:col-span-2">
            <button
              type="submit"
              disabled={submitting}
              className="rounded-xl bg-gradient-to-r from-indigo-600 to-blue-600 px-6 py-2.5 text-sm font-bold text-white shadow-lg shadow-indigo-900/30 hover:from-indigo-500 hover:to-blue-500 disabled:opacity-50"
            >
              {submitting ? 'Posting…' : 'Enqueue'}
            </button>
          </div>
        </form>

        {enqueueError && (
          <div className="mt-4 rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">
            <p>{enqueueError}</p>
            {BULL_BOARD_URL && (
              <p className="mt-3 text-sm">
                <a
                  href={BULL_BOARD_URL}
                  target="_blank"
                  rel="noreferrer"
                  className="text-indigo-300 underline hover:text-indigo-200"
                >
                  Queue board
                </a>
              </p>
            )}
          </div>
        )}
        {enqueueResult && (
          <div className="mt-4">
            <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-emerald-500/90">
              Response (jobId)
            </p>
            <pre className="max-h-48 overflow-auto rounded-xl border border-[#1f2937] bg-[#05070a] p-4 font-mono text-xs text-slate-300">
              {enqueueResult}
            </pre>
            {jobId && (
              <p className="mt-2 text-xs text-slate-500">
                jobId: <span className="font-mono text-slate-300">{jobId}</span>
              </p>
            )}
          </div>
        )}
      </section>

      <section className="rounded-2xl border border-[#1f2937] bg-[#0b0f16]/80 p-6 shadow-lg">
        <h2 className="mb-4 text-sm font-bold uppercase tracking-widest text-slate-500">
          SSE stream
        </h2>
        <div className="flex flex-wrap items-center gap-2">
          <input
            value={streamJobId}
            onChange={(e) => setStreamJobId(e.target.value)}
            placeholder=""
            className="min-w-[240px] flex-1 rounded-xl border border-[#1f2937] bg-[#05070a] px-3 py-2.5 font-mono text-xs text-slate-200 outline-none focus:border-indigo-500/50"
          />
          {!streaming ? (
            <button
              type="button"
              onClick={() => void startStream()}
              className="rounded-xl bg-emerald-700/80 px-4 py-2.5 text-xs font-bold uppercase tracking-wider text-white hover:bg-emerald-600"
            >
              Start stream
            </button>
          ) : (
            <button
              type="button"
              onClick={stopStream}
              className="rounded-xl border border-amber-500/40 bg-amber-500/10 px-4 py-2.5 text-xs font-bold uppercase tracking-wider text-amber-200 hover:bg-amber-500/20"
            >
              Stop
            </button>
          )}
        </div>

        {streamError && (
          <div className="mt-4 rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">
            {streamError}
          </div>
        )}

        <div className="mt-4 grid gap-4 md:grid-cols-2">
          <div>
            <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-slate-500">
              Live lines
            </p>
            <pre className="h-64 overflow-auto rounded-xl border border-[#1f2937] bg-[#05070a] p-3 font-mono text-[11px] leading-relaxed text-slate-400">
              {streamLines.length === 0 ? '—' : streamLines.join('\n')}
            </pre>
          </div>
          <div>
            <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-slate-500">
              Last event JSON
            </p>
            <pre className="h-64 overflow-auto rounded-xl border border-[#1f2937] bg-[#05070a] p-3 font-mono text-[11px] text-slate-300">
              {lastEventJson ?? '—'}
            </pre>
          </div>
        </div>
      </section>

      <section className="rounded-2xl border border-[#1f2937] bg-[#0b0f16]/80 p-6 shadow-lg">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-bold uppercase tracking-widest text-slate-500">
            Worker status
          </h2>
          <button
            type="button"
            onClick={() => void refreshWorkers()}
            disabled={workersLoading}
            className="rounded-lg border border-[#1f2937] px-3 py-1.5 text-xs font-bold uppercase tracking-wider text-slate-400 hover:border-indigo-500/40 hover:text-indigo-300 disabled:opacity-50"
          >
            {workersLoading ? 'Loading…' : 'Refresh'}
          </button>
        </div>
        {workersError && (
          <div className="mb-3 rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">
            {workersError}
          </div>
        )}
        <pre className="max-h-56 overflow-auto rounded-xl border border-[#1f2937] bg-[#05070a] p-4 font-mono text-xs text-slate-400">
          {workersJson ?? 'Nothing to show yet.'}
        </pre>
      </section>
    </div>
  );
}
