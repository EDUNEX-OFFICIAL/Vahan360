'use client';

export default function FailedVehiclesPage() {
  return (
    <div className="mx-auto max-w-7xl space-y-8 pb-20">

      {/* ── Page Hero Header ── */}
      <section className="relative overflow-hidden rounded-3xl border border-[#1f2937] bg-gradient-to-br from-[#0d1020] via-[#0b0f16] to-[#05070a] p-6 md:p-8">
        <div className="animate-glow-drift pointer-events-none absolute -right-20 -top-20 h-64 w-64 rounded-full bg-indigo-600/10 blur-3xl" />
        <div className="animate-glow-drift pointer-events-none absolute -bottom-10 left-10 h-40 w-40 rounded-full bg-blue-600/8 blur-2xl" style={{ animationDelay: '2s' }} />

        <div className="relative flex flex-col gap-5 md:flex-row md:items-end md:justify-between">
          <div>
            <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.25em] text-indigo-400">Core Operations</p>
            <h1 className="mb-1 bg-gradient-to-r from-white via-indigo-100 to-indigo-400 bg-clip-text text-4xl font-extrabold tracking-tight text-transparent md:text-5xl">
              Failed Assets
            </h1>
            <p className="text-sm font-medium tracking-wide text-slate-400">Network status monitor and retry queue</p>
          </div>

          <div className="flex flex-wrap gap-2">
            <span className="inline-flex items-center gap-1.5 rounded-full border border-green-500/40 bg-green-500/10 px-3 py-1 text-xs font-medium text-green-300">
              <span className="relative flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75" />
                <span className="relative inline-flex h-2 w-2 rounded-full bg-green-500" />
              </span>
              SYSTEM STABLE
            </span>
            <span className="inline-flex items-center gap-1.5 rounded-full border border-slate-600/60 bg-slate-700/20 px-3 py-1 text-xs font-medium text-slate-300">
              <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
              </svg>
              NETWORK MONITOR
            </span>
          </div>
        </div>
      </section>

      {/* ── Status Section ── */}
      <section className="space-y-4">
        <div>
          <h2 className="text-lg font-semibold text-white">Asset Failure Queue</h2>
          <p className="text-sm text-slate-500">Vehicles flagged for retry or failure states appear here.</p>
        </div>

        {/* Empty State Panel */}
        <div className="relative overflow-hidden rounded-3xl border border-[#1f2937] bg-gradient-to-br from-[#0d1020] via-[#0b0f16] to-[#05070a] p-20 shadow-2xl">
          <div className="pointer-events-none absolute inset-0 rounded-3xl bg-[radial-gradient(ellipse_at_top_right,rgba(99,102,241,0.06)_0%,transparent_65%)]" />
          <div className="pointer-events-none absolute left-0 top-0 h-1 w-full bg-gradient-to-r from-transparent via-indigo-600/40 to-transparent" />

          <div className="relative flex flex-col items-center text-center">
            <div className="mb-8 flex h-24 w-24 items-center justify-center rounded-3xl border border-[#1f2937] bg-[#05070a]/80 shadow-inner">
              <svg className="h-12 w-12 text-slate-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
              </svg>
            </div>

            <h2 className="mb-3 text-3xl font-black tracking-tight text-white">Zero Asset Failures</h2>
            <p className="max-w-lg text-sm font-medium leading-relaxed text-slate-500">
              All network operations are running within optimal parameters. No vehicles are currently flagged for retry or failure states.
            </p>

            <div className="mt-8 flex flex-wrap justify-center gap-3">
              <button
                onClick={() => (window.location.href = '/dashboard/khanansoft')}
                className="inline-flex items-center gap-2 rounded-xl border border-indigo-500/40 bg-indigo-500/15 px-8 py-3 text-sm font-semibold text-indigo-100 transition hover:bg-indigo-500/25 active:scale-95"
              >
                <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 10h16M4 14h16M4 18h16" />
                </svg>
                View Real-Time Logs
              </button>
              <button
                onClick={() => (window.location.href = '/dashboard/leads')}
                className="inline-flex items-center gap-2 rounded-xl border border-slate-600/50 bg-slate-700/20 px-8 py-3 text-sm font-semibold text-slate-200 transition hover:bg-slate-700/35 active:scale-95"
              >
                Go to Leads
              </button>
            </div>
          </div>
        </div>
      </section>

      {/* ── Recent Activity ── */}
      <section className="space-y-4">
        <div>
          <h2 className="text-lg font-semibold text-white">Recent Activity</h2>
          <p className="text-sm text-slate-500">Latest network checks and system events.</p>
        </div>

        <div className="rounded-2xl border border-[#1f2937] bg-[#0b0f16] p-5 md:p-6">
          <div className="space-y-1">
            {[
              { type: 'success' as const, title: 'Network scan completed', detail: 'All vehicles passed the latest connectivity check.', time: 'Just now' },
              { type: 'info' as const, title: 'Retry queue cleared', detail: 'No pending retry items in the current queue.', time: 'Today' },
            ].map((event, index) => (
              <div
                key={index}
                className={`flex items-start gap-0 overflow-hidden rounded-xl transition-all ${
                  event.type === 'success' ? 'bg-green-500/5 hover:bg-green-500/8' : 'bg-indigo-500/5 hover:bg-indigo-500/8'
                }`}
              >
                <div className={`w-1 shrink-0 self-stretch rounded-l-xl ${event.type === 'success' ? 'bg-green-500' : 'bg-indigo-500'}`} />
                <div className="min-w-0 flex-1 px-4 py-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="text-sm font-semibold text-slate-100">{event.title}</p>
                    <span className="text-xs text-slate-500">{event.time}</span>
                  </div>
                  <p className="mt-0.5 text-sm text-slate-400">{event.detail}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

    </div>
  );
}
