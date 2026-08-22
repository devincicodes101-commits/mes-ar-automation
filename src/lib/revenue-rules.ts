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
    means: "Anything raised through 1FM, whatever the underlying charge is.",
    ordering:
      "First, and it has to be. These descriptions also contain SICKBAY, " +
      "MAINTENANCE, TENANT TRANSFER and REINSTATEMENT, so any of those rules " +
      "placed above would steal them. MES decided 1FM is a revenue type " +
      "rather than a tag, so the route the charge came through wins over " +
      "what the charge is.",
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
    type: "Credit Note",
    keywords: ["CREDIT NOTE"],
    means: "A credit raised against the tenant, offsetting what they owe.",
    ordering:
      "Kept as its own type despite appearing once, because the amount is " +
      "negative and money moving the wrong way must not hide inside Other " +
      "Charges where nobody would look for it.",
  },
  {
    order: 5,
    type: "AR Transfer",
    keywords: ["AR TRANSFERRED"],
    means: "A balance moved in from another entity's ledger.",
    ordering: "Same reason as Credit Note: negative, and must stay visible.",
  },
  {
    order: 6,
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
    order: 7,
    type: "Occupancy Fee",
    keywords: ["OCCUPANCY FEE"],
    means: "The core bed rental charge.",
    ordering:
      "92% of all value in the sample. Any change that moves this is a " +
      "serious change and the reconciliation test will catch it.",
  },
  {
    order: 8,
    type: "Service & Conservancy",
    keywords: ["SERVICE & CONSERVANCY"],
    means: "Shared services and upkeep of common areas.",
  },
  {
    order: 9,
    type: "Furniture & Fittings",
    keywords: ["FURNITURE"],
    means: "Beds, lockers and fittings supplied with the room.",
  },
  {
    order: 10,
    type: "CREAM Services",
    keywords: ["CREAM SERVICE"],
    means: "Cleaning, repair and maintenance package.",
    ordering:
      "Singular CREAM SERVICE, so it catches both \"CREAM Services\" and " +
      "\"CREAM Services Charges\".",
  },
  {
    order: 11,
    type: "Security Deposit",
    keywords: ["SECURITY DEPOSIT"],
    means: "Refundable deposit held against the tenancy.",
  },
  {
    order: 12,
    type: "Season Parking",
    keywords: ["SEASON PARKING"],
    means: "Quarterly vehicle parking charges.",
  },
  {
    order: 13,
    type: "Stamp Duty",
    keywords: ["STAMP DUTY"],
    means: "Reimbursement of duty paid on the tenancy agreement.",
  },
  {
    order: 14,
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
    order: 15,
    type: "Maintenance",
    keywords: ["MAINTENANCE"],
    means: "Repairs and replacements billed directly.",
    ordering:
      "Near the bottom so that 1FM maintenance, which is most of it, is " +
      "claimed by rule 1 first. Only direct maintenance reaches here.",
  },
  {
    order: 16,
    type: "Issuance Fee",
    keywords: ["ISSUANCE FEE"],
    means: "One off charge for bed board, storage box, bin and broom.",
  },
  {
    order: 17,
    type: "Opening Balance",
    keywords: ["OPENING BALANCE"],
    means: "Balance carried in when the account was opened in NetSuite.",
  },
  {
    order: 18,
    type: "Admin Fee",
    keywords: ["ADMIN FEE", "ADMINISTRATION FEE"],
    means: "General administration charge.",
    ordering:
      "Second to last, because it is the loosest fee keyword in the list. " +
      "Both spellings are matched: ADMIN FEE is not a substring of " +
      "ADMINISTRATION FEE, and MES uses both.",
  },
  {
    order: 19,
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

/** The first rule that claims this description, or null if none does. */
export function matchRule(description: string): RevenueRule | null {
  const d = normaliseDescription(description);
  for (const rule of REVENUE_RULES) {
    if (rule.exact && d === rule.exact) return rule;
    if (rule.startsWith && d.startsWith(rule.startsWith)) return rule;
    if (rule.keywords.some((k) => d.includes(k))) return rule;
  }
  return null;
}

/** Works out what a charge is for, from the free text description. */
export function revenueType(description: string): string {
  return matchRule(description)?.type ?? FALLBACK_TYPE;
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
