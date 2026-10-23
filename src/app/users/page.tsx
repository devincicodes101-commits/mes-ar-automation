"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { PageTabs, usePageTab } from "@/components/PageTabs";
import AccessPage from "@/app/access/page";
import { ROLE_LABEL, ROLE_SUMMARY, type Role } from "@/lib/auth";
import { authHeader } from "@/lib/use-letter-edits";
import { useDataset } from "@/lib/dataset";
import { useToast } from "@/lib/session";
import { formatDateTime } from "@/lib/format";
import { managerDisplayName } from "@/lib/dispatch";
import { Card, CardHeader, EmptyState, StatusBadge, TableSkeleton, Tag } from "@/components/ui";

interface Login {
  id: string;
  name: string;
  role: Role | null;
  manager: string | null;
  email: string | null;
  lastSignIn: string | null;
  off: boolean;
  you: boolean;
}

const ROLES: Role[] = ["super-admin", "admin", "CSD", "RM", "Management"];

/**
 * User Management: the people who can sign in, and the role each holds.
 *
 * This listed a made-up team kept in the code, with add, remove and role
 * controls that changed nothing outside the browser. It now reads and changes
 * the real logins through /api/users, which enforces who may do what.
 */
/**
 * User Management and Access Control, one menu entry (24 October): who can
 * sign in, and what each role lets them do.
 */
export default function UsersPage() {
  const [tab, setTab] = usePageTab(["logins", "roles"] as const, "logins");
  return (
    <div className="space-y-5">
      <Card className="px-4 py-3 sm:px-5">
        <PageTabs
          label="Logins or roles"
          value={tab}
          onChange={setTab}
          tabs={[
            { key: "logins", label: "Logins" },
            { key: "roles", label: "What each role can do" },
          ]}
        />
      </Card>
      {tab === "logins" ? <Logins /> : <AccessPage />}
    </div>
  );
}

function Logins() {
  const { notify } = useToast();
  const [users, setUsers] = useState<Login[] | null>(null);
  const [mayGrantSuper, setMayGrantSuper] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);

  /* The managers the report names, which is what an RM's login must match. */
  const ds = useDataset();
  const managers = useMemo(
    () =>
      Array.from(new Set(ds.accounts.map((a) => (a as { rm?: string }).rm).filter((m): m is string => Boolean(m))))
        .filter((m) => !/do not delete/i.test(m))
        .sort((a, b) => managerDisplayName(a).localeCompare(managerDisplayName(b))),
    [ds.accounts],
  );

  const load = useCallback(async () => {
    try {
      const r = await fetch("/api/users", { cache: "no-store", headers: await authHeader() });
      const body = (await r.json()) as { ok?: boolean; users?: Login[]; error?: string; mayGrantSuperAdmin?: boolean };
      if (!r.ok || !body.ok) setError(body.error ?? `The server answered ${r.status}.`);
      else {
        setUsers(body.users ?? []);
        setMayGrantSuper(Boolean(body.mayGrantSuperAdmin));
        setError(null);
      }
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function change(u: Login, patch: Partial<{ role: Role; manager: string | null; off: boolean }>, said: string) {
    setBusy(u.id);
    try {
      const r = await fetch("/api/users", {
        method: "PATCH",
        headers: { "Content-Type": "application/json", ...(await authHeader()) },
        body: JSON.stringify({ id: u.id, ...patch }),
      });
      const body = (await r.json()) as { ok?: boolean; error?: string };
      if (!r.ok || !body.ok) notify("Not changed", body.error ?? `The server answered ${r.status}.`);
      else notify(said);
    } catch (e) {
      notify("Not changed", (e as Error).message);
    }
    setBusy(null);
    await load();
  }

  const roles = ROLES.filter((r) => r !== "super-admin" || mayGrantSuper);

  return (
    <div className="space-y-5">
      <Card>
        <CardHeader
          title="People who can use the system"
          hint={users ? `${users.filter((u) => !u.off).length} active ${users.filter((u) => !u.off).length === 1 ? "login" : "logins"}` : undefined}
          right={
            <button
              type="button"
              onClick={() => setAdding(true)}
              className="rounded-md border border-accent bg-accent px-3.5 py-1.5 text-xs font-medium text-accent-ink"
            >
              Add a login
            </button>
          }
        />
        {error ? (
          <EmptyState title="Could not read the logins" body={error} />
        ) : users === null ? (
          <TableSkeleton rows={5} />
        ) : users.length === 0 ? (
          <EmptyState title="No logins yet" body="Nobody has been given a login." />
        ) : (
          <ul className="divide-y divide-line-grid">
            {users.map((u) => {
              const locked = u.you || (u.role === "super-admin" && !mayGrantSuper);
              return (
                <li key={u.id} className={`flex flex-col gap-3 px-4 py-3.5 sm:px-5 lg:flex-row lg:items-center lg:gap-4 ${u.off ? "opacity-60" : ""}`}>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium text-ink">{u.name || u.email || "Unnamed"}</span>
                      {u.you ? <Tag>you</Tag> : null}
                      {u.off ? <StatusBadge kind="neutral" label="Switched off" /> : null}
                    </div>
                    <p className="mt-0.5 break-all text-xs text-ink-secondary">{u.email ?? "-"}</p>
                    <p className="mt-0.5 text-[11px] text-ink-muted">
                      {u.lastSignIn ? `Last signed in ${formatDateTime(u.lastSignIn)}` : "Never signed in"}
                      {u.role ? ` · ${ROLE_SUMMARY[u.role]}` : ""}
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <select
                      aria-label={`Role for ${u.name}`}
                      value={u.role ?? ""}
                      disabled={locked || busy === u.id || u.off}
                      onChange={(e) => {
                        const role = e.target.value as Role;
                        if (role === "RM" && !u.manager && managers.length > 0) {
                          void change(u, { role, manager: managers[0] }, `${u.name} is now ${ROLE_LABEL[role]} for ${managerDisplayName(managers[0])}`);
                        } else {
                          void change(u, { role }, `${u.name} is now ${ROLE_LABEL[role]}`);
                        }
                      }}
                      className="rounded-md border bg-surface px-2.5 py-1.5 text-xs text-ink disabled:opacity-60"
                    >
                      {(locked && u.role === "super-admin" ? ROLES : roles).map((r) => (
                        <option key={r} value={r}>
                          {ROLE_LABEL[r]}
                        </option>
                      ))}
                    </select>
                    {u.role === "RM" ? (
                      <select
                        aria-label={`Manager book for ${u.name}`}
                        value={u.manager ?? ""}
                        disabled={locked || busy === u.id || u.off}
                        onChange={(e) =>
                          void change(u, { manager: e.target.value }, `${u.name} now sees ${managerDisplayName(e.target.value)}'s tenants`)
                        }
                        className="rounded-md border bg-surface px-2.5 py-1.5 text-xs text-ink disabled:opacity-60"
                      >
                        {u.manager && !managers.includes(u.manager) ? <option value={u.manager}>{u.manager}</option> : null}
                        {managers.map((m) => (
                          <option key={m} value={m}>
                            {managerDisplayName(m)}
                          </option>
                        ))}
                      </select>
                    ) : null}
                    {!locked ? (
                      <button
                        type="button"
                        disabled={busy === u.id}
                        onClick={() =>
                          void change(u, { off: !u.off }, u.off ? `${u.name} can sign in again` : `${u.name} can no longer sign in`)
                        }
                        className="rounded border border-line-hair px-3 py-1.5 text-xs text-ink-secondary hover:border-line-strong hover:text-ink"
                      >
                        {u.off ? "Switch on" : "Switch off"}
                      </button>
                    ) : null}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </Card>

      {adding ? (
        <AddLogin
          roles={roles}
          managers={managers}
          onClose={() => setAdding(false)}
          onAdded={async (name) => {
            notify(`Login created for ${name}`, "Give them the first password; they can sign in straight away.");
            await load();
          }}
        />
      ) : null}
    </div>
  );
}

function AddLogin({
  roles,
  managers,
  onClose,
  onAdded,
}: {
  roles: Role[];
  managers: string[];
  onClose: () => void;
  onAdded: (name: string) => Promise<void>;
}) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<Role>("CSD");
  const [manager, setManager] = useState(managers[0] ?? "");
  const [password, setPassword] = useState(() => makePassword());
  const [problem, setProblem] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function save() {
    setSaving(true);
    setProblem(null);
    try {
      const r = await fetch("/api/users", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(await authHeader()) },
        body: JSON.stringify({ name, email, role, manager: role === "RM" ? manager : null, password }),
      });
      const body = (await r.json()) as { ok?: boolean; error?: string };
      if (!r.ok || !body.ok) {
        setProblem(body.error ?? `The server answered ${r.status}.`);
        setSaving(false);
        return;
      }
      await onAdded(name);
      onClose();
    } catch (e) {
      setProblem((e as Error).message);
      setSaving(false);
    }
  }

  const ready = name.trim() && /@/.test(email) && password.length >= 10 && (role !== "RM" || manager);
  const input = "w-full rounded-md border bg-surface px-3 py-2 text-sm text-ink";

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/45 p-4 sm:p-8" role="dialog" aria-modal="true" aria-label="Add a login">
      <div className="w-full max-w-lg rounded-lg border border-line-hair bg-surface shadow-xl">
        <div className="flex items-start justify-between gap-4 border-b border-line-hair px-5 py-3.5">
          <h2 className="text-[15px] font-semibold text-ink">Add a login</h2>
          <button type="button" onClick={onClose} aria-label="Close" className="rounded px-1.5 text-ink-muted hover:text-ink">
            ✕
          </button>
        </div>
        <div className="grid gap-4 px-5 py-4">
          <label className="block">
            <span className="mb-1.5 block text-xs font-medium text-ink-secondary">Full name</span>
            <input value={name} onChange={(e) => setName(e.target.value)} className={input} />
          </label>
          <label className="block">
            <span className="mb-1.5 block text-xs font-medium text-ink-secondary">Email address (their username)</span>
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} className={input} />
          </label>
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="block">
              <span className="mb-1.5 block text-xs font-medium text-ink-secondary">Role</span>
              <select value={role} onChange={(e) => setRole(e.target.value as Role)} className={input}>
                {roles.map((r) => (
                  <option key={r} value={r}>
                    {ROLE_LABEL[r]}
                  </option>
                ))}
              </select>
            </label>
            {role === "RM" ? (
              <label className="block">
                <span className="mb-1.5 block text-xs font-medium text-ink-secondary">Their tenants</span>
                <select value={manager} onChange={(e) => setManager(e.target.value)} className={input}>
                  {managers.map((m) => (
                    <option key={m} value={m}>
                      {managerDisplayName(m)}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}
          </div>
          <p className="-mt-2 text-[11px] text-ink-muted">{ROLE_SUMMARY[role]}</p>
          <label className="block">
            <span className="mb-1.5 block text-xs font-medium text-ink-secondary">First password</span>
            <span className="flex gap-2">
              <input value={password} onChange={(e) => setPassword(e.target.value)} className={`${input} font-mono`} />
              <button
                type="button"
                onClick={() => setPassword(makePassword())}
                className="shrink-0 rounded border border-line-hair px-3 text-xs text-ink-secondary hover:border-line-strong"
              >
                New
              </button>
            </span>
            <span className="mt-1 block text-[11px] text-ink-muted">
              At least 10 characters. Give it to them yourself; nothing is emailed.
            </span>
          </label>
          {problem ? <p className="text-xs text-crit-ink">{problem}</p> : null}
        </div>
        <div className="flex flex-wrap items-center gap-2 border-t border-line-hair px-5 py-4">
          <button
            type="button"
            disabled={!ready || saving}
            onClick={() => void save()}
            className="rounded-md border border-accent bg-accent px-4 py-2 text-sm font-medium text-accent-ink"
          >
            {saving ? "Creating..." : "Create the login"}
          </button>
          <button
            type="button"
            onClick={onClose}
            className="rounded border border-line-hair px-4 py-2 text-sm text-ink-secondary hover:border-line-strong hover:text-ink"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}

/** A first password that is easy to read out: no 0/O or 1/l. */
function makePassword(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789";
  const bytes = new Uint32Array(14);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => chars[b % chars.length]).join("");
}
