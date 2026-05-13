'use client';

import Image from 'next/image';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { apiUrl, clearSpybotToken, getAuthHeaders, getSpybotToken } from '@/lib/api-client';

const menuItems = [
  {
    group: 'Core Operations',
    items: [
      { name: 'Leads Analysis', href: '/dashboard/leads', icon: 'M9 17v-2m3 2v-4m3 4v-6m2 10H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z' },
      { name: 'Pipeline', href: '/dashboard/pipeline', icon: 'M13 5l7 7-7 7M5 5l7 7-7 7' },
      { name: 'Failed Assets', href: '/dashboard/failed-vehicles', icon: 'M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z' },
    ]
  },
  {
    group: 'External Tools',
    items: [
      { name: 'Khanan Soft', href: '/dashboard/khanansoft', icon: 'M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10' },
    ]
  },
  {
    group: 'Analytics',
    items: [
      {
        name: 'Districts',
        href: '/districts',
        icon:
          'M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z M15 11a3 3 0 11-6 0 3 3 0 016 0z',
      },
      {
        name: 'Raw Khanan',
        href: '/raw-khanan',
        icon:
          'M4 7v10c0 2.21 3.582 4 8 4s8-1.79 8-4V7M4 7c0 2.21 3.582 4 8 4s8-1.79 8-4M4 7c0-2.21 3.582-4 8-4s8 1.79 8 4m0 5c0 2.21-3.582 4-8 4s-8-1.79-8-4',
      },
      {
        name: 'Raw Vehicle',
        href: '/raw-vehicle',
        icon:
          'M8 7h8m-8 4h5m-5 4h8M5 21h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v14a2 2 0 002 2z',
      },
      {
        name: 'Raw Challan',
        href: '/raw-challan',
        icon:
          'M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2',
      },
      {
        name: 'Ingest jobs',
        href: '/ingest-jobs',
        icon:
          'M4 6h16M4 10h16M4 14h16M4 18h7',
      },
      {
        name: 'Ops snapshot',
        href: '/ops-snapshot',
        icon:
          'M4 5a1 1 0 011-1h14a1 1 0 011 1v2a1 1 0 01-1 1H5a1 1 0 01-1-1V5zM4 13a1 1 0 011-1h6a1 1 0 011 1v6a1 1 0 01-1 1H5a1 1 0 01-1-1v-6zM16 13a1 1 0 011-1h2a1 1 0 011 1v6a1 1 0 01-1 1h-2a1 1 0 01-1-1v-6z',
      },
      {
        name: 'Audit logs',
        href: '/audit-logs',
        icon:
          'M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z',
      },
      {
        name: 'Failed jobs',
        href: '/failed-jobs',
        icon:
          'M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z',
      },
    ],
  },
  {
    group: 'Ingest',
    items: [
      {
        name: 'Vehicle Intelligence',
        href: '/vehicle-intelligence',
        icon: 'M13 10V3L4 14h7v7l9-11h-7z',
      },
      {
        name: 'Compliance',
        href: '/compliance',
        icon: 'M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z',
      },
      {
        name: 'Trips',
        href: '/trips',
        icon: 'M9 20l-5.447-2.724A1 1 0 013 16.382V5.618a1 1 0 011.447-.894L9 7m0 13l6-3m-6 3V7m6 10l4.553 2.276A1 1 0 0021 18.382V7.618a1 1 0 00-.553-.894L15 4m0 13V4m0 0L9 7',
      },
      {
        name: 'Consigners',
        href: '/consigners',
        icon: 'M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z',
      },
      {
        name: 'Permits',
        href: '/permits',
        icon: 'M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z',
      },
      {
        name: 'Insurance',
        href: '/insurance',
        icon: 'M9 12l2 2 4-4M7.835 4.697a3.42 3.42 0 001.946-.806 3.42 3.42 0 014.438 0 3.42 3.42 0 001.946.806 3.42 3.42 0 013.138 3.138 3.42 3.42 0 00.806 1.946 3.42 3.42 0 010 4.438 3.42 3.42 0 00-.806 1.946 3.42 3.42 0 01-3.138 3.138 3.42 3.42 0 00-1.946.806 3.42 3.42 0 01-4.438 0 3.42 3.42 0 00-1.946-.806 3.42 3.42 0 01-3.138-3.138 3.42 3.42 0 00-.806-1.946 3.42 3.42 0 010-4.438 3.42 3.42 0 00.806-1.946 3.42 3.42 0 013.138-3.138z',
      },
      {
        name: 'Selector health',
        href: '/selector-health',
        icon: 'M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z',
      },
      {
        name: 'Scrape console',
        href: '/scrape-console',
        icon: 'M4 6h16M4 12h10M4 18h16',
      },
    ],
  },
];

export default function Sidebar() {
  const pathname = usePathname();
  const router = useRouter();
  const [isLoggedIn, setIsLoggedIn] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    setIsLoggedIn(Boolean(getSpybotToken()));
  }, [pathname]);

  const handleSignOut = async () => {
    const token = getSpybotToken();
    try {
      await fetch(apiUrl('/api/auth/logout'), {
        method: 'POST',
        headers: getAuthHeaders(token, { acceptJson: true }),
        credentials: 'include',
      });
    } catch {
      // ignore logout transport failures and still clear local markers
    }
    if (typeof window !== 'undefined') clearSpybotToken();
    setIsLoggedIn(false);
    router.push('/login');
  };

  return (
    <aside className="w-68 bg-[#0b0f16] border-r border-[#1f2937] flex flex-col h-screen shrink-0 sticky top-0 z-20">
      {/* Logo */}
      <div className="h-16 flex items-center px-5 border-b border-[#1f2937]">
        <div className="flex items-center space-x-3">
          <Image
            src="/Round PNG Logo.png"
            alt="Spybot Verifacts"
            width={40}
            height={40}
            className="rounded-xl shadow-[0_0_16px_rgba(99,102,241,0.4)] shrink-0"
            style={{ width: 'auto', height: 'auto' }}
            priority
          />
          <span className="bg-gradient-to-r from-white to-indigo-300 bg-clip-text text-transparent font-black text-xl tracking-tighter">SPYBOT</span>
        </div>
      </div>
      
      <nav className="flex-1 overflow-y-auto py-8 px-3 space-y-6">
        {menuItems.map((group) => (
          <div key={group.group}>
            <div className="text-[10px] font-black text-slate-600 uppercase tracking-[0.2em] mb-3 px-3">
              {group.group}
            </div>
            <div className="space-y-0.5">
              {group.items.map((item) => {
                const isActive = pathname === item.href;
                return (
                  <Link 
                    key={item.href} 
                    href={item.href} 
                    className={`group relative flex items-center space-x-3 rounded-lg py-2.5 text-sm font-bold transition-all ${
                      isActive 
                        ? 'bg-blue-600/10 text-white pl-3 pr-3'
                        : 'text-slate-400 hover:text-white hover:bg-[#1a2030] pl-3 pr-3'
                    }`}
                  >
                    {/* Active left bar */}
                    {isActive && (
                      <span className="absolute left-0 top-1 bottom-1 w-0.5 rounded-r-full bg-blue-500 shadow-[0_0_8px_rgba(59,130,246,0.8)]" />
                    )}
                    <svg className={`w-4.5 h-4.5 shrink-0 transition-colors ${isActive ? 'text-blue-400' : 'text-slate-500 group-hover:text-blue-400'}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={isActive ? 2.5 : 2} d={item.icon} />
                    </svg>
                    <span>{item.name}</span>
                    {isActive && (
                      <span className="ml-auto h-1.5 w-1.5 rounded-full bg-blue-500" />
                    )}
                  </Link>
                );
              })}
            </div>
          </div>
        ))}
      </nav>

      <div className="p-4 border-t border-[#1f2937]">
        {isLoggedIn ? (
          <button
            type="button"
            onClick={handleSignOut}
            className="flex w-full items-center justify-center gap-2 rounded-lg border border-[#1f2937] bg-[#05070a] px-3 py-2.5 text-[10px] font-black uppercase tracking-widest text-slate-500 transition hover:border-red-500/40 hover:bg-red-500/5 hover:text-red-400"
          >
            <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
            </svg>
            Logout
          </button>
        ) : (
          <Link
            href="/login"
            className="flex w-full items-center justify-center gap-2 rounded-lg border border-[#1f2937] bg-[#05070a] px-3 py-2.5 text-[10px] font-black uppercase tracking-widest text-slate-500 transition hover:border-blue-500/40 hover:bg-blue-500/5 hover:text-blue-400"
          >
            Sign in
          </Link>
        )}
      </div>
    </aside>
  );
}
