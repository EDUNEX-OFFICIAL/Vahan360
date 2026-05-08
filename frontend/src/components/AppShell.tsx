'use client';

import { useEffect, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import Sidebar from '@/components/Sidebar';

const routeLabels: Record<string, string> = {
  leads: 'Leads Analysis',
  pipeline: 'Pipeline',
  khanansoft: 'Khanan Soft',
  'failed-vechiles': 'Failed Assets',
  testing: 'Testing',
  login: 'Login',
};

function toTitleCase(value: string) {
  return value
    .split('-')
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

export default function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const isAuthRoute = pathname === '/login';
  const [isCheckingAuth, setIsCheckingAuth] = useState(true);

  useEffect(() => {
    if (typeof window === 'undefined') return;

    setIsCheckingAuth(true);
    const token = localStorage.getItem('spybot_token');

    if (isAuthRoute && token) {
      router.replace('/dashboard/leads');
      return;
    }

    if (!isAuthRoute && !token) {
      router.replace('/login');
      return;
    }

    setIsCheckingAuth(false);
  }, [isAuthRoute, router, pathname]);

  if (isCheckingAuth) {
    return <div className="min-h-screen w-full bg-[#05070a]" />;
  }

  if (isAuthRoute) {
    return <div className="min-h-screen w-full">{children}</div>;
  }

  const pathParts = pathname.split('/').filter(Boolean);
  const mainCrumb = pathParts[0] ? routeLabels[pathParts[0]] || toTitleCase(pathParts[0]) : 'Dashboard';
  const subCrumb = pathParts[1] ? routeLabels[pathParts[1]] || toTitleCase(pathParts[1]) : 'Overview';

  return (
    <>
      {/* ── Fixed blob layer — behind everything ── */}
      <div className="pointer-events-none fixed inset-0 z-0 overflow-hidden" aria-hidden>
        {/* Top-left — indigo (brand) */}
        <div className="animate-blob-a absolute left-0 top-0 h-[480px] w-[480px] rounded-full bg-indigo-500/[0.07] blur-[110px]" />
        {/* Bottom-right — teal */}
        <div className="animate-blob-b absolute bottom-0 right-0 h-[520px] w-[520px] rounded-full bg-teal-500/[0.06] blur-[120px]" style={{ animationDelay: '5s' }} />
        {/* Top-right — rose */}
        <div className="animate-blob-c absolute right-0 top-0 h-[400px] w-[400px] rounded-full bg-rose-500/[0.05] blur-[100px]" style={{ animationDelay: '2s' }} />
        {/* Bottom-left — amber */}
        <div className="animate-blob-b absolute bottom-0 left-0 h-[360px] w-[360px] rounded-full bg-amber-500/[0.04] blur-[110px]" style={{ animationDelay: '8s' }} />
      </div>

      <Sidebar />

      <div className="relative z-10 flex-1 min-w-0 flex flex-col min-h-screen">
        <header className="h-16 bg-[#0b0f16]/80 backdrop-blur-md border-b border-[#1f2937]/60 flex items-center justify-between px-8 sticky top-0 z-30" style={{ boxShadow: '0 1px 0 0 rgba(99,102,241,0.08)' }}>
          <div className="flex items-center text-sm font-medium text-slate-400">
            <span className="hover:text-white cursor-pointer transition-colors">{mainCrumb}</span>
            <span className="mx-3 text-slate-700">/</span>
            <span className="bg-gradient-to-r from-white to-indigo-300 bg-clip-text text-transparent font-bold">{subCrumb}</span>
          </div>
          <div className="flex items-center space-x-6">
            <div className="relative group">
              <input
                type="text"
                placeholder="Search records..."
                className="bg-[#05070a] border border-[#1f2937] rounded-lg px-10 py-1.5 text-xs text-white focus:outline-none focus:ring-1 focus:ring-blue-500/50 w-72 transition-all group-hover:border-slate-500"
              />
              <svg className="w-3.5 h-3.5 text-slate-500 absolute left-3.5 top-2.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
            </div>
          </div>
        </header>

        <main className="flex-1 min-w-0 overflow-y-auto overflow-x-hidden bg-[#05070a] p-8">{children}</main>
      </div>
    </>
  );
}
