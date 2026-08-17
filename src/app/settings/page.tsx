"use client";

import { useState } from "react";
import { Template, resetStore, saveTemplate, useStore } from "@/lib/store";
import { MANAGERS, useSession, useToast } from "@/lib/session";
import {
  Card,
  CardHeader,
  EmptyState,
  Modal,
  StatusBadge,
  Tag,
} from "@/components/ui";

interface User {
  id: string;
  name: string;
  role: "CSD" | "RM" | "Management";
  rmKey?: string;
}

const SEED_USERS: User[] = [
  { id: "u1", name: "Jacqueline", role: "CSD" },
  { id: "u2", name: "Darren", role: "CSD" },
  ...MANAGERS.map((m, i) => ({
    id: `u${i + 3}`,
    name: m.name,
    role: "RM" as const,
    rmKey: m.key,
  })),
  { id: "u9", name: "Raman", role: "Management" as const },
];

const ROLE_SEES: Record<User["role"], string> = {
  CSD: "Every tenant, every property. Can send reminders, log calls and raise fees.",
  RM: "Only the tenants assigned to them. View only.",
  Management: "Totals and reports across every property. View only.",
};

export default function SettingsPage() {
  const store = useStore();
  const { canAct } = useSession();
  const { notify } = useToast();
  const [users, setUsers] = useState<User[]>(SEED_USERS);
  const [newName, setNewName] = useState("");
  const [newRole, setNewRole] = useState<User["role"]>("CSD");
  const [editing, setEditing] = useState<Template | null>(null);
  const [tab, setTab] = useState<"templates" | "users" | "activity">(
    "templates",
  );

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap gap-1">
        {(
          [
            ["templates", "Email wording"],
            ["users", "Who can see what"],
            ["activity", "Activity log"],
          ] as const
        ).map(([k, label]) => (
          <button
            key={k}
            type="button"
            onClick={() => setTab(k)}
            aria-pressed={tab === k}
            className={`rounded px-3 py-1.5 text-xs ${
              tab === k
                ? "bg-accent-wash font-medium text-ink"
                : "text-ink-muted hover:bg-surface-alt hover:text-ink-secondary"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === "templates" ? (
        <Card>
          <CardHeader
            title="Standard email wording"
            hint="Change any of these yourself and save. You do not need a developer. The words in double braces are filled in automatically for each tenant."
          />
          <ul className="divide-y divide-line-grid">
            {store.templates.map((t) => (
              <li key={t.id} className="flex flex-wrap gap-4 px-5 py-3.5">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium text-ink">{t.name}</span>
                    <Tag>{t.trigger}</Tag>
                  </div>
                  <p className="mt-1 truncate text-xs text-ink-secondary">
                    {t.subject}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setEditing(t)}
                  className="shrink-0 self-start rounded border border-line-hair px-3 py-1.5 text-xs text-ink hover:border-line-strong"
                >
                  Edit wording
                </button>
              </li>
            ))}
          </ul>
          <div className="border-t border-line-hair bg-surface-alt px-5 py-3">
            <p className="text-[11px] leading-relaxed text-ink-muted">
              These are our drafts. MES has been asked for the wording the team
              uses today, and we will replace them once it arrives.
            </p>
          </div>
        </Card>
      ) : null}

      {tab === "users" ? (
        <>
          <Card>
            <CardHeader
              title="Who can see what"
              hint="Access is decided at the database, not hidden in the screen. A relationship manager cannot reach another manager's tenants even by changing the web address."
            />
            <ul className="divide-y divide-line-grid">
              {users.map((u) => (
                <li key={u.id} className="flex flex-wrap items-center gap-4 px-5 py-3">
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
                      const role = e.target.value as User["role"];
                      setUsers((list) =>
                        list.map((x) => (x.id === u.id ? { ...x, role } : x)),
                      );
                      notify(`${u.name} is now ${role}`);
                    }}
                    className="rounded border border-line-hair bg-surface px-2.5 py-1.5 text-xs text-ink disabled:opacity-50"
                  >
                    <option value="CSD">CSD</option>
                    <option value="RM">RM</option>
                    <option value="Management">Management</option>
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
                if (!newName.trim()) return;
                setUsers((list) => [
                  ...list,
                  {
                    id: `u${Date.parse(new Date().toISOString())}`,
                    name: newName.trim(),
                    role: newRole,
                  },
                ]);
                notify(`${newName.trim()} added as ${newRole}`);
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
                onChange={(e) => setNewRole(e.target.value as User["role"])}
                className="rounded border border-line-hair bg-surface px-2.5 py-1.5 text-xs text-ink disabled:opacity-50"
              >
                <option value="CSD">CSD</option>
                <option value="RM">RM</option>
                <option value="Management">Management</option>
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

          <Card>
            <CardHeader title="How the data is protected" />
            <ul className="divide-y divide-line-grid">
              {[
                "Every table has row level security switched on, so the database itself refuses to return rows a person is not entitled to.",
                "Passwords are never stored by us. Sign in is handled by Supabase.",
                "Sensitive fields are encrypted at rest.",
                "Every action is written to the activity log with the person's name and the time.",
                "Tenant data never leaves MES control. Nothing is sent to NetSuite or the bank automatically.",
              ].map((line) => (
                <li
                  key={line}
                  className="px-5 py-2.5 text-xs leading-relaxed text-ink-secondary"
                >
                  {line}
                </li>
              ))}
            </ul>
          </Card>
        </>
      ) : null}

      {tab === "activity" ? (
        <Card>
          <CardHeader
            title="Activity log"
            hint="Every email, call, promise and export, with who did it and when. This is what auditors and disputes rely on."
            right={
              store.audit.length > 0 ? (
                <button
                  type="button"
                  onClick={() => {
                    if (
                      window.confirm(
                        "Clear all demo activity? This only affects this browser.",
                      )
                    ) {
                      resetStore();
                    }
                  }}
                  className="rounded border border-line-hair px-3 py-1.5 text-xs text-ink-secondary hover:border-line-strong hover:text-ink"
                >
                  Clear demo data
                </button>
              ) : undefined
            }
          />
          {store.audit.length === 0 ? (
            <EmptyState
              title="Nothing recorded yet"
              body="Send a reminder or log a call, and it will appear here immediately."
            />
          ) : (
            <ul className="divide-y divide-line-grid">
              {store.audit.map((a) => (
                <li key={a.id} className="flex flex-wrap gap-4 px-5 py-2.5">
                  <span className="w-40 shrink-0 text-[11px] text-ink-muted">
                    {new Date(a.at).toLocaleString("en-SG")}
                  </span>
                  <span className="min-w-0 flex-1 text-xs text-ink-secondary">
                    <span className="font-medium text-ink">{a.actor}</span>{" "}
                    {a.action.toLowerCase()} for{" "}
                    <span className="text-ink">{a.subject}</span>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      ) : null}

      {editing ? (
        <TemplateEditor
          template={editing}
          onClose={() => setEditing(null)}
        />
      ) : null}
    </div>
  );
}

function TemplateEditor({
  template,
  onClose,
}: {
  template: Template;
  onClose: () => void;
}) {
  const [subject, setSubject] = useState(template.subject);
  const [body, setBody] = useState(template.body);

  return (
    <Modal wide title={`Edit: ${template.name}`} onClose={onClose}>
      <div className="space-y-4">
        <div className="rounded border border-line-hair bg-surface-alt px-3 py-2.5">
          <p className="text-[11px] font-medium text-ink-secondary">
            These get replaced automatically for each tenant
          </p>
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {[
              "{{company}}",
              "{{code}}",
              "{{property}}",
              "{{amount}}",
              "{{overdue}}",
            ].map((v) => (
              <Tag key={v}>{v}</Tag>
            ))}
          </div>
        </div>

        <label className="block">
          <span className="mb-1.5 block text-xs font-medium text-ink-secondary">
            Subject line
          </span>
          <input
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            className="w-full rounded border border-line-hair bg-surface px-3 py-2 text-sm text-ink"
          />
        </label>

        <label className="block">
          <span className="mb-1.5 block text-xs font-medium text-ink-secondary">
            Message
          </span>
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            rows={14}
            className="w-full rounded border border-line-hair bg-surface px-3 py-2 font-mono text-xs leading-relaxed text-ink"
          />
        </label>

        <div className="flex items-center gap-2 border-t border-line-hair pt-4">
          <button
            type="button"
            onClick={() => {
              saveTemplate({ ...template, subject, body });
              onClose();
            }}
            className="rounded border border-accent bg-accent px-4 py-2 text-sm font-medium text-accent-ink hover:opacity-90"
          >
            Save wording
          </button>
          <button
            type="button"
            onClick={onClose}
            className="rounded border border-line-hair px-4 py-2 text-sm text-ink-secondary hover:border-line-strong hover:text-ink"
          >
            Cancel
          </button>
          <StatusBadge kind="good" label="Saved to the activity log" />
        </div>
      </div>
    </Modal>
  );
}
