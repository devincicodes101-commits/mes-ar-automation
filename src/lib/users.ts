"use client";

/**
 * Who can use the system, and what each role may do.
 *
 * The role definitions here mirror the row level security policies in
 * supabase/migrations/0002_security.sql. This module is what the screens read;
 * the database is what actually enforces it. If the two ever disagree, the
 * database wins, which is the point.
 */
import { MANAGERS } from "./session";

export type UserRole = "CSD" | "RM" | "Management";

export interface User {
  id: string;
  name: string;
  role: UserRole;
  rmKey?: string;
}

export const SEED_USERS: User[] = [
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

export const ROLE_SEES: Record<UserRole, string> = {
  CSD: "Every tenant, every property. Can send reminders, log calls and raise fees.",
  RM: "Only the tenants assigned to them. View only.",
  Management: "Totals and reports across every property. View only.",
};

export interface Permission {
  label: string;
  csd: boolean;
  rm: boolean;
  management: boolean;
  note?: string;
}

export const PERMISSIONS: Permission[] = [
  { label: "See every tenant", csd: true, rm: false, management: true },
  {
    label: "See only their own tenants",
    csd: false,
    rm: true,
    management: false,
    note: "Enforced by the database, not by hiding rows in the screen.",
  },
  {
    label: "See tenant email addresses",
    csd: true,
    rm: false,
    management: true,
    note: "Personal data under the PDPA, so managers do not get it.",
  },
  { label: "Send reminder emails", csd: true, rm: false, management: false },
  { label: "Log a call", csd: true, rm: false, management: false },
  { label: "Record a promise to pay", csd: true, rm: false, management: false },
  { label: "Raise late payment fees", csd: true, rm: false, management: false },
  { label: "Upload the monthly reports", csd: true, rm: false, management: false },
  { label: "Generate and download reports", csd: true, rm: false, management: false },
  { label: "Edit the email wording", csd: true, rm: false, management: false },
  { label: "Add or remove users", csd: true, rm: false, management: false },
  { label: "Read the activity log", csd: true, rm: false, management: true },
  {
    label: "Change or delete the activity log",
    csd: false,
    rm: false,
    management: false,
    note: "Nobody, including CSD. The database has no policy allowing it, and a trigger blocks it as well.",
  },
];
