"use client";

import { useEffect, useState, type FormEvent } from "react";
import { supabase } from "@/lib/supabase";

// Email sign-in with a magic link. Returns to the current page after sign-in.
export default function AccountBar() {
  const [user, setUser] = useState<string | null>(null);
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setUser(data.session?.user.email ?? null));
    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user.email ?? null);
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const { error: err } = await supabase.auth.signInWithOtp({
      email: email.trim(),
      options: { emailRedirectTo: window.location.href },
    });
    setBusy(false);
    if (err) setError(err.message);
    else setSent(true);
  }

  if (user) {
    return (
      <div className="flex items-center justify-between gap-3 text-sm">
        <span className="min-w-0 truncate text-stone-600">Signed in as {user}</span>
        <button
          type="button"
          onClick={() => supabase.auth.signOut()}
          className="min-h-11 shrink-0 rounded border border-stone-300 px-3 text-stone-700"
        >
          Sign out
        </button>
      </div>
    );
  }

  if (sent) {
    return (
      <p className="rounded-lg border border-stone-200 bg-white p-4 text-sm text-stone-700">
        Check {email} for a sign-in link. You can close this tab after you open it.
      </p>
    );
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-2">
      <label className="text-sm font-medium text-stone-700" htmlFor="signin-email">
        Sign in with email
      </label>
      <div className="flex gap-2">
        <input
          id="signin-email"
          type="email"
          required
          autoComplete="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="you@example.com"
          className="min-h-11 min-w-0 flex-1 rounded border border-stone-300 bg-white px-3"
        />
        <button
          type="submit"
          disabled={busy}
          className="min-h-11 shrink-0 rounded bg-stone-900 px-4 text-white disabled:opacity-50"
        >
          {busy ? "Sending…" : "Email me a link"}
        </button>
      </div>
      {error && (
        <p role="alert" className="text-sm text-red-700">
          {error}
        </p>
      )}
    </form>
  );
}
