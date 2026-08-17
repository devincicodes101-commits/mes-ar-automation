"use client";

/**
 * CSV export.
 *
 * The proposal lists a "clean NetSuite export format specification" as a
 * handover deliverable, so the file this produces is the specification in
 * practice: one row per action, with the columns agreed with MES before go
 * live. Everything is quoted and CRLF terminated so Excel opens it cleanly.
 */

function cell(value: unknown): string {
  const s = value === null || value === undefined ? "" : String(value);
  // Escape embedded quotes by doubling them, per RFC 4180.
  return `"${s.replace(/"/g, '""')}"`;
}

export function toCsv(headers: string[], rows: unknown[][]): string {
  const lines = [headers.map(cell).join(",")];
  for (const r of rows) lines.push(r.map(cell).join(","));
  // Excel on Windows needs the BOM to read UTF-8 correctly.
  return "﻿" + lines.join("\r\n") + "\r\n";
}

export function downloadCsv(
  filename: string,
  headers: string[],
  rows: unknown[][],
): void {
  const blob = new Blob([toCsv(headers, rows)], {
    type: "text/csv;charset=utf-8;",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  // Give the browser a moment to start the download before revoking.
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Stamps a filename with the billing period, so files do not overwrite. */
export function exportName(base: string, period: string): string {
  return `MES_${base}_${period.replace(/-/g, "")}.csv`;
}
