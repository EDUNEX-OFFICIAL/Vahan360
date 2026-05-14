'use client';

import { useEffect, useState } from 'react';
import { getApiBaseUrl } from '@/lib/api';

const API_BASE_URL = getApiBaseUrl();

type HealthStatus = 'loading' | 'connected' | 'failed';

export default function TestingPage() {
  const [status, setStatus] = useState<HealthStatus>('loading');
  const [message, setMessage] = useState<string | null>(null);
  const [checkedAt, setCheckedAt] = useState<string | null>(null);

  const checkHealth = async () => {
    setStatus('loading');
    setMessage(null);
    try {
      const res = await fetch(`${API_BASE_URL}/health`);
      const data: { status?: string } = await res.json();
      setStatus(data.status === 'OK' ? 'connected' : 'failed');
      setMessage(data.status === 'OK' ? 'Backend responded with status OK.' : 'Backend returned an unexpected status.');
    } catch (err) {
      setStatus('failed');
      setMessage(err instanceof Error ? err.message : 'Backend request failed.');
    } finally {
      setCheckedAt(new Date().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', second: '2-digit' }));
    }
  };

  useEffect(() => {
    void checkHealth();
  }, []);

  if (status === 'loading') {
    return (
      <div className="mx-auto max-w-7xl space-y-6 pb-20">
        <div className="h-36 animate-pulse rounded-3xl border border-[#1f2937] bg-[#0b0f16]" />
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          {[0, 1, 2].map((k) => (
            <div key={k} className="h-28 animate-pulse rounded-2xl border border-[#1f2937] bg-[#0b0f16]" />
          ))}
        </div>
        <div className="h-48 animate-pulse rounded-[28px] border border-[#1f2937] bg-[#0b0f16]" />
      </div>
    );
  }

  const isConnected = status === 'connected';

  return (
    <div className="mx-auto max-w-7xl space-y-8 pb-20">

      {/* ── Page Hero Header ── */}
      <section className="relative overflow-hidden rounded-3xl border border-[#1f2937] bg-gradient-to-br from-[#0d1020] via-[#0b0f16] to-[#05070a] p-6 md:p-8">
        <div className="animate-glow-drift pointer-events-none absolute -right-20 -top-20 h-64 w-64 rounded-full bg-indigo-600/10 blur-3xl" />
        <div className="animate-glow-drift pointer-events-none absolute -bottom-10 left-10 h-40 w-40 rounded-full bg-blue-600/8 blur-2xl" style={{ animationDelay: '2s' }} />

        <div className="relative flex flex-col gap-5 md:flex-row md:items-end md:justify-between">
          <div>
            <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.25em] text-indigo-400">Developer Tools</p>
            <h1 className="mb-1 bg-gradient-to-r from-white via-indigo-100 to-indigo-400 bg-clip-text text-4xl font-extrabold tracking-tight text-transparent md:text-5xl">
              System Health
            </h1>
            <p className="text-sm font-medium tracking-wide text-slate-400">Backend connectivity and service diagnostics</p>
          </div>

          <div className="flex flex-wrap gap-2">
            <span className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium ${
              isConnected
                ? 'border-green-500/40 bg-green-500/10 text-green-300'
                : 'border-red-500/40 bg-red-500/10 text-red-300'
            }`}>
              {isConnected ? (
                <span className="relative flex h-2 w-2">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75" />
                  <span className="relative inline-flex h-2 w-2 rounded-full bg-green-500" />
                </span>
              ) : (
                <span className="h-2 w-2 rounded-full bg-red-500" />
              )}
              {isConnected ? 'CONNECTED' : 'DISCONNECTED'}
            </span>

            {checkedAt && (
              <span className="inline-flex items-center gap-1.5 rounded-full border border-slate-600/60 bg-slate-700/20 px-3 py-1 text-xs font-medium text-slate-300">
                <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                CHECKED {checkedAt}
              </span>
            )}
          </div>
        </div>
      </section>

      {/* ── Metric Cards ── */}
      <section className="space-y-4">
        <div>
          <h2 className="text-lg font-semibold text-white">Service Status</h2>
          <p className="text-sm text-slate-500">Real-time view of backend service availability.</p>
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          {[
            {
              label: 'API Server',
              value: isConnected ? 'Online' : 'Offline',
              icon: 'M5 12h14M12 5l7 7-7 7',
              gradient: isConnected
                ? 'bg-gradient-to-br from-green-500/8 via-transparent to-transparent'
                : 'bg-gradient-to-br from-red-500/8 via-transparent to-transparent',
              border: isConnected ? 'hover:border-green-500/40' : 'hover:border-red-500/40',
              iconColor: isConnected ? 'text-green-400' : 'text-red-400',
              badge: isConnected ? 'text-green-400' : 'text-red-400',
            },
            {
              label: 'Health Endpoint',
              value: 'GET /health',
              icon: 'M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z',
              gradient: 'bg-gradient-to-br from-indigo-500/8 via-transparent to-transparent',
              border: 'hover:border-indigo-500/40',
              iconColor: 'text-indigo-400',
              badge: 'text-indigo-400',
            },
            {
              label: 'Response',
              value: isConnected ? 'status: OK' : 'No response',
              icon: 'M13 10V3L4 14h7v7l9-11h-7z',
              gradient: 'bg-gradient-to-br from-amber-500/8 via-transparent to-transparent',
              border: 'hover:border-amber-500/40',
              iconColor: 'text-amber-400',
              badge: 'text-amber-400',
            },
          ].map((card, i) => (
            <div
              key={i}
              className={`group relative overflow-hidden rounded-2xl border border-[#1f2937] p-5 transition-all duration-300 ${card.gradient} ${card.border}`}
            >
              <div className="mb-4 flex items-start justify-between">
                <div className="flex items-center space-x-2.5">
                  <div className={`flex h-7 w-7 items-center justify-center rounded-lg bg-current/10 ${card.iconColor}`}>
                    <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d={card.icon} />
                    </svg>
                  </div>
                  <span className="text-[11px] font-medium tracking-wide text-slate-400">{card.label}</span>
                </div>
              </div>
              <div className={`text-xl font-bold ${card.badge}`}>{card.value}</div>
            </div>
          ))}
        </div>
      </section>

      {/* ── Connection Detail Panel ── */}
      <section className="space-y-4">
        <div>
          <h2 className="text-lg font-semibold text-white">Connection Detail</h2>
          <p className="text-sm text-slate-500">Full diagnostic output from the last health check.</p>
        </div>

        <div className="relative overflow-hidden rounded-[28px] border border-[#1f2937] bg-gradient-to-br from-[#0d1020] via-[#0b0f16] to-[#05070a] p-8 shadow-2xl">
          <div className="pointer-events-none absolute inset-0 rounded-[28px] bg-[radial-gradient(ellipse_at_top_right,rgba(99,102,241,0.08)_0%,transparent_65%)]" />

          <div className="absolute right-6 top-6 opacity-[0.06]">
            <svg className="h-36 w-36 text-indigo-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
            </svg>
          </div>

          <h3 className="relative mb-6 text-sm font-semibold uppercase tracking-[0.2em] text-slate-500">Diagnostic Output</h3>

          <div className="relative flex flex-col gap-8 md:flex-row md:items-center md:justify-between">
            <div className="space-y-3.5">
              <div className="flex items-center space-x-4">
                {isConnected ? (
                  <span className="relative flex h-3 w-3">
                    <span className="animate-ping-slow absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75" />
                    <span className="relative inline-flex h-3 w-3 rounded-full bg-green-500 shadow-[0_0_14px_rgba(34,197,94,0.8)]" />
                  </span>
                ) : (
                  <span className="h-3 w-3 rounded-full bg-red-500 shadow-[0_0_14px_rgba(239,68,68,0.8)]" />
                )}
                <span className="text-2xl font-semibold tracking-tight text-white">
                  {isConnected ? 'Backend Connected' : 'Backend Unreachable'}
                </span>
              </div>
              <p className="max-w-sm text-sm leading-relaxed text-slate-400">
                {message || (isConnected ? 'Service is healthy and responding.' : 'Could not reach the backend service.')}
              </p>

              <div className="max-w-md space-y-2 rounded-xl border border-[#1f2937] bg-[#05070a]/80 p-3.5">
                <div className="flex items-center justify-between text-[11px]">
                  <span className="font-medium tracking-wide text-slate-400">Endpoint</span>
                  <span className="font-mono text-slate-300">{API_BASE_URL}/health</span>
                </div>
                <div className="h-px bg-[#1f2937]" />
                <div className="flex items-center justify-between text-[11px]">
                  <span className="font-medium tracking-wide text-slate-400">Last Check</span>
                  <span className={`font-semibold ${isConnected ? 'text-green-400' : 'text-red-400'}`}>
                    {checkedAt ?? '—'}
                  </span>
                </div>
              </div>
            </div>

            <button
              onClick={() => void checkHealth()}
              className="inline-flex items-center gap-2 rounded-xl border border-indigo-500/40 bg-indigo-500/15 px-6 py-3 text-sm font-semibold text-indigo-100 transition hover:bg-indigo-500/25 active:scale-95"
            >
              <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582M20 20v-5h-.581M5.341 15A8 8 0 0018.66 9M18.659 9A8 8 0 005.34 15" />
              </svg>
              Re-check
            </button>
          </div>
        </div>
      </section>

    </div>
  );
}
