'use client';

import Image from 'next/image';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';

const menuItems = [
  {
    group: 'Core Operations',
    items: [
      { name: 'Leads Analysis', href: '/dashboard/leads', icon: 'M9 17v-2m3 2v-4m3 4v-6m2 10H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z' },
      { name: 'Pipeline', href: '/dashboard/pipeline', icon: 'M13 5l7 7-7 7M5 5l7 7-7 7' },
      { name: 'Failed Assets', href: '/dashboard/failed-vechiles', icon: 'M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z' },
    ]
  },
  {
    group: 'External Tools',
    items: [
      { name: 'Khanan Soft', href: '/dashboard/khanansoft', icon: 'M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10' },
    ]
  }
];

export default function Sidebar() {
  const pathname = usePathname();
  const router = useRouter();
  const [isLoggedIn, setIsLoggedIn] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    setIsLoggedIn(Boolean(localStorage.getItem('spybot_token')));
  }, [pathname]);

  const handleSignOut = () => {
    if (typeof window !== 'undefined') {
      localStorage.removeItem('spybot_token');
    }
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
