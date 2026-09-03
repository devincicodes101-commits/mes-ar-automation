/**
 * What a charge is for, worked out from the free text Description on each
 * invoice line in the AR report.
 *
 * ORDER IS THE SPECIFICATION. First match wins, top to bottom. Several rules
 * are only correct because a more specific one is checked before a more
 * general one, so moving a rule is a change to how money is classified, not a
 * tidy up. Each rule that depends on its position says so.
 *
 * The rules stay in code rather than becoming an editable setting. Occupancy
 * Fee alone is 92% of the value in the sample: a drag handle in the UI would
 * be a way to silently reclassify thousands of dollars with no error and no
 * audit trail. Same reasoning as the note in data.ts about keeping AI away
 * from queue ranking.
 *
 * MES writes this text by hand and new wordings appear monthly. The list will
 * never be complete. The goal is not to get every description right, it is to
 * make anything we got wrong visible within one upload: see `isUnrecognised`.
 */

export interface RevenueRule {
  /** Position in the list, 1 based. Shown in the read only list in Settings. */
  readonly order: number;
  /** The charge type this rule assigns. */
  readonly type: string;
  /** Matched with `includes` against the upper cased description. */
  readonly keywords: readonly string[];
  /** Matched against the whole trimmed description. */
  readonly exact?: string;
  /** Matched against the start of the trimmed description. */
  readonly startsWith?: string;
  /**
   * Matched against the invoice's document number rather than its description.
   * The document number identifies the invoice, and every line on an invoice
   * belongs to it whatever that individual line happens to say.
   */
  readonly document?: RegExp;
  /** Plain English, shown to MES in Settings. */
  readonly means: string;
  /** Why this rule sits at this position. Only where the order is load bearing. */
  readonly ordering?: string;
}

export const REVENUE_RULES: readonly RevenueRule[] = [
  {
    order: 1,
    type: "1FM Maintenance",
    keywords: ["ONEFM", "ONE FM"],
    // The prefix is the dormitory's own code followed by FM, not a JPD one.
    //
    // MES first showed us this as DOCUMENT NUMBER "JPD1FM..." on a tab of the
    // JPD1 workbook, and the pattern was built around JPD because JPD1 was the
    // only dormitory we had ever been sent. The BSD export then arrived headed
    // 1FM, Prefix "DORMFM", Example BSDFM/1598, where DORMFM means the code
    // plus FM rather than the literal word. So JPD1FM, JP1FM, BSDFM and LEOFM
    // are all the same thing and only the first two used to match.
    //
    // On the BSD file the old pattern found 0 of 542. On every older file the
    // new one finds exactly what the old one did, so this only ever adds.
    document: /^[A-Z]+\d*FM/,
    means: "Anything raised through 1FM, whatever the underlying charge is.",
    ordering:
      "First, and it has to be. These descriptions also contain SICKBAY, " +
      "MAINTENANCE, TENANT TRANSFER and REINSTATEMENT, so any of those rules " +
      "placed above would steal them. MES decided 1FM is a revenue type " +
      "rather than a tag, so the route the charge came through wins over " +
      "what the charge is. " +
      "The document number is the reliable half. An invoice carries several " +
      "lines and usually only one of them mentions ONEFM: the VAT and sick " +
      "bay lines on the same invoice say nothing about 1FM in their own text, " +
      "but the invoice number does. Reading descriptions alone found 17 of " +
      "the 45 real 1FM lines. The description test is kept as well, because " +
      "1FM credit notes are numbered JP1CN and the number alone would miss " +
      "those. " +
      "Open with MES: a 1FM invoice also carries VAT and a brought-forward " +
      "opening balance, and this rule being first claims those too. At BSD " +
      "that is $14,400 of the $36,776 it reports, so 1FM is either the whole " +
      "invoice or only the 1FM work on it. Asked, not yet answered. Nothing " +
      "here is arranged around a guess at the answer: if MES say the tax and " +
      "the opening balance stay where they are, the change is to let the VAT " +
      "and Opening Balance rules run before this one.",
  },
  {
    order: 2,
    type: "Late Payment Fee",
    keywords: ["LATE PAYMENT"],
    means: "The admin fee charged monthly while an account stays overdue.",
    ordering:
      "Above Admin Fee. The text reads \"Admin Fee For Late Payment\", so it " +
      "contains both keywords and the looser one must not win. 18 lines.",
  },
  {
    order: 3,
    type: "Rejected GIRO Fee",
    keywords: ["REJECTED GIRO"],
    means: "Charged when a bank deduction bounced.",
    ordering:
      "Above Admin Fee, same reason: the text reads \"Admin Fee For The " +
      "Rejected GIRO\". This is an AR invoice line, not bank data, so it " +
      "survived the DBS removal. See docs/dbs-removal.md.",
  },
  {
    order: 4,
    type: "Cheque Admin Fee",
    keywords: ["CHEQUE"],
    means: "The $50 charged when a tenant pays by cheque.",
    ordering:
      "Above Admin Fee, for the same reason as the two rules above it. MES's " +
      "reminder letter says the charge exists but none has appeared in any " +
      "file they have sent, so the exact wording is unknown. If it were left " +
      "to the fallback it would not reach it: any wording containing \"admin " +
      "fee\" would be swallowed by the Admin Fee rule and filed as a generic admin fee, " +
      "and the unrecognised panel would never mention it. Matching on CHEQUE " +
      "catches it whatever the rest of the sentence says.",
  },
  {
    order: 5,
    type: "Credit Note",
    keywords: ["CREDIT NOTE"],
    means: "A credit raised against the tenant, offsetting what they owe.",
    ordering:
      "Kept as its own type despite appearing once, because the amount is " +
      "negative and money moving the wrong way must not hide inside Other " +
      "Charges where nobody would look for it.",
  },
  {
    order: 6,
    type: "AR Transfer",
    keywords: ["AR TRANSFERRED"],
    means: "A balance moved in from another entity's ledger.",
    ordering: "Same reason as Credit Note: negative, and must stay visible.",
  },
  {
    order: 7,
    type: "VAT",
    keywords: [],
    exact: "VAT",
    startsWith: "VAT",
    means: "Tax charged on another line. The most common description by far.",
    ordering:
      "Exact match or starts with, never contains. 98 lines carry the bare " +
      "word VAT, and a contains rule here would steal every description that " +
      "mentions tax in passing.",
  },
  {
    order: 8,
    type: "Occupancy Fee",
    keywords: ["OCCUPANCY FEE"],
    means: "The core bed rental charge.",
    ordering:
      "92% of all value in the sample. Any change that moves this is a " +
      "serious change and the reconciliation test will catch it.",
  },
  {
    order: 9,
    type: "Service & Conservancy",
    keywords: ["SERVICE & CONSERVANCY"],
    means: "Shared services and upkeep of common areas.",
  },
  {
    order: 10,
    type: "Furniture & Fittings",
    keywords: ["FURNITURE"],
    means: "Beds, lockers and fittings supplied with the room.",
  },
  {
    order: 11,
    type: "CREAM Services",
    keywords: ["CREAM SERVICE"],
    means: "Cleaning, repair and maintenance package.",
    ordering:
      "Singular CREAM SERVICE, so it catches both \"CREAM Services\" and " +
      "\"CREAM Services Charges\".",
  },
  {
    order: 12,
    type: "Security Deposit",
    keywords: ["SECURITY DEPOSIT"],
    means: "Refundable deposit held against the tenancy.",
  },
  {
    order: 13,
    type: "Season Parking",
    keywords: ["SEASON PARKING"],
    means: "Quarterly vehicle parking charges.",
  },
  {
    order: 14,
    type: "Stamp Duty",
    keywords: ["STAMP DUTY"],
    means: "Reimbursement of duty paid on the tenancy agreement.",
  },
  {
    order: 15,
    type: "Sick Bay",
    keywords: ["SICK BAY", "SICKBAY"],
    means: "Use of the on site sick bay.",
    ordering:
      "Below 1FM on purpose. A sick bay admission raised through 1FM is " +
      "classified 1FM, while a direct \"Sick Bay Usage\" line lands here. Same " +
      "real world charge, two types, which is the correct outcome of MES's " +
      "decision to treat 1FM as a revenue type. Do not \"fix\" it.",
  },
  {
    order: 16,
    type: "Maintenance",
    keywords: ["MAINTENANCE"],
    means: "Repairs and replacements billed directly.",
    ordering:
      "Near the bottom so that 1FM maintenance, which is most of it, is " +
      "claimed by rule 1 first. Only direct maintenance reaches here.",
  },
  {
    order: 17,
    type: "Issuance Fee",
    keywords: ["ISSUANCE FEE"],
    means: "One off charge for bed board, storage box, bin and broom.",
  },
  {
    order: 18,
    type: "Opening Balance",
    keywords: ["OPENING BALANCE"],
    means: "Balance carried in when the account was opened in NetSuite.",
  },
  {
    order: 19,
    type: "Admin Fee",
    keywords: ["ADMIN FEE", "ADMINISTRATION FEE"],
    means: "General administration charge.",
    ordering:
      "Second to last, because it is the loosest fee keyword in the list. " +
      "Both spellings are matched: ADMIN FEE is not a substring of " +
      "ADMINISTRATION FEE, and MES uses both.",
  },
  {
    order: 20,
    type: "Other Charges",
    keywords: [],
    exact: "OTHER CHARGES",
    means: "MES's own catch all label, written deliberately on the invoice.",
    ordering:
      "Explicit, not the fallback. 33 lines are literally the words \"Other " +
      "Charges\", which is MES classifying the line themselves rather than us " +
      "failing to. Keeping it separate is what lets the fallback below mean " +
      "\"we do not recognise this\" and be worth showing after an upload.",
  },
] as const;

/** Everything that matched no rule. Same type as rule 19, different meaning. */
export const FALLBACK_TYPE = "Other Charges";

/** Upper cased, whitespace collapsed. Descriptions are hand typed. */
export function normaliseDescription(description: string): string {
  return String(description ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .toUpperCase();
}

/**
 * The first rule that claims this line, or null if none does.
 *
 * `documentNumber` is optional so a description can still be classified on its
 * own, which is what the rule table is tested against. Pass it wherever it is
 * available: it is the difference between finding 17 of the 45 real 1FM lines
 * and finding all of them.
 */
export function matchRule(
  description: string,
  documentNumber?: string,
): RevenueRule | null {
  const d = normaliseDescription(description);
  const doc = normaliseDescription(documentNumber ?? "");
  for (const rule of REVENUE_RULES) {
    if (rule.document && doc !== "" && rule.document.test(doc)) return rule;
    if (rule.exact && d === rule.exact) return rule;
    if (rule.startsWith && d.startsWith(rule.startsWith)) return rule;
    if (rule.keywords.some((k) => d.includes(k))) return rule;
  }
  return null;
}

/* ------------------------------------------------- MES's own Categories ---
 * The aging detail export carries a Categories column: NetSuite's own answer
 * to the question these rules exist to guess at. It is translated onto our
 * names rather than used as written, because the two spellings collide.
 * "Security deposit" is not "Security Deposit", and the deposit report does an
 * exact match, so their casing would empty it with no error at all. Their
 * "Occupancy Fee Charges" against our "Occupancy Fee" would split $1.4m over
 * two rows of the revenue report.
 *
 * It is a fallback and not the primary source, which is the opposite of what
 * it looks like it should be. Their categories are coarser than these rules in
 * the places MES's own reports need detail: their Admin fee holds 48 lines
 * that are 12 admin fees, 27 late payment fees and 9 rejected GIRO fees, and
 * they have asked us for a late payment report their own column cannot
 * produce. Their Reimbursement is five stamp duty reimbursements, and they
 * have a stamp duty tab too.
 *
 * Where these rules do claim a line it wins. Where they do not, this fills the
 * gap: on the BSD export that is 10 lines, 7 vending machine commissions and 3
 * bad debt write offs, neither of which we had any rule for.
 */
export const MES_CATEGORY_TYPES: Record<string, string> = {
  "OCCUPANCY FEE CHARGES": "Occupancy Fee",
  "SERVICE & CONSERVANCY CHARGES": "Service & Conservancy",
  "FURNITURE & FITTINGS CHARGES": "Furniture & Fittings",
  "CREAM SERVICES CHARGES": "CREAM Services",
  "VAT": "VAT",
  "OPENING BALANCE - AR": "Opening Balance",
  "ADMIN FEE": "Admin Fee",
  "SECURITY DEPOSIT": "Security Deposit",
  "ONE-TIME ISSUANCE FEE": "Issuance Fee",
  "SICK BAY/ISOLATION": "Sick Bay",
  "MAINTENANCE WORKS": "Maintenance",
  // The five with no rule of their own. Tenant Transfer and Unit
  // Reinstatement are invisible on the BSD file only because they all sit on
  // 1FM invoices and rule 1 claims those; they appear the moment MES answer
  // whether 1FM means the whole invoice or only the 1FM work on it.
  "TENANT TRANSFER": "Tenant Transfer",
  "UNIT REINSTATEMENT WORKS": "Unit Reinstatement",
  "COMMISSION": "Commission",
  "REIMBURSEMENT": "Reimbursement",
  "BAD DEBTS": "Bad Debt",
};

/** MES's category translated onto our naming, or null if we do not know it. */
export function typeForCategory(category?: string): string | null {
  const key = normaliseDescription(category ?? "");
  if (key === "") return null;
  return MES_CATEGORY_TYPES[key] ?? null;
}

/**
 * Works out what a charge is for.
 *
 * Three sources, in this order:
 *
 *   1. the invoice number, for 1FM, which MES gave us as an explicit rule
 *   2. these rules, read off the description
 *   3. MES's own Categories column, where the rules found nothing
 *
 * The first two are `matchRule`. The third only ever fills a gap, never
 * overrides, for the reasons on MES_CATEGORY_TYPES above.
 */
export function revenueType(
  description: string,
  documentNumber?: string,
  category?: string,
): string {
  const rule = matchRule(description, documentNumber);
  if (rule) return rule.type;
  return typeForCategory(category) ?? FALLBACK_TYPE;
}

/**
 * MES's category disagrees with what our rules made of the same line.
 *
 * Not an error. It is a short list somebody can actually read, and every item
 * on it is one of three things: our rule is wrong, their category is broader
 * than ours, or it is a real question. Finding that their Admin fee was three
 * different charges came from reading this list rather than 3,117 rows.
 *
 * Lines our rules did not claim are excluded: those are gaps being filled, not
 * disagreements. So are lines with no category, which the older exports are
 * entirely made of.
 */
export function categoryDisagrees(
  description: string,
  documentNumber?: string,
  category?: string,
): boolean {
  const theirs = typeForCategory(category);
  if (theirs === null) return false;
  const rule = matchRule(description, documentNumber);
  if (rule === null) return false;
  return rule.type !== theirs;
}

/**
 * Whether this line is 1FM, which routes it to the maintenance team rather
 * than to collections. Same answer as revenueType, expressed as a flag because
 * that is what the screens filter on.
 */
export function isOneFm(description: string, documentNumber?: string): boolean {
  return matchRule(description, documentNumber)?.type === "1FM Maintenance";
}

/**
 * True when no rule claimed the description, so it fell through to the
 * fallback rather than being classified.
 *
 * This is what the Upload screen reports. A line reading "Other Charges"
 * because MES wrote those words is not a miss and must not be reported as
 * one, or the panel cries wolf on every upload and gets ignored by month two.
 */
export function isUnrecognised(description: string): boolean {
  return matchRule(description) === null;
}

/**
 * Descriptions no rule claimed, counted and ordered by how often they appear,
 * so the keyword list grows from real misses rather than guesses.
 */
export function unrecognisedDescriptions(
  descriptions: readonly string[],
): { description: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const raw of descriptions) {
    if (!isUnrecognised(raw)) continue;
    const d = normaliseDescription(raw);
    counts.set(d, (counts.get(d) ?? 0) + 1);
  }
  return Array.from(counts, ([description, count]) => ({ description, count }))
    .sort((a, b) => b.count - a.count || a.description.localeCompare(b.description));
}
