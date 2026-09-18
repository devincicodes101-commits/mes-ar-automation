/**
 * Reading two reports the way MES read them.
 *
 *   npm run test:movement
 *
 * The rule under test is theirs, and it is not what anybody would guess:
 *
 *   absent from the newer report  means paid in full
 *   a smaller balance             means part paid
 *   never do cross-file arithmetic
 *
 * Getting the first one backwards would make every settled tenant look like a
 * parsing fault, or worse, leave them on the call list after they have paid.
 * That is the single most embarrassing thing this system could do: ring a
 * company to chase money they have already sent.
 */
import { chronic, compareReports, summarise, type Snapshot } from "../src/lib/movement.ts";
import type { Account, PropertyCode } from "../src/lib/types.ts";

let failures = 0;
function check(name: string, actual: unknown, expected: unknown) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures += 1;
  console.log(
    `  ${ok ? "PASS" : "FAIL"}  ${name.slice(0, 64).padEnd(64)} ` +
      (ok ? "" : `got ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)}`),
  );
}

/** A tenant owing a given amount, sitting in a given bucket. */
function tenant(
  code: string,
  total: number,
  bucket: "current" | "d30" | "d60" | "d90" | "d90plus" = "current",
): Account {
  const buckets = { current: 0, d30: 0, d60: 0, d90: 0, d90plus: 0 };
  buckets[bucket] = total;
  return {
    id: `${code.toLowerCase()}-bsd`,
    customerCode: code,
    companyName: `${code} PTE LTD`,
    property: "BSD" as PropertyCode,
    propertyName: "Blue Stars Dormitory",
    status: "Live",
    buckets,
    total,
    legacyNote: null,
    emails: ["a@b.com"],
    hasContact: true,
    industry: null,
    entity: null,
    invoiceCount: 1,
    isOneFm: false,
    revenueTypes: [],
    lateFeeCount: 0,
  };
}

const find = (ms: ReturnType<typeof compareReports>, code: string) =>
  ms.find((m) => m.customerCode === code);

/* ------------------------------------------------------ disappearing ----- */

console.log("\nA tenant who vanishes has paid, not gone missing\n");

const before = [tenant("A", 1000), tenant("B", 2000), tenant("C", 500)];
const after = [tenant("A", 1000), tenant("B", 800)];

const moved = compareReports(before, after);

check("everyone from both reports appears", moved.length, 3);
check("the one who vanished is settled", find(moved, "C")?.direction, "settled");
check("and what they owed is remembered", find(moved, "C")?.before, 500);
check("with nothing owing now", find(moved, "C")?.after, null);

/*
 * The mistake this prevents: a settled tenant staying on the call list. If
 * "settled" were read as "missing", C would be chased for money already paid.
 */
check("a settled tenant counts as recovered, never as worse",
      find(moved, "C")?.aged, false);

/* ------------------------------------------------------- part paying ----- */

console.log("\nA smaller balance is part paid, and is not a payment figure\n");

check("B went down", find(moved, "B")?.direction, "down");
check("by the difference", find(moved, "B")?.changedBy, -1200);

/*
 * The cross-file arithmetic trap. A balance that fell by 1,200 does not mean
 * 1,200 arrived: they may have paid 5,000 and been billed 3,800 in between.
 * Nothing here is allowed to call this a payment.
 */
check("and nothing in the record claims an amount was paid",
      Object.keys(find(moved, "B") ?? {}).some((k) => /paid|payment/i.test(k)),
      false);

check("A did not move", find(moved, "A")?.direction, "same");
check("and its change is exactly zero", find(moved, "A")?.changedBy, 0);

/* ------------------------------------------------------------- worse ----- */

console.log("\nGetting worse, in money and in age\n");

const grew = compareReports([tenant("D", 100)], [tenant("D", 900)]);
check("a bigger balance is up", find(grew, "D")?.direction, "up");
check("by the difference", find(grew, "D")?.changedBy, 800);

// The same money, one bucket older. The amount did not change at all.
const aged = compareReports([tenant("E", 500, "d30")], [tenant("E", 500, "d60")]);
check("money that aged is flagged even though the amount is the same",
      find(aged, "E")?.aged, true);
check("and it is not reported as owing more", find(aged, "E")?.direction, "same");
check("the buckets are named either side",
      [find(aged, "E")?.bucketBefore, find(aged, "E")?.bucketAfter],
      ["30 days", "60 days"]);

const better = compareReports([tenant("F", 500, "d90")], [tenant("F", 500, "d30")]);
check("and money that moved to a newer bucket is recovery",
      [find(better, "F")?.aged, find(better, "F")?.recovered], [false, true]);

/* --------------------------------------------------------------- new ----- */

console.log("\nSomebody new owes nothing before\n");

const fresh = compareReports([tenant("A", 100)], [tenant("A", 100), tenant("Z", 700)]);
check("they are new", find(fresh, "Z")?.direction, "new");
check("with no before", find(fresh, "Z")?.before, null);
/*
 * Not zero. Zero would say they were there owing nothing, which is a different
 * fact from not having been there, and would let a screen subtract from it.
 */
check("and no change, because there is nothing to change from",
      find(fresh, "Z")?.changedBy, null);

/* ------------------------------------------------------------ order ----- */

console.log("\nThe worst news is at the top\n");

const mixed = compareReports(
  [tenant("W", 100), tenant("X", 5000), tenant("Y", 300)],
  [tenant("W", 900), tenant("X", 100), tenant("Y", 300)],
);
check("the tenant who got worse is first", mixed[0]?.customerCode, "W");
check("and the one who paid most is not", mixed[0]?.direction, "up");

/* ---------------------------------------------------------- headline ---- */

console.log("\nThe headline counts and the totals are separate questions\n");

const s = summarise(moved, before, after);

check("one settled", s.settled, 1);
check("one part paid", s.paidSomething, 1);
check("none got worse", s.worse, 0);
check("the book was 3,500 before", s.totalBefore, 3500);
check("and 1,800 after", s.totalAfter, 1800);

// 500 settled plus 1,200 off B's balance.
check("money that left the book", s.balanceDown, 1700);
check("and none was added", s.balanceUp, 0);

/*
 * One large tenant can move the totals while almost nobody pays, which is why
 * the counts and the money are reported side by side rather than one standing
 * in for the other.
 */
const lopsided = summarise(
  compareReports([tenant("BIG", 100000), tenant("S", 50)], [tenant("BIG", 1), tenant("S", 50)]),
  [tenant("BIG", 100000), tenant("S", 50)],
  [tenant("BIG", 1), tenant("S", 50)],
);
check("one tenant paying does not read as everybody paying", lopsided.paidSomething, 1);
check("even when the money is nearly all of it", lopsided.balanceDown, 99999);

/* ----------------------------------------------------------- chronic ---- */

console.log("\nStuck in the same place, report after report\n");

const snaps: Snapshot[] = [
  { reportDate: "2026-06-16", accounts: [tenant("P", 900, "d90plus"), tenant("Q", 100, "d90plus")] },
  { reportDate: "2026-07-16", accounts: [tenant("P", 900, "d90plus"), tenant("Q", 100, "current")] },
  { reportDate: "2026-08-16", accounts: [tenant("P", 900, "d90plus"), tenant("Q", 100, "d90plus")] },
];

const stuck = chronic(snaps, { atLeast: 3, from: "60 days" });

check("the tenant stuck across all three is found", stuck.map((c) => c.customerCode), ["P"]);
check("and it says how many reports", stuck[0]?.reports, 3);
check("naming them, newest first", stuck[0]?.since,
      ["2026-08-16", "2026-07-16", "2026-06-16"]);

/*
 * Q was in 90+ in June and again in August, with a clear month between. That
 * is not chronic, and counting it as three would put the wrong name at the top
 * of a list somebody works down.
 */
check("a run that broke does not count as chronic",
      stuck.some((c) => c.customerCode === "Q"), false);

// A tenant absent from a report has settled, which ends a run for the same
// reason: they are the opposite of chronically behind.
const gapped = chronic(
  [
    { reportDate: "2026-06-16", accounts: [tenant("R", 100, "d90plus")] },
    { reportDate: "2026-07-16", accounts: [] },
    { reportDate: "2026-08-16", accounts: [tenant("R", 100, "d90plus")] },
  ],
  { atLeast: 2, from: "60 days" },
);
check("and neither does one broken by settling", gapped.length, 0);

check("a shorter run is excluded at the threshold",
      chronic(snaps, { atLeast: 4, from: "60 days" }).length, 0);
check("and included below it",
      chronic(snaps, { atLeast: 2, from: "60 days" }).map((c) => c.customerCode), ["P"]);

// Current and 30 days are not what "chronic" means to a collections officer.
check("somebody merely current is never chronic",
      chronic([{ reportDate: "2026-08-16", accounts: [tenant("T", 10)] }],
              { atLeast: 1, from: "60 days" }).length, 0);

check("no snapshots is empty rather than an error", chronic([]).length, 0);

console.log(failures === 0 ? "\nALL CHECKS PASS\n" : `\n${failures} FAILED\n`);
process.exit(failures === 0 ? 0 : 1);
