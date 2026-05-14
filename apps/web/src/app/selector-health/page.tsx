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
import { logAndUserFacingHttpError } from '@/lib/user-facing-errors';

export default function SelectorHealthPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [jsonOut, setJsonOut] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const fetchHealth = async () => {
    const token = getSpybotToken();
    if (!token) {
      setErrorMsg(NO_SPYBOT_JWT_MESSAGE);
      setJsonOut(null);
      return;
    }

    setLoading(true);
    setErrorMsg(null);
    setJsonOut(null);

    const url = apiUrl('/api/v2/selectors/health');

    try {
      const res = await fetch(url, {
        method: 'GET',
        headers: getAuthHeaders(token, { acceptJson: true }),
      });
      const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;

      if (res.status === 401) {
        clearSpybotToken();
        router.replace('/login');
        return;
      }

      if (!res.ok) {
        let pathForLog = '/api/v2/selectors/health';
        try {
          pathForLog = new URL(url).pathname;
        } catch {
          /* ignore */
        }
        setErrorMsg(logAndUserFacingHttpError(res, data, pathForLog));
        return;
      }

      setJsonOut(JSON.stringify(data, null, 2));
    } catch {
      setErrorMsg(NEST_V2_PROXY_NETWORK_ERROR);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.2em] text-slate-500">Read-only</p>
          <h1 className="mt-1 text-xl font-bold tracking-tight text-white">Selector registry health</h1>
        </div>
        <Link href="/compliance" className="text-xs font-semibold text-indigo-400 hover:text-indigo-300">
          Compliance
        </Link>
      </div>

      <section className="rounded-xl border border-[#1f2937] bg-[#0b0f16]/80 p-5">
        <button
          type="button"
          disabled={loading}
          onClick={() => void fetchHealth()}
          className="rounded-lg bg-slate-800 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-700 disabled:opacity-50"
        >
          {loading ? 'Loading…' : 'Refresh'}
        </button>

        {errorMsg && (
          <p className="mt-3 text-sm text-amber-400/90">{errorMsg}</p>
        )}

        {jsonOut && (
          <pre className="mt-4 max-h-[360px] overflow-auto rounded-lg border border-[#1f2937] bg-[#05070a] p-3 font-mono text-xs text-slate-200">
            {jsonOut}
          </pre>
        )}
      </section>
    </div>
  );
}
