"use client";

import { useState } from "react";
import { ROLE_SEES, SEED_USERS, User, UserRole } from "@/lib/users";
import { useSession, useToast } from "@/lib/session";
import { Card, CardHeader, StatusBadge, Tag } from "@/components/ui";

const ROLES: UserRole[] = ["CSD", "RM", "Management"];

/**
 * User Management. Proposal 8.1 lists "user management" alongside role based
 * access and the audit log. What a role may do is set out on Access Control;
 * this screen is only about who exists and which role they hold.
 */
export default function UsersPage() {
  const { canAct } = useSession();
  const { notify } = useToast();
  const [users, setUsers] = useState<User[]>(SEED_USERS);
  const [newName, setNewName] = useState("");
  const [newRole, setNewRole] = useState<UserRole>("CSD");

  return (
    <div className="space-y-5">
      <Card>
        <CardHeader
          title="People who can use the system"
          hint="Changing somebody's role changes what the database will return to them, not only what this screen shows them."
          right={
            !canAct ? (
              <StatusBadge kind="neutral" label="View only for your role" />
            ) : undefined
          }
        />

        <ul className="divide-y divide-line-grid">
          {users.map((u) => (
            <li
              key={u.id}
              className="flex flex-wrap items-center gap-4 px-5 py-3"
            >
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="font-medium text-ink">{u.name}</span>
                  <Tag>{u.role}</Tag>
                </div>
                <p className="mt-0.5 text-xs text-ink-secondary">
                  {ROLE_SEES[u.role]}
                </p>
              </div>

              <select
                aria-label={`Role for ${u.name}`}
                value={u.role}
                disabled={!canAct}
                onChange={(e) => {
                  const role = e.target.value as UserRole;
                  setUsers((list) =>
                    list.map((x) => (x.id === u.id ? { ...x, role } : x)),
                  );
                  notify(`${u.name} is now ${role}`);
                }}
                className="rounded border border-line-hair bg-surface px-2.5 py-1.5 text-xs text-ink disabled:opacity-50"
              >
                {ROLES.map((r) => (
                  <option key={r} value={r}>
                    {r}
                  </option>
                ))}
              </select>

              <button
                type="button"
                disabled={!canAct}
                onClick={() => {
                  setUsers((list) => list.filter((x) => x.id !== u.id));
                  notify(`${u.name} removed`);
                }}
                className="text-[11px] text-ink-muted underline hover:text-ink disabled:no-underline disabled:opacity-50"
              >
                Remove
              </button>
            </li>
          ))}
        </ul>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            const name = newName.trim();
            if (!name) return;
            setUsers((list) => [
              ...list,
              { id: `u-${list.length}-${name.length}`, name, role: newRole },
            ]);
            notify(`${name} added as ${newRole}`);
            setNewName("");
          }}
          className="flex flex-wrap items-end gap-3 border-t border-line-hair bg-surface-alt px-5 py-3.5"
        >
          <label className="block">
            <span className="mb-1 block text-[11px] font-medium text-ink-muted">
              Add someone
            </span>
            <input
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="Full name"
              disabled={!canAct}
              className="rounded border border-line-hair bg-surface px-2.5 py-1.5 text-xs text-ink placeholder:text-ink-muted disabled:opacity-50"
            />
          </label>

          <select
            aria-label="Role for the new user"
            value={newRole}
            disabled={!canAct}
            onChange={(e) => setNewRole(e.target.value as UserRole)}
            className="rounded border border-line-hair bg-surface px-2.5 py-1.5 text-xs text-ink disabled:opacity-50"
          >
            {ROLES.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </select>

          <button
            type="submit"
            disabled={!canAct || !newName.trim()}
            className="rounded border border-accent bg-accent px-3 py-1.5 text-xs font-medium text-accent-ink hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
          >
            Add user
          </button>

          {!canAct ? (
            <span className="text-[11px] text-ink-muted">
              Only CSD can manage users.
            </span>
          ) : null}
        </form>
      </Card>
    </div>
  );
}
