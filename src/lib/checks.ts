"use client";

/**
 * The test cases, and the operations that answer them.
 *
 * public/test-cases.csv is a table anybody can open: an ID, the area, the
 * requirement in MES's own words, the scenario, and what is expected. This
 * module turns a row of that table into an answer.
 *
 * It lives in src/lib rather than in scripts because two things run these
 * cases: `npm run test:cases` at the terminal, which fails the build, and the
 * Checks screen, which is how somebody shows a client that the sums are right
 * without asking them to look at a terminal. Two copies would drift, and the
 * thing they would drift on is a boundary — the day a tenant stops being
 * inside their credit period and starts being late.
 *
 * The split is about data, not importance. Most cases are arithmetic and run
 * anywhere. The rest need MES's actual workbook, which the browser has only
 * once somebody uploads it, so they are named separately and skipped rather
 * than silently passed.
 */

import {
  namesADormitory,
  propertyFromDocument,
  round2,
  withoutCode,
} from "./aging-detail.ts";
import { billingCycles, cycleStage, type BillingLine } from "./billing-cycles.ts";
import { bucketLabelForAge, formatSgd } from "./data.ts";
import { revenueType, isOneFm } from "./revenue-rules.ts";
import { riskExposure, depositsFromLedger } from "./reports.ts";
import { addDays, deadlineFor, renderLetter } from "./letters.ts";
import { emailAddresses } from "./emails.ts";
import { canOpen, can, type Role, type Capability } from "./auth.ts";
import { depositsOffset, giroEnrolled } from "./reports.ts";
import type { ParsedAgingDetail } from "./aging-detail.ts";
import type { Pipeline } from "./pipeline.ts";

/** Just enough of a parsed report for the generated-file cases. */
type ParsedReport = Pick<
  ParsedAgingDetail,
  "invoices" | "accounts" | "asOf" | "problems"
>;
type BuiltPipeline = Pick<
  Pipeline,
  "byProperty" | "managerReports" | "defaulters" | "accounts" | "revenueTabs"
>;

export interface CheckCase {
  id: string;
  area: string;
  requirement: string;
  scenario: string;
  op: string;
  input: string;
  expected: string;
}

export interface CheckResult extends CheckCase {
  actual: string;
  pass: boolean;
  /** Set when the case could not be run here, with the reason. */
  skipped?: string;
}

/* --------------------------------------------------------------- the csv */

/** A CSV reader that copes with quoted commas, which the requirements have. */
export function parseCsv(text: string): string[][] {
  const out: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { cell += '"'; i += 1; }
      else if (c === '"') quoted = false;
      else cell += c;
      continue;
    }
    if (c === '"') quoted = true;
    else if (c === ",") { row.push(cell); cell = ""; }
    else if (c === "\n") { row.push(cell); out.push(row); row = []; cell = ""; }
    else if (c !== "\r") cell += c;
  }
  if (cell !== "" || row.length > 0) { row.push(cell); out.push(row); }
  return out.filter((r) => r.some((v) => v !== ""));
}

export function parseCases(text: string): CheckCase[] {
  const table = parseCsv(text);
  const header = table[0] ?? [];
  const at = (name: string) => header.indexOf(name);
  return table.slice(1).map((r) => ({
    id: r[at("ID")] ?? "",
    area: r[at("Area")] ?? "",
    requirement: r[at("Requirement")] ?? "",
    scenario: r[at("Scenario")] ?? "",
    op: r[at("Op")] ?? "",
    input: r[at("Input")] ?? "",
    expected: r[at("Expected")] ?? "",
  }));
}

/* ------------------------------------------------- input in a short form */

/**
 * "2026-07-15:100|none:40" becomes charge lines the grouping can read.
 *
 * Deliberately terse, because these strings sit in a spreadsheet cell that
 * somebody who is not a programmer has to be able to edit. Moving the billing
 * date is the whole point of the aging cases, and it should be a matter of
 * typing a different date.
 */
function lines(spec: string): BillingLine[] {
  if (spec.trim() === "") return [];
  return spec.split("|").map((part, n) => {
    const [d, amount] = part.split(":");
    return {
      companyName: `TENANT ${n} PTE LTD`,
      customerCode: `DORM-${n}`,
      transactionType: "Invoice",
      date: d === "none" ? null : d,
      dueDate: null,
      description: "Occupancy Fee Charges",
      documentNumber: "BSD-786/1",
      linkedContract: null,
      age: null,
      bucket: "",
      openBalance: Number(amount),
      revenueType: "Occupancy Fee",
      isOneFm: false,
    } as unknown as BillingLine;
  });
}

function depositLines(spec: string): BillingLine[] {
  if (spec.trim() === "") return [];
  return spec.split("|").map((amount) => ({
    companyName: "TENANT PTE LTD",
    customerCode: "DORM-1",
    transactionType: "Invoice",
    date: "2026-07-01",
    dueDate: null,
    description: "Security Deposit - REFUNDABLE",
    documentNumber: "BSD-786/1",
    linkedContract: null,
    age: null,
    bucket: "",
    openBalance: Number(amount),
    revenueType: "Security Deposit",
    isOneFm: false,
  }) as unknown as BillingLine);
}

const LETTER_CONTEXT = {
  companyName: "ACME PTE LTD",
  grandTotal: 1234.56,
  sentOn: "2026-08-28",
};

/* -------------------------------------------------------------- the ops */

/**
 * Everything that can be answered from the input alone.
 *
 * This is most of them, and all but two of the aging cases, which is why the
 * Checks screen is worth having: the arithmetic a client wants to see proved
 * needs no file at all.
 */
export const PURE_OPS: Record<string, (input: string) => string> = {
  /* aging, with the billing date as the control */
  cycleAge: (i) => {
    const [billed, report] = i.split("|");
    return String(billingCycles(lines(`${billed}:100`), report).cycles[0]?.ageDays);
  },
  dueBy: (i) => String(billingCycles(lines(`${i}:100`), null).cycles[0]?.dueBy),
  finalBy: (i) => String(billingCycles(lines(`${i}:100`), null).cycles[0]?.finalBy),
  stage: (i) => {
    const [billed, report] = i.split("|");
    const c = billingCycles(lines(`${billed}:100`), report).cycles[0];
    return c ? cycleStage(c) : "no run";
  },
  bucket: (i) => bucketLabelForAge(Number(i)),
  addDays: (i) => {
    const [iso, n] = i.split("|");
    return addDays(iso, Number(n));
  },

  /* several billing dates in one report */
  cycleCount: (i) => String(billingCycles(lines(i), null).cycles.length),
  cycleTotal: (i) => (billingCycles(lines(i), null).cycles[0]?.total ?? 0).toFixed(2),
  cycleFirst: (i) => String(billingCycles(lines(i), null).cycles[0]?.billedOn),
  cycleUndated: (i) => String(billingCycles(lines(i), null).undated),
  cycleUndatedTotal: (i) => billingCycles(lines(i), null).undatedTotal.toFixed(2),
  cycleWho: (i) => {
    const w = billingCycles(lines(i), null).cycles[0]?.who ?? [];
    if (w.length === 0) return "none";
    if (w.length === 1) return w[0]!.name;
    if (w.length === 2) return `${w[0]!.name} and ${w[1]!.name}`;
    return `${w[0]!.name} and ${w.length - 1} others`;
  },
  cycleWhoFirst: (i) =>
    billingCycles(lines(i), null).cycles[0]?.who[0]?.name ?? "none",
  cycleWhoCount: (i) =>
    String(billingCycles(lines(i), null).cycles[0]?.who.length ?? 0),
  cycleOverdue: (i) =>
    (billingCycles(lines(i), "2026-08-28").cycles[0]?.overdue ?? 0).toFixed(2),

  /* charge types and dormitories */
  revenueType: (i) => {
    const [desc, doc, cat] = i.split("|");
    return revenueType(desc, doc, cat);
  },
  isOneFm: (i) => {
    const [doc, desc] = i.split("|");
    return String(isOneFm(desc ?? "", doc));
  },
  property: (i) => {
    const [doc, fallback] = i.split("|");
    return propertyFromDocument(doc, fallback as never);
  },
  namesADormitory: (i) => String(namesADormitory(i)),

  /* letters */
  deadline: (i) => {
    const [id, sent] = i.split("|");
    return deadlineFor(id as never, sent);
  },
  letterMentions: (i) => {
    const [id, phrase] = i.split("|");
    return String(renderLetter(id as never, LETTER_CONTEXT).body.includes(phrase));
  },
  letterUnfilled: (i) => {
    const l = renderLetter(i as never, LETTER_CONTEXT);
    return String((l.body.match(/\{\{[^}]+\}\}/g) ?? []).length);
  },
  letterDatedFromReport: (i) =>
    String(renderLetter("first-reminder", { ...LETTER_CONTEXT, sentOn: i })
      .body.includes(String(new Date(`${i}T12:00`).getFullYear()))),

  /* money */
  currency: (i) => formatSgd(Number(i)),
  round2: (i) => String(round2(Number(i))),
  round2Sum: (i) =>
    String(round2(Array.from({ length: Number(i) }, () => 0.01)
      .reduce((a, b) => a + b, 0))),

  /* risk exposure and the deposit */
  riskExposure: (i) => {
    const [total, dep] = i.split("|");
    const v = riskExposure(Number(total), dep === "none" ? null : Number(dep));
    return v === null ? "blank" : String(v);
  },
  depositHeld: (i) => {
    const v = depositsFromLedger(depositLines(i)).get("DORM-1");
    return v === undefined ? "blank" : v.toFixed(2);
  },

  /* emails */
  emailCount: (i) => String(emailAddresses(i).length),
  emailFirst: (i) => emailAddresses(i)[0] ?? "none",

  /* access */
  canOpen: (i) => {
    const [role, route] = i.split("|");
    return String(canOpen(role as Role, route));
  },
  can: (i) => {
    const [role, cap] = i.split("|");
    return String(can(role as Role, cap as Capability));
  },

  withoutCode: (i) => {
    const [name, code] = i.split("|");
    return withoutCode(name, code);
  },
};

/**
 * Cases that need MES's own workbook, or the project's source, to answer.
 *
 * Named here so that anything running only the portable set can say which
 * cases it left out and why, rather than quietly reporting a smaller total
 * as though that were the whole suite.
 */
export function needsTheFile(op: string): boolean {
  return (
    op.startsWith("file") ||
    op.startsWith("month") ||
    op.startsWith("new") ||
    op === "noMailer"
  );
}

export function whyItNeedsTheFile(op: string): string {
  if (op.startsWith("month"))
    return "Walks a whole month over MES's export, so it runs at the terminal against their file.";
  if (op === "noMailer")
    return "Reads the project's own source to prove no mail transport is imported.";
  if (op.startsWith("new"))
    return "Reads the generated test report from disk, so it runs at the terminal.";
  return "Reads MES's workbook from disk, which the browser does not have.";
}


/* ------------------------------------------- the generated report's cases */

/**
 * The cases that read the generated test report.
 *
 * MES have sent two files and this system was built against both, so passing
 * on them shows only that nothing has regressed. scripts/build-test-data.mts
 * writes a third the code has never seen, with the billing dates chosen: rows
 * sitting exactly on every bucket boundary and on both credit deadlines, and a
 * day either side of each.
 *
 * Taking the parsed file as an argument rather than reading it means the same
 * operations serve the terminal, which reads it off disk, and the Checks
 * screen, which fetches it and parses it in the browser exactly as it parses
 * an upload. The client can watch a file the code has never seen be read and
 * checked in front of them, which is the only version of this evidence worth
 * anything.
 */
export function dataOps(
  ar: ParsedReport,
  pipeline: BuiltPipeline,
): Record<string, (input: string) => string> {
  return {
    newLines: () => String(ar.invoices.length),
    newAccounts: () => String(ar.accounts.length),
    newAsOf: () => String(ar.asOf),
    newTotal: () => ar.accounts.reduce((n, a) => n + a.total, 0).toFixed(2),
    newErrors: () =>
      String(ar.problems.filter((p) => p.severity === "error").length),
    newSubtotalsDisagreeing: () =>
      String(ar.problems.filter((p) => p.message.includes("own total")).length),
    newBillingRuns: () =>
      String(billingCycles(ar.invoices, ar.asOf).cycles.length),
    newGiro: () => String(giroEnrolled(ar.invoices).size),
    newDeposits: () => String(depositsFromLedger(ar.invoices).size),
    newDepositsOffset: () => String(depositsOffset(ar.invoices).length),
    newDormitories: () => pipeline.byProperty.map((b) => b.property).join(","),
    newManagers: () => String(pipeline.managerReports.length),
    newDefaulters: () => String(pipeline.defaulters.length),
    newWithAddress: () =>
      String(pipeline.accounts.filter((a) => a.emails.length > 0).length),
    newAddressesFor: (i) => {
      const a = pipeline.accounts.find((x) => x.customerCode === i);
      return String(a?.emails.length ?? "no such tenant");
    },

    /** The bucket of the line billed on a given date: the aging control. */
    newBucketOn: (i) => {
      const line = ar.invoices.find((x) => x.date === i);
      return line ? String(line.bucket) : "no line billed then";
    },
    /** How far through its credit period the run billed then has got. */
    newStageOn: (i) => {
      const c = billingCycles(ar.invoices, ar.asOf).cycles
        .find((x) => x.billedOn === i);
      return c ? cycleStage(c) : "no run billed then";
    },
    /** The age the file itself carries for the line billed on that date. */
    newAgeOn: (i) => {
      const line = ar.invoices.find((x) => x.date === i);
      return line ? String(line.age) : "no line billed then";
    },
    newTypeOf: (i) => {
      const line = ar.invoices.find((x) => String(x.description).startsWith(i));
      return line ? line.revenueType : "no such line";
    },
    newDormOf: (i) => {
      const line = ar.invoices.find((x) => x.documentNumber === i);
      return line ? line.property : "no such document";
    },
    newTabLines: (i) => {
      const tab = pipeline.revenueTabs.find((t) => t.code === i);
      return tab ? String(tab.lineCount) : "no such tab";
    },
    newAccountTotal: (i) => {
      const [code, dorm] = i.split("|");
      const a = pipeline.accounts.find(
        (x) => x.customerCode === code && x.property === dorm);
      return a ? a.total.toFixed(2) : "no such account";
    },
  };
}

/* ------------------------------------------------------------- running */


export function runCase(
  c: CheckCase,
  extra: Record<string, (input: string) => string> = {},
): CheckResult {
  const fn = extra[c.op] ?? PURE_OPS[c.op];
  if (!fn) {
    return {
      ...c,
      actual: "",
      pass: false,
      skipped: needsTheFile(c.op) ? whyItNeedsTheFile(c.op) : `No such operation: ${c.op}`,
    };
  }
  try {
    const actual = fn(c.input);
    return { ...c, actual, pass: actual === c.expected };
  } catch (e) {
    return { ...c, actual: `ERROR: ${(e as Error).message}`, pass: false };
  }
}

export function runCases(
  cases: readonly CheckCase[],
  extra: Record<string, (input: string) => string> = {},
): CheckResult[] {
  return cases.map((c) => runCase(c, extra));
}

export interface CheckTally {
  area: string;
  pass: number;
  fail: number;
  skipped: number;
}

export function tally(results: readonly CheckResult[]): CheckTally[] {
  const by = new Map<string, CheckTally>();
  for (const r of results) {
    const t = by.get(r.area) ?? { area: r.area, pass: 0, fail: 0, skipped: 0 };
    if (r.skipped) t.skipped += 1;
    else if (r.pass) t.pass += 1;
    else t.fail += 1;
    by.set(r.area, t);
  }
  return Array.from(by.values()).sort((a, b) => a.area.localeCompare(b.area));
}
