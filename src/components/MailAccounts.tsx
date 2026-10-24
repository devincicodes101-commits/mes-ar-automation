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
import Link from "next/link";
import { Card, CardHeader, Skeleton, Spinner, StatusBadge, Tag } from "@/components/ui";
import { formatDate } from "@/lib/format";

type Provider = "google" | "microsoft";

/* One mailbox on the shared list (25 October): any number can be connected,
   one is active and sends every letter. */
interface Account {
  id: string;
  provider: Provider;
  email: string;
  displayName: string | null;
  isDefault: boolean;
  connectedAt: string;
  connectedBy: string | null;
  lastUsedAt: string | null;
  lastError: string | null;
}

interface Status {
  mode: "off" | "allowed" | "everyone";
  ready: boolean;
  via: "connected" | "shared" | null;
  from: string | null;
  allowlist: string[];
  googleReady: boolean;
  microsoftReady: boolean;
  explanation: string;
  problem: string | null;
}

const MODE_LABEL: Record<Status["mode"], { label: string; kind: "good" | "warning" | "critical" }> = {
  off: { label: "Nothing is sent", kind: "good" },
  allowed: { label: "Test addresses only", kind: "warning" },
  everyone: { label: "Sending to real tenants", kind: "critical" },
};

const when = (iso: string) => formatDate(iso);

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
          ? "It is the active mailbox: every letter goes out from it."
          : "It is on the list. Press Make active to send from it.",
      );
    } else if (outcome === "cancelled") {
      notify("Not connected", q.get("detail") ?? "The connection was not approved.");
    } else {
      notify("Could not connect", q.get("detail") ?? "The connection was refused.");
    }

    window.history.replaceState({}, "", window.location.pathname);
  }, [notify]);

  const connect = useCallback(async (provider: Provider = "google") => {
    setBusy("connect");
    try {
      const r = await fetch(`/api/mail/connect?provider=${provider}`, { headers: await authHeader() });
      const body = (await r.json()) as { ok?: boolean; url?: string; error?: string };
      if (!body.ok || !body.url) {
        notify(
          "Cannot connect",
          body.error ?? `${provider === "microsoft" ? "Microsoft" : "Google"} sign in is not set up.`,
        );
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

  const active = accounts.find((a) => a.isDefault) ?? null;
  const connected = accounts.length > 0;

  // Nothing to say when it is working. A banner that is always there is a
  // banner nobody reads.
  if (active && status.ready && !active.lastError) return null;

  /* Said for the person reading it, not for whoever set the system up: the
     setup detail is on Settings, for the administrator. */
  const notSetUp = !status.microsoftReady && !status.googleReady;
  const line = notSetUp
    ? "Email sending is not set up yet. Ask your system administrator."
    : !connected
      ? "No mailbox is connected, so nothing can be sent."
      : !active
        ? "No mailbox is active, so nothing can be sent. Make one active on Settings, Mailbox."
        : active.lastError
          ? `The active mailbox, ${active.email}, needs reconnecting.`
          : status.mode === "off"
            ? "Sending is switched off. Letters are written and recorded, and nothing is sent."
            : status.explanation;
  const reconnect = active?.lastError ? active.provider : null;
  const can = (p: Provider) => (p === "microsoft" ? status.microsoftReady : status.googleReady);
  const offer: Provider[] = reconnect
    ? can(reconnect)
      ? [reconnect]
      : []
    : !connected
      ? (["microsoft", "google"] as Provider[]).filter(can)
      : [];

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-warn-line bg-warn-wash px-4 py-3 text-warn-ink lg:flex-row lg:items-center lg:justify-between">
      <p className="min-w-0 text-sm font-medium">{line}</p>
      <div className="flex flex-wrap items-center gap-2">
        {offer.map((p) => (
          <button
            key={p}
            type="button"
            disabled={busy === "connect"}
            onClick={() => void connect(p)}
            className="inline-flex items-center gap-2 rounded-md border border-line-strong bg-surface px-3.5 py-2 text-sm font-medium text-ink shadow-sm hover:border-accent disabled:opacity-40"
          >
            {busy === "connect" ? <Spinner /> : p === "microsoft" ? <MicrosoftMark /> : <GoogleMark />}
            {reconnect ? "Reconnect" : p === "microsoft" ? "Connect Outlook" : "Connect Gmail"}
          </button>
        ))}
        <Link
          href="/settings"
          className="whitespace-nowrap text-xs underline underline-offset-2 opacity-80 hover:opacity-100"
        >
          Settings
        </Link>
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

  const remove = async (id: string, email: string) => {
    setBusy(id);
    try {
      const r = await fetch(`/api/mail/accounts?id=${encodeURIComponent(id)}`, {
        method: "DELETE",
        headers: await authHeader(),
      });
      const body = (await r.json()) as { ok?: boolean; error?: string };
      notify(body.ok ? `Removed ${email}` : "Not removed",
             body.ok ? "It is off the list and can no longer send." : body.error ?? "");
      await load();
    } finally {
      setBusy(null);
    }
  };

  const makeActive = async (id: string, email: string) => {
    setBusy(id);
    try {
      const r = await fetch("/api/mail/accounts", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(await authHeader()) },
        body: JSON.stringify({ id }),
      });
      const body = (await r.json()) as { ok?: boolean; error?: string };
      notify(body.ok ? `${email} is now the active mailbox` : "Not changed",
             body.ok ? "Every letter goes out from it from now on." : body.error ?? "");
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
      <Card>
        <div className="border-b border-line-hair px-4 py-4 sm:px-5">
          <Skeleton className="h-4 w-36" />
          <Skeleton className="mt-2 h-3 w-64 max-w-full" />
        </div>
        {[0, 1].map((i) => (
          <div key={i} className="flex items-center gap-4 border-b border-line-hair px-4 py-4 last:border-0 sm:px-5">
            <Skeleton className="h-4 w-4 rounded-full" />
            <Skeleton className="h-3.5 w-48" />
            <Skeleton className="ml-auto h-8 w-24 rounded-lg" />
          </div>
        ))}
      </Card>
    );
  }

  const mode = status ? MODE_LABEL[status.mode] : null;
  const ready: Provider[] = (["microsoft", "google"] as Provider[]).filter((p) =>
    p === "microsoft" ? status?.microsoftReady : status?.googleReady,
  );
  const others = accounts.length > 1;

  return (
    <Card>
      <CardHeader
        title="Mailboxes"
        hint="Every letter goes out from the active mailbox, and replies come back to it."
        right={mode ? <StatusBadge kind={mode.kind} label={mode.label} /> : null}
      />

      {/* Said plainly, at the top, because it is the answer to "why did
          nobody get the reminder" and it should not need hunting for. */}
      {status ? (
        <div className="border-b border-line-hair px-4 py-3 sm:px-5">
          <p className="text-sm text-ink">{status.explanation}</p>
          {status.from ? (
            <p className="mt-1 text-xs text-ink-muted">
              Letters go out from <b className="text-ink-secondary">{status.from}</b>
              {status.via === "shared" ? " (the shared mailbox)" : ""}.
            </p>
          ) : null}
        </div>
      ) : null}

      {problem ? (
        <div className="border-b border-line-hair bg-warn-wash px-5 py-3 text-sm text-warn-ink">
          {problem}
        </div>
      ) : null}

      {ready.length === 0 ? (
        <div className="border-b border-line-hair bg-warn-wash px-4 py-3 text-sm text-warn-ink sm:px-5">
          Mailbox sign-in has not been set up yet, so no mailbox can be connected. Please contact
          your system administrator.
        </div>
      ) : null}

      <ul className="divide-y divide-line-grid">
        {accounts.map((a) => (
          <li key={a.id} className="flex flex-col gap-3 px-4 py-3.5 sm:flex-row sm:items-center sm:px-5">
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className="flex items-center gap-1.5 break-all font-medium text-ink">
                  {a.provider === "microsoft" ? <MicrosoftMark /> : <GoogleMark />}
                  {a.email}
                </span>
                {a.isDefault ? <StatusBadge kind="good" label="Active" /> : null}
                <Tag>{a.provider === "microsoft" ? "Outlook" : "Gmail"}</Tag>
              </div>
              <p className="mt-1 text-xs text-ink-muted">
                Connected {when(a.connectedAt)}
                {a.connectedBy ? ` by ${a.connectedBy}` : ""}
                {a.lastUsedAt ? ` · last sent ${when(a.lastUsedAt)}` : " · not used yet"}
              </p>
              {/* A revoked connection is the failure that would otherwise be
                  discovered as a quiet morning where nothing was sent. */}
              {a.lastError ? (
                <p className="mt-1 text-xs text-crit-ink">{a.lastError}</p>
              ) : null}
            </div>

            {admin ? (
              <div className="flex shrink-0 flex-wrap gap-2 self-start sm:self-center">
                {!a.isDefault ? (
                  <button
                    type="button"
                    disabled={busy === a.id}
                    onClick={() => void makeActive(a.id, a.email)}
                    className="rounded-md border border-line-strong px-3 py-1.5 text-xs font-medium text-ink hover:border-accent hover:text-accent-text disabled:opacity-40"
                  >
                    Make active
                  </button>
                ) : null}
                {a.lastError && ready.includes(a.provider) ? (
                  <button
                    type="button"
                    disabled={busy === "connect"}
                    onClick={() => void connect(a.provider)}
                    className="rounded-md border border-line-strong px-3 py-1.5 text-xs font-medium text-ink hover:border-accent disabled:opacity-40"
                  >
                    Reconnect
                  </button>
                ) : null}
                <button
                  type="button"
                  disabled={busy === a.id || (a.isDefault && others)}
                  title={a.isDefault && others ? "Make another mailbox active first" : undefined}
                  onClick={() => void remove(a.id, a.email)}
                  className="rounded-md border border-line-hair px-3 py-1.5 text-xs text-ink-secondary hover:border-crit-line hover:text-crit-ink disabled:cursor-not-allowed disabled:opacity-40"
                >
                  Remove
                </button>
              </div>
            ) : null}
          </li>
        ))}

        {accounts.length === 0 ? (
          <li className="px-5 py-8 text-center">
            <p className="text-sm text-ink">No mailbox is connected.</p>
            <p className="mx-auto mt-1 max-w-md text-xs text-ink-muted">
              Until one is, nothing can be sent.
            </p>
          </li>
        ) : null}
      </ul>

      {admin && ready.length > 0 ? (
        <div className="flex flex-wrap items-center gap-2 border-t border-line-hair px-4 py-3.5 sm:px-5">
          <span className="mr-1 text-xs text-ink-muted">Add a mailbox:</span>
          {ready.map((p) => (
            <button
              key={p}
              type="button"
              disabled={busy === "connect"}
              onClick={() => void connect(p)}
              className="inline-flex items-center gap-2 rounded-md border border-line-strong bg-surface px-3 py-1.5 text-sm font-medium text-ink hover:border-accent disabled:cursor-not-allowed disabled:opacity-40"
            >
              {busy === "connect" ? <Spinner /> : p === "microsoft" ? <MicrosoftMark /> : <GoogleMark />}
              {p === "microsoft" ? "Connect Outlook" : "Connect Gmail"}
            </button>
          ))}
        </div>
      ) : null}

      <div className="flex flex-col gap-2 border-t border-line-hair px-4 py-3.5 sm:flex-row sm:items-center sm:px-5">
        <span className="text-xs text-ink-muted sm:w-40">Send a test letter</span>
        <div className="flex flex-1 items-center gap-2">
          <input
            type="email"
            value={testTo}
            onChange={(e) => setTestTo(e.target.value)}
            placeholder="your@address.com"
            className="min-w-0 flex-1 rounded-md border bg-surface px-3 py-1.5 text-sm text-ink placeholder:text-ink-muted"
            aria-label="Address to send a test letter to"
          />
          <button
            type="button"
            disabled={busy === "test" || !testTo.trim()}
            onClick={() => void sendTest()}
            className="shrink-0 rounded-md border border-line-strong px-3 py-1.5 text-sm text-ink hover:border-accent hover:text-accent-text disabled:opacity-40"
          >
            {busy === "test" ? <Spinner /> : "Send me a test"}
          </button>
        </div>
      </div>

      {admin && status ? <TestAddresses mode={status.mode} onChanged={load} /> : null}
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

/** Microsoft's four squares, drawn rather than fetched. */
function MicrosoftMark() {
  return (
    <svg width="14" height="14" viewBox="0 0 23 23" aria-hidden="true">
      <path fill="#F25022" d="M1 1h10v10H1z" />
      <path fill="#7FBA00" d="M12 1h10v10H12z" />
      <path fill="#00A4EF" d="M1 12h10v10H1z" />
      <path fill="#FFB900" d="M12 12h10v10H12z" />
    </svg>
  );
}

/**
 * The test list (25 October). While sending is set to test addresses only,
 * these are the only addresses a letter can reach, whatever the contact list
 * says, so a real tenant's address that slips into a test is held back. Kept
 * here so MES can change it without the hosting settings, and every change is
 * in the Activity Log.
 */
function TestAddresses({ mode, onChanged }: { mode: Status["mode"]; onChanged: () => Promise<void> }) {
  const { notify } = useToast();
  const [list, setList] = useState<string[] | null>(null);
  const [typed, setTyped] = useState("");
  const [saving, setSaving] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      try {
        const r = await fetch("/api/settings/test-addresses", { headers: await authHeader() });
        const body = (await r.json()) as { ok?: boolean; addresses?: string[]; error?: string };
        if (body.ok) setList(body.addresses ?? []);
        else setProblem(body.error ?? "The test list could not be read.");
      } catch {
        setProblem("The test list could not be read.");
      }
    })();
  }, []);

  async function save(next: string[], said: string) {
    setSaving(true);
    setProblem(null);
    try {
      const r = await fetch("/api/settings/test-addresses", {
        method: "PUT",
        headers: { "Content-Type": "application/json", ...(await authHeader()) },
        body: JSON.stringify({ addresses: next }),
      });
      const body = (await r.json()) as { ok?: boolean; addresses?: string[]; error?: string };
      if (!body.ok) {
        setProblem(body.error ?? "Not saved.");
        return;
      }
      setList(body.addresses ?? next);
      setTyped("");
      notify(said);
      await onChanged();
    } catch {
      setProblem("Not saved. The server may be unreachable.");
    } finally {
      setSaving(false);
    }
  }

  const add = () => {
    const found = typed.split(/[\s,;]+/).map((x) => x.trim().toLowerCase()).filter(Boolean);
    if (!list || found.length === 0) return;
    void save(Array.from(new Set([...list, ...found])), found.length === 1 ? `${found[0]} added to the test list` : `${found.length} addresses added to the test list`);
  };

  return (
    <div className="border-t border-line-hair px-4 py-4 sm:px-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-sm font-medium text-ink">Test addresses</h3>
        <span className="text-[11px] text-ink-muted">
          {mode === "allowed"
            ? "In use now: only these addresses can receive a letter."
            : mode === "everyone"
              ? "Not in use: sending is set to real tenants."
              : "Not in use: sending is off."}
        </span>
      </div>
      <p className="mt-1 text-xs leading-relaxed text-ink-secondary">
        While sending is set to test addresses only, a letter goes out only if every address it is
        going to is on this list. Anything else is held back and recorded, so a real tenant is never
        written to by mistake.
      </p>

      {list === null && !problem ? (
        <Skeleton className="mt-3 h-8 w-full max-w-md rounded-md" />
      ) : null}

      {list ? (
        <ul className="mt-3 flex flex-wrap gap-2">
          {list.length === 0 ? (
            <li className="text-xs text-ink-muted">No test addresses. Nothing can be sent while testing.</li>
          ) : null}
          {list.map((a) => (
            <li key={a} className="inline-flex items-center gap-1.5 rounded-full border border-line-hair bg-surface-alt py-1 pl-3 pr-1.5 text-xs text-ink">
              <span className="break-all">{a}</span>
              <button
                type="button"
                disabled={saving}
                onClick={() => void save(list.filter((x) => x !== a), `${a} removed from the test list`)}
                aria-label={`Remove ${a}`}
                className="rounded-full px-1.5 text-ink-muted hover:text-crit-ink disabled:opacity-40"
              >
                ✕
              </button>
            </li>
          ))}
        </ul>
      ) : null}

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <input
          type="email"
          value={typed}
          onChange={(e) => setTyped(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") add();
          }}
          placeholder="name@mesgroup.com"
          aria-label="Add a test address"
          className="min-w-0 flex-1 rounded-md border bg-surface px-3 py-1.5 text-sm text-ink placeholder:text-ink-muted sm:max-w-sm"
        />
        <button
          type="button"
          disabled={saving || !typed.trim() || list === null}
          onClick={add}
          className="rounded-md border border-line-strong px-3 py-1.5 text-xs font-medium text-ink hover:border-accent hover:text-accent-text disabled:opacity-40"
        >
          {saving ? <Spinner /> : "Add"}
        </button>
      </div>
      {problem ? <p className="mt-2 text-[11px] text-crit-ink">{problem}</p> : null}
    </div>
  );
}
