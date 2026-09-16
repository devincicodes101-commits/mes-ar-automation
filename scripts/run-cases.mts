/**
 * Runs every row of test-cases.csv against the real code.
 *
 *   npm run test:cases
 *
 * The other suites are written in TypeScript by whoever changed the code. This
 * one is a table anybody can read, extend or hand to the client, and it fails
 * the build the same way the others do. Each row names the requirement it came
 * from, so a red line points at a sentence in MES's documents rather than at a
 * function nobody outside the project has heard of.
 *
 * Results are written back to test-results.csv with what actually happened.
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as XLSX from "xlsx";

import {
  parseAgingDetail,
  propertyFromDocument,
  round2,
  withoutCode,
} from "../src/lib/aging-detail.ts";
import { billingCycles, cycleStage } from "../src/lib/billing-cycles.ts";
import { bucketLabelForAge, formatSgd } from "../src/lib/data.ts";
import { revenueType, isOneFm } from "../src/lib/revenue-rules.ts";
import {
  riskExposure,
  depositsFromLedger,
  depositsOffset,
  giroEnrolled,
} from "../src/lib/reports.ts";
import { addDays, deadlineFor, renderLetter } from "../src/lib/letters.ts";
import { emailAddresses } from "../src/lib/emails.ts";
import { canOpen, can, type Role, type Capability } from "../src/lib/auth.ts";
import { buildPipeline, linkContacts } from "../src/lib/pipeline.ts";
import { parseContacts } from "../src/lib/parser.ts";
import { CAN_SEND_FOR_REAL } from "../src/lib/outbox.ts";
import {
  CYCLE_DAYS, emptyState, planFor, runDay, markPaid, markPromised,
  stillOwing, type CycleDay,
} from "../src/lib/cycle.ts";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, "..");
const DATA = path.join(ROOT, "AR Automation-20260903T201835Z-1-001", "AR Automation");

/* ------------------------------------------------------------------- csv */

function parseCsv(text: string): string[][] {
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

const csvCell = (v: string) =>
  /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;

/* ------------------------------------------------------ the files, once */

const rd = (p: string) => XLSX.read(readFileSync(p), { type: "buffer" });

const AGING_PATH = path.join(DATA, "3. CustomA_RAgingDetail-WithDescription.xlsx");
const FINANCE_PATH = path.join(DATA, "Detailed AR report(Final).xlsx");
const CONTACTS_PATH = path.join(DATA, "4. Client Contact List", "R1 - 20260511.xlsx");

const files = new Map<string, ReturnType<typeof parseAgingDetail>>();
function file(which: string) {
  if (!files.has(which)) {
    const p = which === "aging" ? AGING_PATH : FINANCE_PATH;
    if (!existsSync(p)) throw new Error(`missing ${p}`);
    files.set(which, parseAgingDetail(rd(p)));
  }
  return files.get(which)!;
}

let month: { p: ReturnType<typeof buildPipeline>; states: Map<number, ReturnType<typeof emptyState>> } | null = null;
function theMonth() {
  if (month) return month;
  const ar = file("aging");
  let p = buildPipeline(ar.accounts, ar.invoices, ar.asOf, ar.entity, []);
  if (existsSync(CONTACTS_PATH)) {
    const contacts = parseContacts(rd(CONTACTS_PATH));
    p = { ...p, accounts: linkContacts(p.accounts.map((a) => ({ ...a })), contacts) };
  }
  const states = new Map<number, ReturnType<typeof emptyState>>();
  let s = emptyState();
  states.set(0, s);
  for (const d of CYCLE_DAYS) { s = runDay(p, s, d); states.set(d, s); }
  month = { p, states };
  return month;
}

/* --------------------------------------------------- lines from shorthand */

/** "2026-07-15:100|none:40" -> invoice lines the billing grouping can read. */
function lines(spec: string) {
  if (spec.trim() === "") return [];
  return spec.split("|").map((part, n) => {
    const [d, amt] = part.split(":");
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
      openBalance: Number(amt),
      revenueType: "Occupancy Fee",
      isOneFm: false,
    };
  }) as never[];
}

function depositLines(spec: string) {
  if (spec.trim() === "") return [] as never[];
  return spec.split("|").map((amt) => ({
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
    openBalance: Number(amt),
    revenueType: "Security Deposit",
    isOneFm: false,
  })) as never[];
}

const LETTER_CONTEXT = {
  companyName: "ACME PTE LTD",
  grandTotal: 1234.56,
  sentOn: "2026-08-28",
};

/* ------------------------------------------------------------ operations */

const ops: Record<string, (input: string) => string> = {
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
    String(renderLetter("first-reminder", { ...LETTER_CONTEXT, sentOn: i }).body
      .includes(String(new Date(`${i}T12:00`).getFullYear()))),

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
    const held = depositsFromLedger(depositLines(i));
    const v = held.get("DORM-1");
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

  /* the real files */
  fileAccounts: (i) => String(file(i).accounts.length),
  fileLines: (i) => String(file(i).invoices.length),
  fileCycles: (i) => String(billingCycles(file(i).invoices, file(i).asOf).cycles.length),
  fileTotal: (i) =>
    file(i).invoices.reduce((t, x) => t + x.openBalance, 0).toFixed(2),
  fileGiro: (i) => String(giroEnrolled(file(i).invoices).size),
  fileDeposits: (i) => String(depositsFromLedger(file(i).invoices).size),
  fileDepositsOffset: (i) => String(depositsOffset(file(i).invoices).length),
  fileManagers: (i) => {
    const f = file(i);
    return String(buildPipeline(f.accounts, f.invoices, f.asOf, f.entity, []).managerReports.length);
  },
  fileSubtotalsDisagreeing: (i) => {
    const f = file(i);
    const ours = new Map<string, number>();
    for (const inv of f.invoices) {
      const k = inv.customerCode.toUpperCase();
      ours.set(k, (ours.get(k) ?? 0) + inv.openBalance);
    }
    let bad = 0;
    for (const s of f.subtotals) {
      const mine = round2(ours.get(s.customerCode.toUpperCase()) ?? 0);
      if (Math.abs(mine - s.total) > 0.005) bad += 1;
    }
    return String(bad);
  },
  /** The date every line agrees on: due date plus age. */
  fileDataDate: (i) => {
    const f = file(i);
    for (const inv of f.invoices) {
      if (inv.dueDate && inv.age !== null) return addDays(inv.dueDate, inv.age);
    }
    return "none";
  },
  /*
   * Our bucket against the Aging column MES already have in the file.
   *
   * Their Finance AR Download carries Age in column L and Aging in column M,
   * and their Formula tab buckets L. This compares what we produce with what
   * they produce, on their own data, which is the only check that settles
   * what "aging" means here rather than arguing about it.
   */
  fileBucketsVsMes: () => {
    const wb = rd(FINANCE_PATH);
    const rows = XLSX.utils.sheet_to_json(wb.Sheets["Finance AR Download"]!, {
      header: 1, raw: false, defval: "",
    }) as unknown[][];
    let differ = 0;
    for (const r of rows.slice(1)) {
      const age = String(r[11] ?? "").trim();
      const aging = String(r[12] ?? "").trim();
      if (age === "" || aging === "") continue;
      if (bucketLabelForAge(Number(age)) !== aging) differ += 1;
    }
    return String(differ);
  },
  /*
   * And the same, if the age were counted from the billing date rather than
   * from the due date. It is not a rhetorical case: it is the reading of
   * "use the billing date and create buckets along that date" that we did not
   * take, and this records what taking it would have cost.
   */
  fileBucketsFromBillingVsMes: () => {
    const wb = rd(FINANCE_PATH);
    const rows = XLSX.utils.sheet_to_json(wb.Sheets["Finance AR Download"]!, {
      header: 1, raw: false, defval: "",
    }) as unknown[][];
    const asIso = (v: unknown) => {
      const d = new Date(`${String(v ?? "").trim()} 12:00`);
      if (Number.isNaN(d.getTime())) return null;
      const pad = (n: number) => String(n).padStart(2, "0");
      return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
    };
    const between = (a: string, b: string) =>
      Math.round((new Date(`${b}T12:00`).getTime() - new Date(`${a}T12:00`).getTime()) / 86400000);
    let differ = 0;
    for (const r of rows.slice(1)) {
      const age = String(r[11] ?? "").trim();
      const aging = String(r[12] ?? "").trim();
      const billed = asIso(r[4]);
      const due = asIso(r[10]);
      if (age === "" || aging === "" || !billed || !due) continue;
      if (bucketLabelForAge(Number(age) + between(billed, due)) !== aging) differ += 1;
    }
    return String(differ);
  },

  /** The date the system settles on, after weighing title against data. */
  fileHeaderDate: (i) => String(file(i).asOf),
  /** The date actually typed in the title row, read straight off the sheet. */
  fileTitleDate: (i) => {
    const p = i === "aging" ? AGING_PATH : FINANCE_PATH;
    const wb = rd(p);
    for (const name of wb.SheetNames) {
      const rows = XLSX.utils.sheet_to_json(wb.Sheets[name]!, {
        header: 1, raw: false, defval: "",
      }) as unknown[][];
      for (const row of rows.slice(0, 10)) {
        const m = /^as of\s+(.+)$/i.exec(String(row[0] ?? "").trim());
        if (!m) continue;
        const d = new Date(`${m[1]} 12:00`);
        if (Number.isNaN(d.getTime())) continue;
        const pad = (n: number) => String(n).padStart(2, "0");
        return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
      }
    }
    return "none";
  },
  fileDateConflictFlagged: (i) => {
    const f = file(i);
    let data: string | null = null;
    for (const inv of f.invoices) {
      if (inv.dueDate && inv.age !== null) { data = addDays(inv.dueDate, inv.age); break; }
    }
    if (!data || !f.asOf || data === f.asOf) return "true"; // nothing to flag
    return String(f.problems.some((p) => p.message.includes(data!)));
  },

  /* the month */
  monthReminded: (i) => String(theMonth().states.get(Number(i))!.firstReminder.length),
  monthRemindedTwice: (i) => {
    const { p, states } = theMonth();
    const again = runDay(p, states.get(Number(i))!, Number(i) as CycleDay);
    return String(again.firstReminder.length);
  },
  monthCharged: (i) => String(theMonth().states.get(Number(i))!.charged.length),
  monthHeld: () => String(theMonth().p.giroCustomers.size),
  monthFinalised: (i) => String(theMonth().states.get(Number(i))!.finalNotice.length),
  monthPaidDrops: () => {
    const { p } = theMonth();
    let s = runDay(p, emptyState(), 1);
    const who = stillOwing(p, s)[0]!;
    s = markPaid(s, who, 4);
    return String(!stillOwing(p, s).some((a) => a.id === who.id));
  },
  monthPromisedDrops: () => {
    const { p } = theMonth();
    let s = runDay(p, emptyState(), 1);
    const who = stillOwing(p, s)[0]!;
    s = markPromised(s, who, "2026-09-30", 4);
    return String(!stillOwing(p, s).some((a) => a.id === who.id));
  },
  monthDeterministic: () => {
    const { p } = theMonth();
    const run = () => CYCLE_DAYS.reduce((st, d) => runDay(p, st, d), emptyState());
    return String(JSON.stringify(run().log) === JSON.stringify(run().log));
  },
  monthUploadDays: () => {
    const { p } = theMonth();
    const says = (d: CycleDay) =>
      (planFor(p, emptyState(), d).fromFlowTab ?? "").includes("Uploads AR Report");
    return String(says(4) && says(7) && says(16));
  },
  monthRmChoice: (i) => {
    const f = file("finance");
    const p = buildPipeline(f.accounts, f.invoices, f.asOf, f.entity, []);
    const names = p.managerReports.map((r) => r.managerName).slice(0, Number(i));
    const s = runDay(p, emptyState(), 16, names);
    const sent = s.log.find((l) => l.text.includes("Late payment report sent"));
    return String(sent?.accounts?.length ?? 0);
  },
  monthRmNoneBlocked: () => {
    const f = file("finance");
    const p = buildPipeline(f.accounts, f.invoices, f.asOf, f.entity, []);
    return String(planFor(p, emptyState(), 16, []).blockers
      .some((b) => b.includes("No manager is selected")));
  },
  sendingDisabled: () => String(CAN_SEND_FOR_REAL === false),
  noMailer: () => {
    const src = ["outbox.ts", "cycle.ts", "dispatch.ts"]
      .map((f) => readFileSync(path.join(ROOT, "src", "lib", f), "utf8"))
      .join("");
    return String(!/nodemailer|sendgrid|@sendgrid|resend|smtp\./i.test(src));
  },
};

/* ------------------------------------------------------------------ run */

const casesPath = path.join(ROOT, "test-cases.csv");
if (!existsSync(casesPath)) {
  console.error("test-cases.csv not found. Run: python scripts/build-cases.py");
  process.exit(1);
}

const table = parseCsv(readFileSync(casesPath, "utf8"));
const header = table[0]!;
const idx = (name: string) => header.indexOf(name);
const cases = table.slice(1).map((r) => ({
  id: r[idx("ID")] ?? "",
  area: r[idx("Area")] ?? "",
  requirement: r[idx("Requirement")] ?? "",
  scenario: r[idx("Scenario")] ?? "",
  op: r[idx("Op")] ?? "",
  input: r[idx("Input")] ?? "",
  expected: r[idx("Expected")] ?? "",
}));

const results: string[][] = [[...header, "Actual", "Result"]];
const byArea = new Map<string, { pass: number; fail: number }>();
const failures: string[] = [];

for (const c of cases) {
  let actual: string;
  let ok: boolean;
  try {
    const fn = ops[c.op];
    if (!fn) throw new Error(`no such operation: ${c.op}`);
    actual = fn(c.input);
    ok = actual === c.expected;
  } catch (e) {
    actual = `ERROR: ${(e as Error).message}`;
    ok = false;
  }
  const tally = byArea.get(c.area) ?? { pass: 0, fail: 0 };
  ok ? (tally.pass += 1) : (tally.fail += 1);
  byArea.set(c.area, tally);
  if (!ok) {
    failures.push(
      `  ${c.id}  ${c.area} — ${c.scenario}\n` +
      `        expected "${c.expected}", got "${actual}"\n` +
      `        from: ${c.requirement}`,
    );
  }
  results.push([
    c.id, c.area, c.requirement, c.scenario, c.op, c.input, c.expected,
    actual, ok ? "PASS" : "FAIL",
  ]);
}

writeFileSync(
  path.join(ROOT, "test-results.csv"),
  results.map((r) => r.map(csvCell).join(",")).join("\n") + "\n",
  "utf8",
);

const total = cases.length;
const failed = failures.length;

console.log(`\n  ${total} cases from test-cases.csv\n`);
console.log("  AREA                  CASES   PASS   FAIL");
console.log("  " + "-".repeat(42));
for (const [area, t] of Array.from(byArea).sort()) {
  console.log(
    `  ${area.padEnd(20)} ${String(t.pass + t.fail).padStart(6)} ` +
    `${String(t.pass).padStart(6)} ${String(t.fail).padStart(6)}` +
    (t.fail > 0 ? "  <<" : ""),
  );
}
console.log("  " + "-".repeat(42));
console.log(`  ${"TOTAL".padEnd(20)} ${String(total).padStart(6)} ` +
  `${String(total - failed).padStart(6)} ${String(failed).padStart(6)}`);

if (failed > 0) {
  console.log(`\n  ${failed} FAILED\n`);
  for (const f of failures) console.log(f);
}
console.log(`\n  written to test-results.csv\n`);
process.exit(failed === 0 ? 0 : 1);
