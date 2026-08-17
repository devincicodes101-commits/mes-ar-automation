"use client";

import { useSyncExternalStore } from "react";
import { Account, Invoice } from "./types";
import { data as seed } from "./data";
import type { ParseResult, ParsedDetail, ParsedSummary } from "./parser";

/**
 * The active dataset.
 *
 * Until somebody uploads a file the app runs on the sample MES supplied. Once
 * a file is read and accepted, that becomes the active dataset and every
 * screen follows it. Screens never read the sample directly, they read this,
 * which is why uploading a file changes the whole application rather than one
 * page.
 */

export interface Manager {
  key: string;
  name: string;
}

export interface Dataset {
  source: "sample" | "uploaded";
  label: string;
  asOf: string;
  period: string;
  accounts: Account[];
  invoices: Invoice[];
  managers: Manager[];
}

const norm = (s: string) =>
  String(s ?? "").trim().replace(/\s+/g, " ").replace(/\.$/, "").toUpperCase();

/* ------------------------------------------------------------------ merge */

/**
 * Joins the two workbooks the way the summary and detail reports relate:
 * the summary is one row per tenant per property, the detail is invoices for
 * a subset of those tenants. Matching is on company name, because that is the
 * only field the two files share.
 */
export function mergeParsed(
  summary: ParsedSummary | null,
  detail: ParsedDetail | null,
  period: string,
): Dataset {
  const accounts: Account[] = (summary?.accounts ?? seed.accounts).map((a) => ({
    ...a,
  }));

  const invoices: Invoice[] = detail
    ? detail.invoices.map((i, n) => ({ ...i, id: `inv-${n + 1}` }))
    : (seed.invoices as Invoice[]);

  const managers: Manager[] =
    detail?.managers ??
    ((seed as unknown as { managers?: Manager[] }).managers ?? []);

  if (detail) {
    const emailsBy = new Map(
      detail.contacts.map((c) => [norm(c.companyName), c.emails]),
    );
    const industryBy = new Map(
      detail.industries.map((i) => [norm(i.companyName), i]),
    );
    const rmBy = new Map(
      detail.rmAssignments.map((r) => [norm(r.companyName), r.rm]),
    );

    for (const a of accounts) {
      const key = norm(a.companyName);
      const mine = invoices.filter((i) => norm(i.companyName) === key);

      a.emails = emailsBy.get(key) ?? [];
      a.hasContact = a.emails.length > 0;
      a.industry = industryBy.get(key)?.industry ?? null;
      a.entity = industryBy.get(key)?.entity ?? null;
      a.invoiceCount = mine.length;
      a.isOneFm = mine.some((i) => i.isOneFm);
      a.revenueTypes = Array.from(new Set(mine.map((i) => i.revenueType))).sort();
      a.lateFeeCount = mine.filter(
        (i) => i.revenueType === "Late Payment Fee",
      ).length;
      (a as Account & { rm?: string }).rm = rmBy.get(key);
    }
  }

  return {
    source: "uploaded",
    label:
      summary && detail
        ? "Both files"
        : summary
          ? "AR summary only"
          : "Invoice detail only",
    asOf: summary?.asOf ?? detail?.asOf ?? seed.asOfSummary,
    period,
    accounts,
    invoices,
    managers,
  };
}

/** Pulls whichever of the two file kinds are present out of a parse run. */
export function datasetFromResults(
  results: ParseResult[],
  period: string,
): Dataset | null {
  const summary =
    (results.find((r) => r.kind === "ar-summary") as ParsedSummary) ?? null;
  const detail =
    (results.find((r) => r.kind === "ar-detail") as ParsedDetail) ?? null;
  if (!summary && !detail) return null;
  return mergeParsed(summary, detail, period);
}

/* ------------------------------------------------------------------ store */

const SAMPLE: Dataset = {
  source: "sample",
  label: "MES sample data",
  asOf: seed.asOfSummary,
  period: seed.asOfSummary.slice(0, 7),
  accounts: seed.accounts,
  invoices: seed.invoices as Invoice[],
  managers: (seed as unknown as { managers?: Manager[] }).managers ?? [],
};

const KEY = "mes-ar-dataset-v1";

let active: Dataset = SAMPLE;
let hydrated = false;
const listeners = new Set<() => void>();

function read(): Dataset {
  if (typeof window === "undefined") return SAMPLE;
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return SAMPLE;
    const parsed = JSON.parse(raw) as Dataset;
    return parsed?.accounts?.length ? parsed : SAMPLE;
  } catch {
    return SAMPLE;
  }
}

function commit(next: Dataset) {
  active = next;
  if (typeof window !== "undefined") {
    try {
      if (next.source === "sample") window.localStorage.removeItem(KEY);
      else window.localStorage.setItem(KEY, JSON.stringify(next));
    } catch {
      // A large upload can exceed the storage quota. The dataset still works
      // for this session, it just will not survive a refresh.
    }
  }
  listeners.forEach((l) => l());
}

function subscribe(listener: () => void) {
  if (!hydrated) {
    hydrated = true;
    active = read();
  }
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function getSnapshot(): Dataset {
  if (!hydrated && typeof window !== "undefined") {
    hydrated = true;
    active = read();
  }
  return active;
}

function getServerSnapshot(): Dataset {
  return SAMPLE;
}

export function useDataset(): Dataset {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}

export function applyDataset(d: Dataset): void {
  commit(d);
}

export function revertToSample(): void {
  commit(SAMPLE);
}
