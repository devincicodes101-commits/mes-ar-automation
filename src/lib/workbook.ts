import * as XLSX from "xlsx";

import type { Report, ReportBlock, ReportColumn } from "./reports.ts";

/**
 * A report as the workbook MES actually attach to an email.
 *
 * ---------------------------------------------------------------------------
 * Why a spreadsheet and not the CSV we already had
 *
 * Jacqueline's email carries "Ray's Clients by dorm as of Aug 26.xlsx". A CSV
 * is not that file. It loses the block structure — her workbook is three
 * headed sections, one per consolidation, each repeating the column row — and
 * it loses the heading lines that say which entity and which date the figures
 * are for. A manager opening a flat CSV would have to be told what he was
 * looking at, which is the opposite of the point.
 *
 * ---------------------------------------------------------------------------
 * Laid out from their own mock-up
 *
 * Reading down Ray's file, every block is:
 *
 *     Mini Environment Service Pte Ltd
 *     Consol : Mini Environment Service Pte Ltd : KT Mesdorm Pte Ltd
 *     As of 27 August 2026
 *                              August
 *     Company Name   Status   Current   30 days ...   Update   ...   Sales Rep
 *     DORM-849 TONG CONSTRUCTION PTE. LTD.   Live   1,765.28 ...
 *
 * then three blank rows before the next. The month sits on its own row above
 * the bucket columns, which is why row four is mostly empty.
 *
 * ---------------------------------------------------------------------------
 * Numbers stay numbers
 *
 * Written as numbers with a format, not as the strings the screen shows. A
 * manager who sums the Overdue column must get a total, and MES's own file
 * carries live numbers. Writing "1,765.28" as text gives a column that looks
 * right and adds up to zero, which is the sort of wrong nobody checks.
 *
 * Empty cells are left genuinely empty rather than written as 0. Ray's
 * mock-up has gaps where a tenant has nothing in a bucket, and a zero is a
 * different statement from a blank: one says the bucket was measured and came
 * to nothing.
 */

/** MES write dates as "27 August 2026" in these headings. */
const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

export function longDate(iso: string | null): string {
  if (!iso) return "";
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!m) return iso;
  return `${Number(m[3])} ${MONTHS[Number(m[2]) - 1] ?? m[2]} ${m[1]}`;
}

/** The month the buckets are counted in, which heads the column group. */
function monthOf(iso: string | null): string {
  if (!iso) return "";
  const m = /^\d{4}-(\d{2})/.exec(iso);
  return m ? (MONTHS[Number(m[1]) - 1] ?? "") : "";
}

const MONEY = "#,##0.00";

type Cell = string | number | null;

function blockRows(
  block: ReportBlock,
  report: Report,
  monthColumn: number,
): { rows: Cell[][]; moneyColumns: Set<number> } {
  const cols = block.columns;
  const money = new Set<number>();
  cols.forEach((c, i) => {
    if (c.kind === "money" || c.kind === "number") money.add(i);
  });

  const blank = (): Cell[] => cols.map(() => null);

  const heading = (text: string): Cell[] => {
    const row = blank();
    row[0] = text;
    return row;
  };

  const rows: Cell[][] = [
    heading(report.entity ?? "MES Group"),
    /* The dormitory belongs on this line, not only in the filename. Their
       blocks are headed by consolidation because theirs split by entity;
       ours split by dormitory, and heading every block with the same entity
       line would make four sections that look identical and are not. */
    heading(
      block.subtitle
        ? `Consol : ${block.subtitle} : ${block.title}`
        : `Consol : ${block.title}`,
    ),
    heading(`As of ${longDate(report.asOf)}`),
  ];

  /* The month, over the bucket columns rather than in the first cell. It is
     the one row in MES's layout that is not left aligned, and getting it wrong
     makes the file read as a different document. */
  const monthRow = blank();
  if (monthColumn >= 0) monthRow[monthColumn] = monthOf(report.asOf);
  rows.push(monthRow);

  rows.push(cols.map((c) => c.label));

  for (const r of block.rows) {
    rows.push(
      cols.map((c) => {
        const v = r[c.key];
        if (v === null || v === undefined || v === "") return null;
        /*
         * A zero bucket is written as an empty cell, which is what MES's own
         * file does: HONG HAN's 60, 90 and 90-plus columns are blank rather
         * than 0.00. In an aging column the two say the same thing, and a
         * grid of 0.00 where theirs has white space reads as a different
         * document at a glance.
         *
         * Money only. A zero in a count would be a real answer.
         */
        if (c.kind === "money" && v === 0) return null;
        return v;
      }),
    );
  }

  return { rows, moneyColumns: money };
}

/**
 * One sheet carrying every block, stacked the way MES stack them.
 *
 * One sheet rather than one per block, because that is what Ray's file does:
 * three consolidations down a single Sheet1, separated by blank rows. Harry's
 * is split into tabs per dormitory instead, and both layouts exist in the same
 * folder, so this follows the one whose blocks carry the Update column.
 */
export function reportToWorkbook(report: Report): XLSX.WorkBook {
  const wb = XLSX.utils.book_new();
  const all: Cell[][] = [];
  const moneyColumns = new Set<number>();
  let widest: ReportColumn[] = [];

  for (const block of report.blocks) {
    if (block.columns.length > widest.length) widest = block.columns;
    const monthColumn = block.columns.findIndex((c) => c.key === "current");
    const built = blockRows(block, report, monthColumn);
    for (const c of Array.from(built.moneyColumns)) moneyColumns.add(c);
    all.push(...built.rows);
    /* Three blank rows between blocks, as in the mock-up. Two would look like
       a mistake and none would run the sections together. */
    all.push([], [], []);
  }

  const ws = XLSX.utils.aoa_to_sheet(all as unknown[][]);

  /* A number format on the money columns, applied per cell because a sheet
     built from an array of arrays carries no column styling. */
  const range = XLSX.utils.decode_range(ws["!ref"] ?? "A1");
  for (let r = range.s.r; r <= range.e.r; r += 1) {
    for (const c of Array.from(moneyColumns)) {
      const ref = XLSX.utils.encode_cell({ r, c });
      const cell = ws[ref] as { t?: string; z?: string } | undefined;
      if (cell && cell.t === "n") cell.z = MONEY;
    }
  }

  /* Widths, because a column of company names at the default width shows
     "DORM-849 TONG CONSTR..." and the whole point of the first column is
     being able to read it. */
  ws["!cols"] = widest.map((c, i) => ({
    wch: i === 0 ? 44 : c.kind === "text" ? 22 : 13,
  }));

  XLSX.utils.book_append_sheet(wb, ws, "Sheet1");
  return wb;
}

/** The bytes, for an email attachment or a download. */
export function reportToXlsx(report: Report): ArrayBuffer {
  return XLSX.write(reportToWorkbook(report), {
    type: "array",
    bookType: "xlsx",
  }) as ArrayBuffer;
}

/**
 * The filename, in MES's own shape.
 *
 * Theirs reads "Ray's Clients by dorm as of Aug 26 - 20280806.xlsx": who it is
 * for, what it covers, and the date without separators. Followed because a
 * manager filing twelve of these a year sorts them by name.
 */
export function workbookName(report: Report, asOf: string | null): string {
  const who = report.name.replace(/[^\w &'-]+/g, " ").replace(/\s+/g, " ").trim();
  const stamp = (asOf ?? "").replace(/-/g, "");
  return stamp ? `${who} - ${stamp}.xlsx` : `${who}.xlsx`;
}
