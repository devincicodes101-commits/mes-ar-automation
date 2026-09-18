"use client";

/**
 * The mailbox panel on Settings.
 *
 * Until this existed the only way to know whether the system could send was to
 * call an API by hand. A system that silently sends nothing looks exactly like
 * a system that is working, so "why did nobody get the reminder on the 7th"
 * has to be answerable by looking at a screen.
 *
 * It shows three things that are easy to confuse and mean different things:
 *
 *   whether a mailbox is connected at all
 *   whether Google still accepts it
 *   whether sending is switched on
 *
 * All three must be true for a letter to leave, and each fails differently.
 */

import { useCallback, useEffect, useState } from "react";

import { useSession, useToast } from "@/lib/session";
import { Card, CardHeader, Spinner, StatusBadge, Tag } from "@/components/ui";

interface Account {
  userId: string;
  email: string;
  displayName: string | null;
  isDefault: boolean;
  connectedAt: string;
  lastUsedAt: string | null;
  lastError: string | null;
  isMine: boolean;
}

interface Status {
  mode: "off" | "allowed" | "everyone";
  ready: boolean;
  via: "connected" | "shared" | null;
  from: string | null;
  allowlist: string[];
  googleReady: boolean;
  explanation: string;
  problem: string | null;
}

const MODE_LABEL: Record<Status["mode"], { label: string; kind: "good" | "warning" | "critical" }> = {
  off: { label: "Nothing is sent", kind: "good" },
  allowed: { label: "Test addresses only", kind: "warning" },
  everyone: { label: "Sending to real tenants", kind: "critical" },
};

const when = (iso: string) =>
  new Date(iso).toLocaleDateString("en-SG", { day: "2-digit", month: "short", year: "numeric" });

async function authHeader(): Promise<Record<string, string>> {
  try {
    const { supabase } = await import("@/lib/supabase");
    const token = (await supabase?.auth.getSession())?.data.session?.access_token;
    return token ? { Authorization: `Bearer ${token}` } : {};
  } catch {
    return {};
  }
}

/**
 * Reading the mailbox, and starting a connection.
 *
 * Shared by the full panel on Settings and by the strip that sits on the
 * screens where somebody first notices nothing has gone out. Two copies would
 * drift, and the thing they would drift on is the message explaining why
 * nothing can be sent, which is the only part anybody reads.
 */
function useMailbox() {
  const { notify } = useToast();
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [status, setStatus] = useState<Status | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const r = await fetch("/api/mail/accounts", { headers: await authHeader() });
      const body = (await r.json()) as {
        ok?: boolean; accounts?: Account[]; accountsProblem?: string | null;
        status?: Status; error?: string;
      };
      if (!r.ok || !body.ok) {
        setProblem(body.error ?? "The mailbox settings could not be read.");
      } else {
        setAccounts(body.accounts ?? []);
        setStatus(body.status ?? null);
        setProblem(body.accountsProblem ?? null);
      }
    } catch {
      setProblem("The mailbox settings could not be read. The server may be unreachable.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  /*
   * The callback sends people back here with the outcome in the query string,
   * because a redirect cannot carry a message any other way. Read once, then
   * cleared, so a refresh does not repeat a week old success.
   */
  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    const outcome = q.get("mail");
    if (!outcome) return;

    if (outcome === "connected") {
      notify(
        `Connected ${q.get("as") ?? "the account"}`,
        q.get("scheduled") === "1"
          ? "Letters the schedule sends will come from this account."
          : "Letters you send by hand will come from this account.",
      );
    } else if (outcome === "cancelled") {
      notify("Not connected", q.get("detail") ?? "The connection was not approved.");
    } else {
      notify("Could not connect", q.get("detail") ?? "Google refused the connection.");
    }

    window.history.replaceState({}, "", window.location.pathname);
  }, [notify]);

  const connect = useCallback(async () => {
    setBusy("connect");
    try {
      const r = await fetch("/api/mail/connect", { headers: await authHeader() });
      const body = (await r.json()) as { ok?: boolean; url?: string; error?: string };
      if (!body.ok || !body.url) {
        notify("Cannot connect", body.error ?? "Google sign in is not set up.");
        return;
      }
      window.location.href = body.url;
    } finally {
      setBusy(null);
    }
  }, [notify]);

  return { accounts, status, problem, loading, busy, setBusy, load, connect };
}

/**
 * One line, for the screens where somebody notices nothing has gone out.
 *
 * Sent Mail and Reminder Emails are where the question "why has nothing been
 * sent" actually occurs to somebody. Making them walk to Settings to find the
 * answer is how a system ends up with people assuming it is broken.
 */
export function MailboxStrip() {
  const { accounts, status, loading, busy, connect } = useMailbox();

  if (loading || !status) return null;

  const mine = accounts.find((a) => a.isMine);
  const connected = accounts.length > 0;

  // Nothing to say when it is working and sending is on. A banner that is
  // always there is a banner nobody reads.
  if (connected && status.ready && !mine?.lastError) return null;

  const tone = !connected || mine?.lastError ? "amber" : "slate";

  return (
    <div
      className={`flex flex-wrap items-center justify-between gap-3 rounded border px-4 py-3 ${
        tone === "amber"
          ? "border-amber-200 bg-amber-50 text-amber-900"
          : "border-line-hair bg-surface-alt text-ink-secondary"
      }`}
    >
      <div className="min-w-0">
        <p className="text-sm font-medium">
          {!connected
            ? "No mailbox is connected, so nothing can be sent."
            : mine?.lastError
              ? "Your mailbox needs reconnecting."
              : status.explanation}
        </p>
        <p className="mt-0.5 text-xs opacity-80">
          {mine?.lastError
            ? mine.lastError
            : connected
              ? `Letters would go out from ${status.from ?? "the connected account"}.`
              : "Connect your Google account and letters will go out as you, with replies coming back to you."}
        </p>
      </div>

      <div className="flex shrink-0 items-center gap-2">
        {/*
          Shown whether or not Google is set up yet. Hiding it made the feature
          look like it did not exist, when in fact it was one missing setting
          away. Pressing it while unconfigured says exactly what is missing,
          which is what somebody in that position needs to hear.
        */}
        {/*
          One thing to press, and it does the thing. Signing in happens right
          here rather than by sending somebody to another screen to find the
          same button: this is where the question occurred to them.

          Settings is a quiet link beside it, not a second button. Two buttons
          that look alike leave somebody guessing which one is the action, and
          the one they pressed last time only navigated.
        */}
        <button
          type="button"
          disabled={busy === "connect"}
          onClick={() => void connect()}
          className="inline-flex items-center gap-2 rounded bg-white px-4 py-2.5 text-sm font-semibold text-slate-800 shadow-sm ring-1 ring-slate-300 hover:ring-slate-400 disabled:opacity-40"
        >
          {busy === "connect" ? <Spinner /> : <GoogleMark />}
          {mine ? "Reconnect Google" : "Sign in with Google"}
        </button>
        <a
          href="/settings"
          className="whitespace-nowrap text-xs underline underline-offset-2 opacity-80 hover:opacity-100"
        >
          More options
        </a>
      </div>
    </div>
  );
}

export function MailAccounts() {
  const { role } = useSession();
  const { notify } = useToast();
  const { accounts, status, problem, loading, busy, setBusy, load, connect } = useMailbox();
  const [testTo, setTestTo] = useState("");

  const admin = role === "admin" || role === "super-admin";

  const remove = async (userId: string, email: string) => {
    setBusy(userId);
    try {
      const r = await fetch(`/api/mail/accounts?user=${encodeURIComponent(userId)}`, {
        method: "DELETE",
        headers: await authHeader(),
      });
      const body = (await r.json()) as { ok?: boolean; error?: string };
      notify(body.ok ? "Disconnected" : "Could not disconnect",
             body.ok ? `${email} can no longer send.` : body.error ?? "");
      await load();
    } finally {
      setBusy(null);
    }
  };

  const nominate = async (userId: string, email: string) => {
    setBusy(userId);
    try {
      const r = await fetch("/api/mail/accounts", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(await authHeader()) },
        body: JSON.stringify({ user: userId }),
      });
      const body = (await r.json()) as { ok?: boolean; error?: string };
      notify(body.ok ? "The schedule will send from this account" : "Could not change it",
             body.ok ? `The 7th and the 21st will come from ${email}.` : body.error ?? "");
      await load();
    } finally {
      setBusy(null);
    }
  };

  const sendTest = async () => {
    if (!testTo.trim()) return;
    setBusy("test");
    try {
      const r = await fetch("/api/send", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(await authHeader()) },
        body: JSON.stringify({ test: { to: testTo.trim() } }),
      });
      const body = (await r.json()) as {
        ok?: boolean; sent?: boolean; reason?: string; from?: string; blocked?: boolean;
      };
      if (body.sent) {
        notify("Test sent", `It went to ${testTo.trim()} from ${body.from ?? "the mailbox"}.`);
      } else {
        notify(body.blocked ? "Nothing was sent" : "The send failed",
               body.reason ?? "No reason given.");
      }
      await load();
    } finally {
      setBusy(null);
    }
  };

  if (loading) {
    return (
      <Card className="p-8">
        <Spinner /> <span className="ml-2 text-sm text-ink-secondary">Reading the mailbox settings</span>
      </Card>
    );
  }

  const mode = status ? MODE_LABEL[status.mode] : null;

  return (
    <Card>
      <CardHeader
        title="Which mailbox letters come from"
        hint="Each person connects their own Google account. Replies come back to them."
        right={mode ? <StatusBadge kind={mode.kind} label={mode.label} /> : null}
      />

      {/* Said plainly, at the top, because it is the answer to "why did
          nobody get the reminder" and it should not need hunting for. */}
      {status ? (
        <div className="border-b border-line-hair px-5 py-3">
          <p className="text-sm text-ink">{status.explanation}</p>
          {status.from ? (
            <p className="mt-1 text-xs text-ink-muted">
              Letters would go out from <b>{status.from}</b>
              {status.via === "shared" ? " (the shared mailbox, not a connected account)" : ""}.
            </p>
          ) : null}
        </div>
      ) : null}

      {problem ? (
        <div className="border-b border-line-hair bg-amber-50 px-5 py-3 text-sm text-amber-900">
          {problem}
        </div>
      ) : null}

      {!status?.googleReady ? (
        <div className="border-b border-line-hair bg-amber-50 px-5 py-3 text-sm text-amber-900">
          Google sign in is not set up yet, so nobody can connect an account.
          An OAuth client has to be created in Google Cloud and its id and secret
          put in the environment.
        </div>
      ) : null}

      <ul className="divide-y divide-line-grid">
        {accounts.map((a) => (
          <li key={a.userId} className="flex flex-wrap items-start gap-4 px-5 py-3.5">
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-medium text-ink">{a.email}</span>
                {a.isDefault ? <Tag>the schedule sends from this</Tag> : null}
                {a.isMine ? <Tag>you</Tag> : null}
              </div>
              <p className="mt-1 text-xs text-ink-muted">
                {a.displayName ? `${a.displayName} · ` : ""}
                connected {when(a.connectedAt)}
                {a.lastUsedAt ? ` · last sent ${when(a.lastUsedAt)}` : " · not used yet"}
              </p>
              {/* A revoked connection is the failure that would otherwise be
                  discovered as a quiet morning where the 7th sent nothing. */}
              {a.lastError ? (
                <p className="mt-1 text-xs text-red-700">{a.lastError}</p>
              ) : null}
            </div>

            <div className="flex shrink-0 gap-2 self-start">
              {admin && !a.isDefault ? (
                <button
                  type="button"
                  disabled={busy === a.userId}
                  onClick={() => void nominate(a.userId, a.email)}
                  className="rounded border border-line-hair px-3 py-1.5 text-xs text-ink hover:border-line-strong disabled:opacity-40"
                >
                  Use for the schedule
                </button>
              ) : null}
              {a.isMine || admin ? (
                <button
                  type="button"
                  disabled={busy === a.userId}
                  onClick={() => void remove(a.userId, a.email)}
                  className="rounded border border-line-hair px-3 py-1.5 text-xs text-ink hover:border-red-300 disabled:opacity-40"
                >
                  Disconnect
                </button>
              ) : null}
            </div>
          </li>
        ))}

        {accounts.length === 0 ? (
          <li className="px-5 py-8 text-center">
            <p className="text-sm text-ink">No Google account is connected.</p>
            <p className="mx-auto mt-1 max-w-md text-xs text-ink-muted">
              Until one is, the schedule has no mailbox to send the 7th and the
              21st from.
            </p>
          </li>
        ) : null}
      </ul>

      <div className="flex flex-wrap items-center gap-3 border-t border-line-hair px-5 py-4">
        <button
          type="button"
          disabled={busy === "connect"}
          onClick={() => void connect()}
          className="inline-flex items-center gap-2 rounded border border-line-hair bg-surface px-3 py-2 text-sm font-medium text-ink hover:border-line-strong disabled:cursor-not-allowed disabled:opacity-40"
        >
          {busy === "connect" ? <Spinner /> : <GoogleMark />}
          {accounts.some((a) => a.isMine) ? "Reconnect my Google account" : "Sign in with Google"}
        </button>

        <div className="flex flex-1 flex-wrap items-center gap-2">
          <input
            type="email"
            value={testTo}
            onChange={(e) => setTestTo(e.target.value)}
            placeholder="your@address.com"
            className="min-w-0 flex-1 rounded border border-line-hair px-3 py-2 text-sm"
            aria-label="Address to send a test letter to"
          />
          <button
            type="button"
            disabled={busy === "test" || !testTo.trim()}
            onClick={() => void sendTest()}
            className="rounded border border-line-hair px-3 py-2 text-sm text-ink hover:border-line-strong disabled:opacity-40"
          >
            {busy === "test" ? <Spinner /> : "Send me a test"}
          </button>
        </div>
      </div>

      {/* The test letter says in its own text that it is not a bill, so that
          if it ever reaches somebody by mistake it is obviously not a demand
          for money. Worth saying here too. */}
      <p className="border-t border-line-hair px-5 py-3 text-xs text-ink-muted">
        The test letter is not a reminder and says so in its own wording. It goes
        out through exactly the path a real letter would, including every check
        that can stop one.
      </p>
    </Card>
  );
}

/** Google's four colours, drawn rather than fetched so nothing loads a logo. */
function GoogleMark() {
  return (
    <svg width="14" height="14" viewBox="0 0 48 48" aria-hidden="true">
      <path fill="#4285F4" d="M45 24c0-1.6-.1-2.7-.4-4H24v7.5h12c-.2 2-1.6 5-4.5 7l7 5.4C42.6 36.2 45 30.6 45 24z" />
      <path fill="#34A853" d="M24 46c6 0 11-2 14.6-5.4l-7-5.4c-1.9 1.3-4.4 2.2-7.6 2.2-5.8 0-10.8-3.9-12.5-9.2l-7.2 5.6C7.9 41 15.4 46 24 46z" />
      <path fill="#FBBC05" d="M11.5 28.2c-.5-1.3-.7-2.7-.7-4.2s.3-2.9.7-4.2l-7.2-5.6C2.8 17.1 2 20.4 2 24s.8 6.9 2.3 9.8l7.2-5.6z" />
      <path fill="#EA4335" d="M24 10.4c3.3 0 6.2 1.1 8.5 3.3l6.3-6.3C35 3.9 30 2 24 2 15.4 2 7.9 7 4.3 14.2l7.2 5.6c1.7-5.3 6.7-9.4 12.5-9.4z" />
    </svg>
  );
}
