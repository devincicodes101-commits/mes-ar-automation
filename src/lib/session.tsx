"use client";

import {
  ReactNode,
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { Account } from "./types";
import { data } from "./data";
import {
  type Capability,
  type Role,
  type Session,
  type User,
  ROLE_LABEL,
  ROLE_SUMMARY,
  SESSION_KEY,
  can as roleCan,
  canOpen,
  readSession,
} from "./auth.ts";
import {
  restore as restoreRemote,
  signIn as remoteSignIn,
  signOut as remoteSignOut,
  usingSupabase,
} from "./supabase-auth.ts";

export type { Role, Capability, Session, User };
export { ROLE_LABEL, ROLE_SUMMARY, canOpen };

export interface Manager {
  key: string;
  name: string;
}

export const MANAGERS: Manager[] =
  (data as unknown as { managers?: Manager[] }).managers ?? [];

interface SessionValue {
  /** Null until somebody signs in. Every screen is gated on this. */
  session: Session | null;
  /** False during the first render, before local storage has been read. */
  ready: boolean;
  role: Role | null;
  /** Which relationship manager's book is visible, when the role is RM. */
  rmKey: string | null;
  /** Shorthand the screens already use: may this person change anything? */
  canAct: boolean;
  /** The real question, asked per action rather than per role. */
  can: (capability: Capability) => boolean;
  /** Narrows any account list to what this role is allowed to see. */
  scope: (accounts: Account[]) => Account[];
  /** One line describing what the current role can see. */
  scopeNote: string;
  signIn: (username: string, password: string) => Promise<string | null>;
  signOut: () => void;
}

const SessionContext = createContext<SessionValue | null>(null);

/**
 * Signing in, and what the signed in person may do.
 *
 * The session is kept in local storage so a refresh does not sign anybody out
 * mid-cycle, and carries its own expiry so an unattended machine does not stay
 * open indefinitely. `readSession` treats anything malformed or expired as no
 * session at all rather than trying to repair it.
 *
 * What this is not: security. See the note at the top of auth.ts. The gate
 * lives in the browser, so in production the same rules are enforced again by
 * Supabase row level security, which is what actually stops a person reading
 * rows they are not entitled to.
 */
export function SessionProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [ready, setReady] = useState(false);

  // Local storage is not available while rendering on the server, so the first
  // client render restores the session. Until it has, `ready` is false and the
  // shell renders nothing, which also avoids a hydration mismatch.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      // With a database configured, it is the only authority on who is signed
      // in. Without one, the browser gate in auth.ts stands in.
      if (usingSupabase) {
        const s = await restoreRemote().catch(() => null);
        if (!cancelled) {
          setSession(s);
          setReady(true);
        }
        return;
      }
      try {
        if (!cancelled) setSession(readSession(window.localStorage.getItem(SESSION_KEY)));
      } catch {
        if (!cancelled) setSession(null);
      }
      if (!cancelled) setReady(true);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // An expiry that passes while the tab is open should sign the person out,
  // not wait for the next refresh.
  useEffect(() => {
    if (!session) return;
    // Supabase refreshes its own token, so an expiry passing there is not a
    // sign out. Only the offline fallback needs a timer.
    if (usingSupabase) return;
    const ms = Date.parse(session.expiresAt) - Date.now();
    if (ms <= 0) {
      setSession(null);
      return;
    }
    const t = window.setTimeout(() => setSession(null), Math.min(ms, 2 ** 31 - 1));
    return () => window.clearTimeout(t);
  }, [session]);

  const signIn = useCallback(async (username: string, password: string) => {
    const result = await remoteSignIn(username, password);
    if (!result.ok) return result.reason;

    // Supabase keeps its own session; the local copy is only for the offline
    // fallback, and writing it in both modes would leave a stale session
    // behind after a database sign out.
    if (!usingSupabase) {
      try {
        window.localStorage.setItem(SESSION_KEY, JSON.stringify(result.session));
      } catch {
        // A private window can refuse storage. The session still works for
        // this tab, it just will not survive a refresh.
      }
    }
    setSession(result.session);
    return null;
  }, []);

  const signOut = useCallback(() => {
    void remoteSignOut().catch(() => {
      /* signing out locally matters more than the round trip succeeding */
    });
    try {
      window.localStorage.removeItem(SESSION_KEY);
    } catch {
      /* nothing to clear */
    }
    setSession(null);
  }, []);

  const role = session?.role ?? null;
  const rmKey = session?.rmKey ?? null;

  const scope = useCallback(
    (accounts: Account[]) => {
      if (role !== "RM") return accounts;
      return accounts.filter(
        (a) => (a as Account & { rm?: string }).rm === rmKey,
      );
    },
    [role, rmKey],
  );

  const value = useMemo<SessionValue>(
    () => ({
      session,
      ready,
      role,
      rmKey,
      canAct: roleCan(role, "send-reminders"),
      can: (c: Capability) => roleCan(role, c),
      scope,
      scopeNote: role ? ROLE_SUMMARY[role] : "Not signed in.",
      signIn,
      signOut,
    }),
    [session, ready, role, rmKey, scope, signIn, signOut],
  );

  return (
    <SessionContext.Provider value={value}>{children}</SessionContext.Provider>
  );
}

export function useSession(): SessionValue {
  const v = useContext(SessionContext);
  if (!v) throw new Error("useSession must be used inside SessionProvider");
  return v;
}

/* ----------------------------------------------------------------- toasts */

export interface Toast {
  id: string;
  message: string;
  detail?: string;
  problem: boolean;
}

/*
 * Whether a toast reports something that did not happen.
 *
 * Every toast carried a green tick, so "Nothing was sent" and "The schedule
 * did not run" looked like successes at a glance. Told from the wording the
 * screens already use for failure, so no caller has to change.
 */
const PROBLEM = /^(nothing\b|could not|cannot|can't|not\b|no file|failed|the send failed|only\b)|did not|not sent|not saved|refused|went wrong|were not|was not/i;

interface ToastValue {
  toasts: Toast[];
  notify: (message: string, detail?: string) => void;
  dismiss: (id: string) => void;
}

const ToastContext = createContext<ToastValue | null>(null);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const dismiss = useCallback((id: string) => {
    setToasts((t) => t.filter((x) => x.id !== id));
  }, []);

  const notify = useCallback(
    (message: string, detail?: string) => {
      const id = Math.random().toString(36).slice(2, 9);
      const problem = PROBLEM.test(message);
      setToasts((t) => [...t, { id, message, detail, problem }]);
      /* A problem stays long enough to be read. */
      window.setTimeout(() => dismiss(id), problem ? 9000 : 4500);
    },
    [dismiss],
  );

  const value = useMemo(
    () => ({ toasts, notify, dismiss }),
    [toasts, notify, dismiss],
  );

  return (
    <ToastContext.Provider value={value}>
      {children}
      <ToastTray />
    </ToastContext.Provider>
  );
}

export function useToast(): ToastValue {
  const v = useContext(ToastContext);
  if (!v) throw new Error("useToast must be used inside ToastProvider");
  return v;
}

function ToastTray() {
  const ctx = useContext(ToastContext);
  if (!ctx || ctx.toasts.length === 0) return null;

  return (
    <div
      className="fixed bottom-4 left-4 right-4 z-[60] flex flex-col gap-2 sm:bottom-5 sm:left-auto sm:right-5 sm:w-80"
      role="status"
      aria-live="polite"
    >
      {ctx.toasts.map((t) => (
        <div
          key={t.id}
          role={t.problem ? "alert" : undefined}
          className={`rounded-md border bg-surface px-4 py-3 shadow-lg ${
            t.problem ? "border-crit-line" : "border-line-strong"
          }`}
        >
          <div className="flex items-start gap-2.5">
            <span
              aria-hidden="true"
              className="pt-px text-xs font-bold"
              style={{ color: t.problem ? "var(--status-critical)" : "var(--status-good)" }}
            >
              {t.problem ? "!" : "✓"}
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-xs font-medium text-ink">{t.message}</p>
              {t.detail ? (
                <p className="mt-0.5 text-[11px] text-ink-muted">{t.detail}</p>
              ) : null}
            </div>
            <button
              type="button"
              onClick={() => ctx.dismiss(t.id)}
              aria-label="Dismiss"
              className="text-ink-muted hover:text-ink"
            >
              ✕
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}
