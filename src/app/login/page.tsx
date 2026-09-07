"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useSession } from "@/lib/session";
import { Spinner } from "@/components/ui";

/**
 * Sign in.
 *
 * The only page reachable without a session. Everything else, including the
 * landing page, is behind it.
 *
 * Two things it deliberately does not do. It does not say whether a username
 * exists, because that is half a credential; a wrong name and a wrong password
 * give the same message. And it does not offer a role picker, which is what
 * this prototype had before: the role comes from the account, not from a
 * dropdown the person chooses for themselves.
 */
export default function LoginPage() {
  const { session, ready, signIn } = useSession();
  const router = useRouter();

  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Already signed in: nothing to do here.
  useEffect(() => {
    if (ready && session) router.replace("/");
  }, [ready, session, router]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    // Hashing is deliberately slow, so this takes a beat.
    const failure = await signIn(username, password);
    setBusy(false);
    if (failure) {
      setError(failure);
      setPassword("");
      return;
    }
    router.replace("/");
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-page px-5 py-12">
      <div className="w-full max-w-sm">
        <div className="mb-7">
          <p className="text-[11px] uppercase tracking-[0.14em] text-ink-muted">
            MES Group
          </p>
          <h1 className="mt-1.5 text-2xl font-semibold tracking-tight text-ink">
            AR Automation
          </h1>
          <p className="mt-1.5 text-sm text-ink-secondary">
            Sign in to continue.
          </p>
        </div>

        <form
          onSubmit={submit}
          className="rounded-lg border border-line-hair bg-surface p-5"
        >
          <label className="block">
            <span className="mb-1.5 block text-xs font-medium text-ink-secondary">
              Email
            </span>
            <input
              name="username"
              type="email"
              autoComplete="username"
              autoFocus
              required
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              className="w-full rounded border border-line-hair bg-page px-3 py-2 text-sm text-ink"
            />
          </label>

          <label className="mt-3.5 block">
            <span className="mb-1.5 block text-xs font-medium text-ink-secondary">
              Password
            </span>
            <input
              name="password"
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full rounded border border-line-hair bg-page px-3 py-2 text-sm text-ink"
            />
          </label>

          {error ? (
            <p
              role="alert"
              className="mt-3.5 rounded border px-3 py-2 text-xs"
              style={{
                borderColor: "var(--status-critical)",
                color: "var(--status-critical)",
              }}
            >
              {error}
            </p>
          ) : null}

          <button
            type="submit"
            disabled={busy}
            className="mt-4 flex w-full items-center justify-center gap-2 rounded bg-accent px-3 py-2 text-sm font-medium text-accent-ink disabled:opacity-60"
          >
            {busy ? <Spinner /> : null}
            {busy ? "Checking" : "Sign in"}
          </button>
        </form>

        <p className="mt-4 text-[11px] leading-relaxed text-ink-muted">
          This prototype signs you in inside the browser. In production the
          same rules are enforced by the database as well, which is what
          actually stops anyone reading records they are not entitled to.
        </p>
      </div>
    </main>
  );
}
