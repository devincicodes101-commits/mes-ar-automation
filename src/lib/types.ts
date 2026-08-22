export type PropertyCode = "JPD1" | "JPD2" | "BSD" | "LEO";

export type AccountStatus = "Live" | "Terminated";

export type BucketKey = "current" | "d30" | "d60" | "d90" | "d90plus";

export const BUCKETS: { key: BucketKey; label: string; ramp: number }[] = [
  { key: "current", label: "Current", ramp: 1 },
  { key: "d30", label: "30 days", ramp: 2 },
  { key: "d60", label: "60 days", ramp: 3 },
  { key: "d90", label: "90 days", ramp: 4 },
  { key: "d90plus", label: "90+ days", ramp: 5 },
];

/** Follow-up begins once a balance crosses 30 days. MES SOP 1.3. */
export const TRIGGER_BUCKET: BucketKey = "d30";

export interface Buckets {
  current: number;
  d30: number;
  d60: number;
  d90: number;
  d90plus: number;
}

export interface Account {
  id: string;
  customerCode: string;
  companyName: string;
  /** An account is company + property. The same company can rent in two dormitories. */
  property: PropertyCode;
  propertyName: string;
  status: AccountStatus;
  buckets: Buckets;
  total: number;
  /** Free-text promise typed into the old spreadsheet's Update column. */
  legacyNote: string | null;
  emails: string[];
  hasContact: boolean;
  industry: string | null;
  entity: string | null;
  invoiceCount: number;
  isOneFm: boolean;
  revenueTypes: string[];
  lateFeeCount: number;
}

export interface Invoice {
  id: string;
  companyName: string;
  transactionType: string;
  date: string | null;
  dueDate: string | null;
  description: string;
  documentNumber: string;
  linkedContract: string | null;
  age: number | null;
  bucket: string;
  openBalance: number;
  revenueType: string;
  isOneFm: boolean;
}

export interface Contact {
  companyName: string;
  emails: string[];
}

export interface IndustryRow {
  customerCode: string | null;
  companyName: string;
  industry: string;
  entity: string;
  property: string;
}

export interface ArData {
  generatedFrom: string[];
  asOfSummary: string;
  asOfDetail: string;
  properties: { code: PropertyCode; name: string }[];
  accounts: Account[];
  invoices: Invoice[];
  contacts: Contact[];
  industries: IndustryRow[];
}

/**
 * Why an account is sitting in the collections queue.
 *
 * Every reason is derived from the AR report. The two GIRO reasons that used
 * to sit here were removed with the DBS upload: see docs/dbs-removal.md.
 */
export type QueueReason =
  | "repeat-late-fees"
  | "aging-30"
  | "aging-90"
  | "promise-broken"
  | "no-contact";

export interface QueueItem {
  account: Account;
  reasons: QueueReason[];
  priority: number;
  overdue: number;
}
