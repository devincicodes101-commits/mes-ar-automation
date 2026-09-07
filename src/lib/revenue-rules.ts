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
  /**
   * Matched against MES's own Categories column, exactly, case insensitively.
   *
   * The September export tags every line with what it is for, which is a
   * better signal than the description text because MES pick it from a list
   * rather than typing it. It is checked last within a rule, not first, so
   * that the document number still decides 1FM: a 1FM maintenance line is
   * categorised "Maintenance Works", and category-first would file it as
   * ordinary maintenance and take it off the 1FM report.
   */
  readonly categories?: readonly string[];
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
    // MES's note on the September export reads: 1FM = Prefix "DORMFM", worked
    // example BSDFM/1598. The prefix is the dormitory code with FM after it,
    // so every dormitory has its own: BSDFM, JPD1FM, JPD2FM, LEOFM. Their
    // older exports abbreviate JPD1 to JP1, so the D is optional.
    //
    // This regex used to read /^JPD?\d*FM/, which only ever matched the JPD
    // dormitories. On the August export, which is entirely Blue Stars, that
    // found 98 of the 542 real 1FM lines: only the ones whose description
    // happened to say ONEFM. The other 444, including every VAT line on a
    // 1FM invoice, were filed as ordinary charges and were missing from the
    // 1FM report altogether.
    document: /^(JPD?[12]|BSD|LEO)FM\b/,
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
      "those.",
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
    categories: ["VAT"],
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
    categories: ["Occupancy Fee Charges"],
    means: "The core bed rental charge.",
    ordering:
      "92% of all value in the sample. Any change that moves this is a " +
      "serious change and the reconciliation test will catch it.",
  },
  {
    order: 9,
    type: "Service & Conservancy",
    keywords: ["SERVICE & CONSERVANCY"],
    categories: ["Service & Conservancy Charges"],
    means: "Shared services and upkeep of common areas.",
  },
  {
    order: 10,
    type: "Furniture & Fittings",
    keywords: ["FURNITURE"],
    categories: ["Furniture & Fittings Charges"],
    means: "Beds, lockers and fittings supplied with the room.",
  },
  {
    order: 11,
    type: "CREAM Services",
    keywords: ["CREAM SERVICE"],
    categories: ["CREAM Services Charges"],
    means: "Cleaning, repair and maintenance package.",
    ordering:
      "Singular CREAM SERVICE, so it catches both \"CREAM Services\" and " +
      "\"CREAM Services Charges\".",
  },
  {
    order: 12,
    type: "Security Deposit",
    keywords: ["SECURITY DEPOSIT"],
    categories: ["Security deposit"],
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
    type: "Tenant Transfer",
    keywords: ["TENANT TRANSFER"],
    categories: ["Tenant Transfer"],
    means: "Moving a tenant's workers between rooms or blocks.",
    ordering:
      "Below 1FM, like Sick Bay and Maintenance. Most transfers are raised " +
      "through 1FM and belong on that report; only a transfer billed " +
      "directly reaches here.",
  },
  {
    order: 16,
    type: "Unit Reinstatement",
    keywords: ["REINSTATEMENT"],
    categories: ["Unit reinstatement works"],
    means: "Making a room good again after a tenant vacates it.",
    ordering: "Below 1FM, same reason as Tenant Transfer.",
  },
  {
    order: 17,
    type: "Commission",
    keywords: ["COMMISSION"],
    categories: ["Commission"],
    means: "Vending machine and similar concession income billed on.",
  },
  {
    order: 18,
    type: "Bad Debt Written Off",
    keywords: ["BAD DEBT"],
    categories: ["Bad debts"],
    means: "A balance MES has given up on and written out of the ledger.",
    ordering:
      "Its own type rather than Other Charges. The amount is negative and " +
      "large, and a write off appearing inside a catch all would look like a " +
      "credit note or a mis-read row. It also must never be chased: an " +
      "account whose balance is a write off is not a collections case.",
  },
  {
    order: 19,
    type: "Sick Bay",
    keywords: ["SICK BAY", "SICKBAY"],
    categories: ["Sick bay/Isolation"],
    means: "Use of the on site sick bay.",
    ordering:
      "Below 1FM on purpose. A sick bay admission raised through 1FM is " +
      "classified 1FM, while a direct \"Sick Bay Usage\" line lands here. Same " +
      "real world charge, two types, which is the correct outcome of MES's " +
      "decision to treat 1FM as a revenue type. Do not \"fix\" it.",
  },
  {
    order: 20,
    type: "Maintenance",
    keywords: ["MAINTENANCE"],
    categories: ["Maintenance Works"],
    means: "Repairs and replacements billed directly.",
    ordering:
      "Near the bottom so that 1FM maintenance, which is most of it, is " +
      "claimed by rule 1 first. Only direct maintenance reaches here.",
  },
  {
    order: 21,
    type: "Issuance Fee",
    keywords: ["ISSUANCE FEE"],
    categories: ["One-time issuance fee"],
    means: "One off charge for bed board, storage box, bin and broom.",
  },
  {
    order: 22,
    type: "Opening Balance",
    keywords: ["OPENING BALANCE"],
    categories: ["Opening Balance - AR"],
    means: "Balance carried in when the account was opened in NetSuite.",
  },
  {
    order: 23,
    type: "Admin Fee",
    keywords: ["ADMIN FEE", "ADMINISTRATION FEE"],
    categories: ["Admin fee"],
    means: "General administration charge.",
    ordering:
      "Second to last, because it is the loosest fee keyword in the list. " +
      "Both spellings are matched: ADMIN FEE is not a substring of " +
      "ADMINISTRATION FEE, and MES uses both.",
  },
  {
    order: 24,
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
  category?: string,
): RevenueRule | null {
  const d = normaliseDescription(description);
  const doc = normaliseDescription(documentNumber ?? "");
  const cat = normaliseDescription(category ?? "");
  for (const rule of REVENUE_RULES) {
    if (rule.document && doc !== "" && rule.document.test(doc)) return rule;
    if (rule.exact && d === rule.exact) return rule;
    if (rule.startsWith && d.startsWith(rule.startsWith)) return rule;
    if (rule.keywords.some((k) => d.includes(k))) return rule;
    if (cat !== "" && rule.categories?.some((c) => normaliseDescription(c) === cat))
      return rule;
  }
  return null;
}

/** Works out what a charge is for, from the description and invoice number. */
export function revenueType(
  description: string,
  documentNumber?: string,
  category?: string,
): string {
  return matchRule(description, documentNumber, category)?.type ?? FALLBACK_TYPE;
}

/**
 * Whether this line is 1FM, which routes it to the maintenance team rather
 * than to collections. Same answer as revenueType, expressed as a flag because
 * that is what the screens filter on.
 */
export function isOneFm(
  description: string,
  documentNumber?: string,
  category?: string,
): boolean {
  return (
    matchRule(description, documentNumber, category)?.type === "1FM Maintenance"
  );
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
  // A blank description is not an unrecognised one. There is nothing there to
  // recognise, and nothing a keyword could ever be grown from, so reporting it
  // is noise in the one panel that has to stay worth reading.
  //
  // MES's September export has three: they are Payment rows, the receipts
  // numbered REC-BSD367 and friends, and a receipt has no description by
  // nature. They still classify as Other Charges and still carry their amount,
  // which is what the reconciliation test checks.
  if (normaliseDescription(description) === "") return false;
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
