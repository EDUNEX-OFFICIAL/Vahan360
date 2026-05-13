'use client';

import { useState, useEffect, useCallback } from 'react';

const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL ?? '';
type PipelineStatus = 'pending' | 'in-progress' | 'completed';

const SPRING_STATUS_TO_PIPELINE: Record<string, PipelineStatus> = {
  new: 'pending',
  open: 'pending',
  pending: 'pending',
  todo: 'pending',
  scheduled: 'pending',
  assigned: 'in-progress',
  inprogress: 'in-progress',
  'in-progress': 'in-progress',
  in_progress: 'in-progress',
  followup: 'in-progress',
  'follow-up': 'in-progress',
  working: 'in-progress',
  completed: 'completed',
  closed: 'completed',
  converted: 'completed',
  won: 'completed',
};

interface PipelineItem {
  _id: string;
  vehicleRegNo: string;
  ownerName: string;
  mobileNo: string;
  totalTrips: number;
  totalMTWeight: number;
  status: PipelineStatus;
  nextFollowUp?: string;
  assignedExecutive?: string;
  updatedAt: string;
}

function normalizeStatus(value?: string): PipelineStatus {
  const cleaned = String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[_\s]+/g, '-');
  return SPRING_STATUS_TO_PIPELINE[cleaned] || 'pending';
}

function formatStatus(value?: string): string {
  const normalized = normalizeStatus(value);
  if (normalized === 'in-progress') return 'In Progress';
  if (normalized === 'completed') return 'Completed';
  return 'Pending';
}

const TABS: { id: PipelineStatus; label: string; icon: string; dotColor: string }[] = [
  {
    id: 'pending',
    label: 'Pending',
    icon: 'M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z',
    dotColor: 'bg-orange-500',
  },
  {
    id: 'in-progress',
    label: 'In Progress',
    icon: 'M5 12h.01M12 12h.01M19 12h.01M6 12a1 1 0 11-2 0 1 1 0 012 0zm7 0a1 1 0 11-2 0 1 1 0 012 0zm7 0a1 1 0 11-2 0 1 1 0 012 0z',
    dotColor: 'bg-purple-500',
  },
  {
    id: 'completed',
    label: 'Completed',
    icon: 'M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z',
    dotColor: 'bg-green-500',
  },
];

export default function PipelinePage() {
  const [activeTab, setActiveTab] = useState<PipelineStatus>('pending');
  const [items, setItems] = useState<PipelineItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const token = localStorage.getItem('spybot_token');
      if (!token) {
        setError('Authentication required');
        setLoading(false);
        return;
      }

      const res = await fetch(`${API_BASE_URL}/api/vehicle/trip-summary?status=${activeTab}&limit=50`, {
        headers: { Authorization: `Bearer ${token}` },
      });

      if (res.ok) {
        const result = await res.json();
        const normalizedItems = (result.data || []).map((item: PipelineItem) => ({
          ...item,
          status: normalizeStatus(item.status),
        }));
        setItems(normalizedItems);
      } else if (res.status === 401) {
        localStorage.removeItem('spybot_token');
        setItems([]);
        setError('Authentication expired. Please sign in again.');
      } else {
        setError('Failed to fetch pipeline data');
      }
    } catch (err) {
      console.error(err);
      setError('Connection error. Please try again.');
    } finally {
      setLoading(false);
    }
  }, [activeTab]);

  useEffect(() => {
    const timer = setTimeout(() => {
      void fetchData();
    }, 0);
    return () => clearTimeout(timer);
  }, [fetchData]);

  if (loading) {
    return (
      <div className="mx-auto max-w-7xl space-y-6 pb-20">
        <div className="h-36 animate-pulse rounded-3xl border border-[#1f2937] bg-[#0b0f16]" />
        <div className="h-72 animate-pulse rounded-[28px] border border-[#1f2937] bg-[#0b0f16]" />
      </div>
    );
  }

  const activeTabMeta = TABS.find((t) => t.id === activeTab)!;

  return (
    <div className="mx-auto max-w-7xl space-y-8 pb-20">

      {/* ── Error Banner ── */}
      {error && (
        <section className="rounded-2xl border border-red-500/30 bg-red-500/10 p-4 md:p-5">
          <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <div className="flex items-start gap-3">
              <svg className="mt-0.5 h-5 w-5 text-red-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v4m0 4h.01M3.055 11a9 9 0 1117.89 0 9 9 0 01-17.89 0z" />
              </svg>
              <div>
                <p className="text-sm font-semibold text-red-200">Pipeline failed to load</p>
                <p className="text-sm text-red-300">{error}</p>
              </div>
            </div>
            <button
              onClick={() => void fetchData()}
              className="inline-flex items-center rounded-lg border border-red-400/40 bg-red-500/20 px-4 py-2 text-sm font-medium text-red-100 transition hover:bg-red-500/30"
            >
              Retry
            </button>
          </div>
        </section>
      )}

      {/* ── Page Hero Header ── */}
      <section className="relative overflow-hidden rounded-3xl border border-[#1f2937] bg-gradient-to-br from-[#0d1020] via-[#0b0f16] to-[#05070a] p-6 md:p-8">
        <div className="animate-glow-drift pointer-events-none absolute -right-20 -top-20 h-64 w-64 rounded-full bg-indigo-600/10 blur-3xl" />
        <div className="animate-glow-drift pointer-events-none absolute -bottom-10 left-10 h-40 w-40 rounded-full bg-blue-600/8 blur-2xl" style={{ animationDelay: '2s' }} />

        <div className="relative flex flex-col gap-5 md:flex-row md:items-end md:justify-between">
          <div>
            <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.25em] text-indigo-400">Core Operations</p>
            <h1 className="mb-1 bg-gradient-to-r from-white via-indigo-100 to-indigo-400 bg-clip-text text-4xl font-extrabold tracking-tight text-transparent md:text-5xl">
              Pipeline
            </h1>
            <p className="text-sm font-medium tracking-wide text-slate-400">Vehicle lifecycle tracking and follow-up management</p>
          </div>

          {/* Inline Tab Switcher */}
          <div className="flex flex-col items-start gap-3 md:items-end">
            <div className="inline-flex overflow-hidden rounded-2xl border border-[#1f2937] bg-[#0b0f16] p-1">
              {TABS.map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setActiveTab(tab.id)}
                  className={`rounded-xl px-5 py-2 text-[11px] tracking-wide transition-all ${
                    activeTab === tab.id
                      ? 'bg-indigo-600/20 font-semibold text-indigo-200 shadow-[inset_0_0_0_1px_rgba(99,102,241,0.3)]'
                      : 'font-medium text-slate-400 hover:text-white'
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>

            <div className="flex flex-wrap gap-2">
              <span className="inline-flex items-center gap-1.5 rounded-full border border-indigo-500/30 bg-indigo-500/10 px-3 py-1 text-xs font-medium text-indigo-200">
                <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d={activeTabMeta.icon} />
                </svg>
                {items.length} ASSETS IN {activeTab.toUpperCase()}
              </span>
            </div>
          </div>
        </div>
      </section>

      {/* ── Pipeline Table ── */}
      <section className="space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-lg font-semibold text-white">
              {activeTabMeta.label} Queue
            </h2>
            <p className="text-sm text-slate-500">Showing vehicles with status: {activeTab}.</p>
          </div>
          <div className="flex gap-2">
            <button className="inline-flex items-center gap-2 rounded-xl border border-indigo-500/40 bg-indigo-500/15 px-4 py-2 text-xs font-semibold text-indigo-100 transition hover:bg-indigo-500/25 active:scale-95">
              + Add Entry
            </button>
            <button
              onClick={() => void fetchData()}
              className="inline-flex items-center gap-2 rounded-xl border border-slate-600/50 bg-slate-700/20 px-4 py-2 text-xs font-semibold text-slate-200 transition hover:bg-slate-700/35 active:scale-95"
            >
              <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582M20 20v-5h-.581M5.341 15A8 8 0 0018.66 9M18.659 9A8 8 0 005.34 15" />
              </svg>
              Refresh
            </button>
          </div>
        </div>

        <div className="overflow-hidden rounded-[28px] border border-[#1f2937] bg-[#0b0f16] shadow-2xl">
          <div className="overflow-x-auto">
            <table className="w-full text-left">
              <thead className="border-b border-[#1f2937] bg-[#0d121b]">
                <tr>
                  <th className="px-8 py-5 text-[10px] font-black uppercase tracking-[0.3em] text-slate-500">Asset ID</th>
                  <th className="px-8 py-5 text-[10px] font-black uppercase tracking-[0.3em] text-slate-500">Customer Info</th>
                  <th className="px-8 py-5 text-center text-[10px] font-black uppercase tracking-[0.3em] text-slate-500">Lifecycle Status</th>
                  <th className="px-8 py-5 text-[10px] font-black uppercase tracking-[0.3em] text-slate-500">Next Follow-up</th>
                  <th className="px-8 py-5 text-right text-[10px] font-black uppercase tracking-[0.3em] text-slate-500">Assigned To</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#1f2937]">
                {items.length > 0 ? (
                  items.map((row) => (
                    <tr key={row._id} className="group transition-colors hover:bg-slate-900/40">
                      <td className="px-8 py-5">
                        <div className="flex items-center space-x-4">
                          <div className="h-8 w-0.5 rounded-full bg-indigo-500 opacity-0 transition-opacity group-hover:opacity-100" />
                          <span className="rounded-lg border border-indigo-500/20 bg-indigo-500/10 px-3 py-1.5 text-sm font-black tracking-widest text-indigo-200">
                            {row.vehicleRegNo}
                          </span>
                        </div>
                      </td>
                      <td className="px-8 py-5">
                        <div className="flex items-center space-x-3">
                          <div className="flex h-10 w-10 items-center justify-center rounded-xl border border-[#1f2937] bg-[#05070a] text-xs font-black uppercase text-indigo-400">
                            {(row.ownerName || 'CP').split(' ').map((n) => n[0]).join('').slice(0, 2)}
                          </div>
                          <div className="flex flex-col">
                            <span className="text-sm font-bold uppercase text-slate-200">{row.ownerName || 'Classification Pending'}</span>
                            <span className="text-[10px] font-bold tracking-tighter text-slate-500">{row.mobileNo || '+91 ----------'}</span>
                          </div>
                        </div>
                      </td>
                      <td className="px-8 py-5 text-center">
                        <div className="inline-flex items-center space-x-2 rounded-full border border-[#1f2937] bg-[#05070a] px-4 py-1.5">
                          <span className={`h-2 w-2 rounded-full ${
                            row.status === 'pending' ? 'bg-orange-500' :
                            row.status === 'in-progress' ? 'bg-purple-500' :
                            'bg-green-500'
                          }`} />
                          <span className="text-[10px] font-black uppercase tracking-widest text-slate-300">
                            {formatStatus(row.status)}
                          </span>
                        </div>
                      </td>
                      <td className="px-8 py-5">
                        <div className="flex flex-col">
                          <span className="text-sm font-black uppercase text-slate-300">
                            {row.nextFollowUp
                              ? new Date(row.nextFollowUp).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })
                              : 'Not Scheduled'}
                          </span>
                          <span className="font-mono text-[10px] uppercase tracking-tighter text-slate-500">
                            {row.nextFollowUp
                              ? new Date(row.nextFollowUp).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })
                              : 'TBD'}
                          </span>
                        </div>
                      </td>
                      <td className="px-8 py-5 text-right">
                        <div className="flex flex-col items-end">
                          <span className="text-xs font-black uppercase tracking-tighter text-slate-200">{row.assignedExecutive || 'Unassigned'}</span>
                          <span className="text-[9px] font-bold uppercase tracking-wide text-slate-500 opacity-50">Field Executive</span>
                        </div>
                      </td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={5} className="px-8 py-32 text-center">
                      <p className="text-sm font-medium text-slate-300">No assets in {activeTab} queue</p>
                      <p className="mt-1 text-sm text-slate-500">No vehicles currently match this status.</p>
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          <div className="border-t border-[#1f2937] bg-[#0d121b] px-8 py-4 text-center">
            <span className="text-[10px] font-black uppercase tracking-[0.4em] text-slate-500">End of Pipeline Registry</span>
          </div>
        </div>
      </section>

    </div>
  );
}
