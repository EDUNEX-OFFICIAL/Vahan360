'use client';

import Image from 'next/image';
import { useState } from 'react';
import { useRouter } from 'next/navigation';

const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL ?? '';

function loginErrorMessage(data: Record<string, unknown>, status: number): string {
  const msg =
    (typeof data.message === 'string' && data.message) ||
    (typeof data.error === 'string' && data.error) ||
    '';
  if (status === 401) {
    return (
      'Invalid username or password. If the database is new: on the server run from repo root ' +
      '(e.g. /opt/vahan360): docker compose run --rm backend npm run sync:user — or ./scripts/seed-admin-docker.sh. ' +
      'Local monorepo: pnpm --filter spybot-backend run sync:user. Then try admin / admin123.'
    );
  }
  if (status >= 500) return msg || 'Sign in is temporarily unavailable. Please try again.';
  return msg || 'Unable to sign in right now. Please try again.';
}

export default function LoginPage() {
  const router = useRouter();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showPassword, setShowPassword] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const u = username.trim();
    if (!u || !password) {
      setError('Username and password are required.');
      return;
    }

    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch(`${API_BASE_URL}/api/auth/generate-token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: u, password }),
      });

      const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;

      if (!res.ok) {
        setError(loginErrorMessage(data, res.status));
        return;
      }

      if (!data.token || data.type !== 'Bearer') {
        setError('We could not sign you in. Please check your details and try again.');
        return;
      }

      localStorage.setItem('spybot_token', String(data.token));
      router.replace('/dashboard/leads');
    } catch {
      setError(
        'Cannot reach the API. Ensure nginx proxies /api to the backend, or set NEXT_PUBLIC_API_BASE_URL to your API origin.'
      );
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="relative min-h-screen w-full flex items-center justify-center overflow-hidden bg-[#05070a] px-4">

      {/* Ambient background blobs */}
      {/* Indigo — top-left */}
      <div
        className="animate-blob-a pointer-events-none fixed top-0 left-0 h-[480px] w-[480px] rounded-full bg-indigo-500/20 blur-[85px]"
        aria-hidden
      />
      {/* Teal — bottom-right */}
      <div
        className="animate-blob-b pointer-events-none fixed bottom-0 right-0 h-[460px] w-[460px] rounded-full bg-teal-500/[0.16] blur-[85px]"
        style={{ animationDelay: '5s' }}
        aria-hidden
      />
      {/* Rose — top-right */}
      <div
        className="animate-blob-c pointer-events-none fixed top-0 right-0 h-[380px] w-[380px] rounded-full bg-rose-500/[0.10] blur-[80px]"
        style={{ animationDelay: '2s' }}
        aria-hidden
      />

      {/* Login Card */}
      <div className="animate-fade-up relative z-10 w-full max-w-sm rounded-3xl border border-[#1f2937] bg-[#0b0f16] p-8 shadow-[0_0_60px_rgba(99,102,241,0.1)]">

        {/* Subtle inner radial glow */}
        <div
          className="pointer-events-none absolute inset-0 rounded-3xl bg-[radial-gradient(ellipse_at_top,rgba(99,102,241,0.07)_0%,transparent_60%)]"
          aria-hidden
        />

        {/* Brand / Logo */}
        <div className="relative mb-8 flex flex-col items-center text-center">
          <div className="mb-5 relative">
            <Image
              src="/Round PNG Logo.png"
              alt="Spybot Verifacts"
              width={96}
              height={96}
              className="h-auto w-auto max-w-[96px] drop-shadow-[0_0_24px_rgba(99,102,241,0.55)]"
              style={{ width: 'auto', height: 'auto' }}
              priority
            />
          </div>
          <h1 className="bg-gradient-to-r from-white via-indigo-100 to-indigo-400 bg-clip-text text-transparent text-2xl font-extrabold tracking-tight">
            SPYBOT VERIFACTS
          </h1>
          <p className="mt-1.5 text-sm text-slate-500">Sign in to access your dashboard</p>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="relative space-y-4">
          {/* Username */}
          <div className="space-y-1.5">
            <label htmlFor="username" className="block text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-500">
              Username
            </label>
            <input
              id="username"
              name="username"
              autoComplete="username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="Enter username"
              className="w-full rounded-xl border border-[#1f2937] bg-[#05070a] px-4 py-3 text-sm text-slate-200 outline-none transition placeholder:text-slate-700 focus:border-indigo-500/60 focus:ring-1 focus:ring-indigo-500/20"
            />
          </div>

          {/* Password */}
          <div className="space-y-1.5">
            <label htmlFor="password" className="block text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-500">
              Password
            </label>
            <div className="relative">
              <input
                id="password"
                name="password"
                type={showPassword ? 'text' : 'password'}
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Enter password"
                className="w-full rounded-xl border border-[#1f2937] bg-[#05070a] px-4 py-3 pr-11 text-sm text-slate-200 outline-none transition placeholder:text-slate-700 focus:border-indigo-500/60 focus:ring-1 focus:ring-indigo-500/20"
              />
              <button
                type="button"
                onClick={() => setShowPassword((prev) => !prev)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300 transition"
                aria-label={showPassword ? 'Hide password' : 'Show password'}
              >
                {showPassword ? (
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21" />
                  </svg>
                ) : (
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                    <path strokeLinecap="round" strokeLinejoin="round" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                  </svg>
                )}
              </button>
            </div>
          </div>

          {/* Error */}
          {error && (
            <div
              className="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300"
              role="alert"
            >
              {error}
            </div>
          )}

          {/* Submit */}
          <button
            type="submit"
            disabled={submitting}
            className="mt-2 w-full rounded-xl bg-gradient-to-r from-indigo-600 to-blue-600 py-3 text-sm font-bold tracking-wide text-white shadow-lg shadow-indigo-900/30 transition hover:from-indigo-500 hover:to-blue-500 active:scale-[0.98] disabled:opacity-60"
          >
            {submitting ? (
              <span className="inline-flex items-center justify-center gap-2">
                <svg className="h-4 w-4 animate-spin" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
                Signing in...
              </span>
            ) : (
              'Sign In'
            )}
          </button>
        </form>

        {/* Footer */}
        <p className="relative mt-6 border-t border-[#1f2937] pt-4 text-center text-[11px] text-slate-600">
          Redefined Trust: Robust BoT Verified Platform
        </p>
      </div>
    </div>
  );
}
