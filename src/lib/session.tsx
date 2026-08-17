"use client";

import {
  ReactNode,
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
} from "react";
import { Account } from "./types";
import { data } from "./data";

/* ------------------------------------------------------------------ roles */

export type Role = "CSD Officer" | "Relationship Manager" | "Management";

export const ROLES: Role[] = [
  "CSD Officer",
  "Relationship Manager",
  "Management",
];

export interface Manager {
  key: string;
  name: string;
}

export const MANAGERS: Manager[] =
  (data as unknown as { managers?: Manager[] }).managers ?? [];

interface SessionValue {
  role: Role;
  setRole: (r: Role) => void;
  /** Which relationship manager is signed in, when the role is RM. */
  rmKey: string;
  setRmKey: (k: string) => void;
  /** Can this role send reminders, log calls, raise fees, export? */
  canAct: boolean;
  /** Narrows any account list to what this role is allowed to see. */
  scope: (accounts: Account[]) => Account[];
  /** One line describing what the current role can see, shown in the header. */
  scopeNote: string;
}

const SessionContext = createContext<SessionValue | null>(null);

/**
 * Role based access, proposal 4.9 and 8.1.
 *
 * In production this is enforced by Supabase row level security, so the
 * database refuses to return rows the signed in user is not entitled to. This
 * provider mirrors the same rules in the prototype so the walkthrough can
 * demonstrate them. It is a demonstration of the policy, not the policy.
 */
export function SessionProvider({ children }: { children: ReactNode }) {
  const [role, setRole] = useState<Role>("CSD Officer");
  const [rmKey, setRmKey] = useState<string>(MANAGERS[0]?.key ?? "rm1");

  const scope = useCallback(
    (accounts: Account[]) => {
      if (role !== "Relationship Manager") return accounts;
      return accounts.filter(
        (a) => (a as Account & { rm?: string }).rm === rmKey,
      );
    },
    [role, rmKey],
  );

  const value = useMemo<SessionValue>(() => {
    const manager = MANAGERS.find((m) => m.key === rmKey);
    return {
      role,
      setRole,
      rmKey,
      setRmKey,
      canAct: role === "CSD Officer",
      scope,
      scopeNote:
        role === "CSD Officer"
          ? "Every tenant, and you can send, call and raise fees."
          : role === "Relationship Manager"
            ? `Only the tenants assigned to ${manager?.name ?? "you"}. View only.`
            : "Every tenant across all properties. View only.",
    };
  }, [role, rmKey, scope]);

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
}

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
      setToasts((t) => [...t, { id, message, detail }]);
      window.setTimeout(() => dismiss(id), 4500);
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
      className="fixed bottom-5 right-5 z-[60] flex w-80 flex-col gap-2"
      role="status"
      aria-live="polite"
    >
      {ctx.toasts.map((t) => (
        <div
          key={t.id}
          className="rounded border border-line-strong bg-surface px-4 py-3 shadow-lg"
        >
          <div className="flex items-start gap-2.5">
            <span
              aria-hidden="true"
              className="pt-px text-xs"
              style={{ color: "var(--status-good)" }}
            >
              ✓
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
