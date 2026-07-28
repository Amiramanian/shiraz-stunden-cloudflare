import React, { useCallback, useEffect, useState } from 'react';
import { Loader2, LockKeyhole, ShieldCheck } from 'lucide-react';

export default function AuthGate({ children }) {
  const [checking, setChecking] = useState(true);
  const [authenticated, setAuthenticated] = useState(false);
  const [configured, setConfigured] = useState(true);
  const [pin, setPin] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  const checkSession = useCallback(async () => {
    setChecking(true);
    try {
      const response = await fetch('/api/auth/status', {
        headers: { Accept: 'application/json' }
      });
      const result = await response.json().catch(() => ({}));
      setAuthenticated(Boolean(result.authenticated));
      setConfigured(result.configured !== false);
      setError('');
    } catch {
      setAuthenticated(false);
      setError('Verbindung konnte nicht geprüft werden.');
    } finally {
      setChecking(false);
    }
  }, []);

  useEffect(() => {
    checkSession();

    function handleUnauthorized() {
      setAuthenticated(false);
      setPin('');
      setError('Die Sitzung ist abgelaufen. Bitte erneut anmelden.');
    }

    window.addEventListener('shiraz:unauthorized', handleUnauthorized);
    return () => window.removeEventListener('shiraz:unauthorized', handleUnauthorized);
  }, [checkSession]);

  async function handleSubmit(event) {
    event.preventDefault();
    if (!/^\d{4}$/.test(pin)) {
      setError('Bitte die vierstellige PIN eingeben.');
      return;
    }

    setSubmitting(true);
    setError('');

    try {
      const response = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pin })
      });
      const result = await response.json().catch(() => ({}));

      if (!response.ok) {
        throw new Error(
          response.status === 429
            ? 'Zu viele Versuche. Bitte eine Minute warten.'
            : result.error || 'PIN ist nicht korrekt.'
        );
      }

      setAuthenticated(true);
      setPin('');
    } catch (submitError) {
      setPin('');
      setError(submitError instanceof Error ? submitError.message : 'Anmeldung fehlgeschlagen.');
    } finally {
      setSubmitting(false);
    }
  }

  if (checking) {
    return (
      <main className="min-h-screen bg-neutral-100 flex items-center justify-center p-6">
        <Loader2 className="h-9 w-9 animate-spin text-emerald-800" aria-label="Zugang wird geprüft" />
      </main>
    );
  }

  if (authenticated) return children;

  return (
    <main className="min-h-screen bg-neutral-100 flex items-center justify-center p-4">
      <section className="w-full max-w-sm rounded-3xl bg-white p-7 shadow-xl border border-neutral-200">
        <div className="mx-auto mb-5 flex h-16 w-16 items-center justify-center rounded-2xl bg-emerald-100 text-emerald-800">
          <LockKeyhole size={32} aria-hidden="true" />
        </div>

        <h1 className="text-center text-2xl font-bold text-neutral-900">
          Shiraz Stunden
        </h1>
        <p className="mt-2 text-center text-sm text-neutral-500">
          Bitte PIN eingeben, um fortzufahren.
        </p>

        {!configured ? (
          <div className="mt-6 rounded-2xl bg-red-50 p-4 text-sm text-red-800">
            Der Zugang ist serverseitig noch nicht eingerichtet.
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="mt-7 space-y-4">
            <label className="block">
              <span className="sr-only">PIN</span>
              <input
                type="password"
                inputMode="numeric"
                pattern="[0-9]*"
                autoComplete="current-password"
                maxLength={4}
                value={pin}
                onChange={(event) => setPin(event.target.value.replace(/\D/g, '').slice(0, 4))}
                placeholder="••••"
                autoFocus
                className="h-14 w-full rounded-2xl border border-neutral-300 bg-white px-4 text-center text-2xl tracking-[0.55em] text-neutral-900 outline-none transition focus:border-emerald-700 focus:ring-4 focus:ring-emerald-100"
              />
            </label>

            {error && (
              <p role="alert" className="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-800">
                {error}
              </p>
            )}

            <button
              type="submit"
              disabled={submitting || pin.length !== 4}
              className="flex w-full items-center justify-center gap-2 rounded-2xl bg-emerald-800 px-5 py-3.5 font-semibold text-white transition hover:bg-emerald-900 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {submitting ? (
                <Loader2 size={20} className="animate-spin" aria-hidden="true" />
              ) : (
                <ShieldCheck size={20} aria-hidden="true" />
              )}
              Anmelden
            </button>
          </form>
        )}

        <p className="mt-6 text-center text-xs text-neutral-400">
          Geschützter Personalbereich
        </p>
      </section>
    </main>
  );
}
