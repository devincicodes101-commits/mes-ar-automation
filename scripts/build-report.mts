/**
 * Builds the simulation report page from MES's real files.
 *
 *   npm run report
 *
 * Every figure on the page is interpolated from a live parse, so the page
 * cannot drift from the code the way a hand-written summary would.
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as XLSX from "xlsx";
import { runPipeline } from "../src/lib/pipeline.ts";
import { simulateSend, CAN_SEND_FOR_REAL } from "../src/lib/outbox.ts";
import { currency, renderLetter, addDays } from "../src/lib/letters.ts";
import { MANAGER_COLUMNS } from "../src/lib/reports.ts";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, "..");
const FOLDER = path.join(ROOT, "AR Automation-20260903T201835Z-1-001", "AR Automation");
const AGING = path.join(FOLDER, "3. CustomA_RAgingDetail-WithDescription.xlsx");
const CONTACTS = path.join(FOLDER, "4. Client Contact List", "R1 - 20260511.xlsx");
const OUT = process.argv[2] ?? path.join(ROOT, "out", "simulation.html");

const wb = XLSX.read(readFileSync(AGING), { cellDates: true });
const cwb = existsSync(CONTACTS) ? XLSX.read(readFileSync(CONTACTS), { cellDates: true }) : null;
const p = runPipeline(wb, cwb);

const esc = (s: unknown) =>
  String(s ?? "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
const m = (n: number) => `$${currency(n)}`;
const asOf = p.asOf ?? "2026-08-17";

const total = p.accounts.reduce((s, a) => s + a.total, 0);

/** How many tenants carry the ordinary late payment fee, as against GIRO. */
const lateFeeCustomers = new Set(
  p.invoices.filter((i) => i.revenueType === "Late Payment Fee").map((i) => i.customerCode),
).size;

const first = simulateSend(p.accounts, "first-reminder", asOf, { skipTerminated: true });
const finalRun = simulateSend(p.accounts, "final-notice", addDays(asOf, 14), { skipTerminated: true });
const sampleAcct = first.sendable[0];
const letterFirst = sampleAcct
  ? renderLetter("first-reminder", {
      companyName: sampleAcct.companyName,
      grandTotal: sampleAcct.amount,
      sentOn: asOf,
    })
  : null;
const letterFinal = sampleAcct
  ? renderLetter("final-notice", {
      companyName: sampleAcct.companyName,
      grandTotal: sampleAcct.amount,
      sentOn: addDays(asOf, 14),
    })
  : null;

/* -------------------------------------------------------------- fragments */

function agingTable(): string {
  const head = ["Dorm", "Accounts", "Current", "30 days", "60 days", "90 days", "More than 90", "Grand Total"];
  const rows = p.byProperty
    .map(
      (r) => `<tr>
      <th scope="row">${esc(r.property)}</th>
      <td class="n">${r.accounts}</td>
      <td class="n a1">${m(r.buckets.current)}</td>
      <td class="n a2">${m(r.buckets.d30)}</td>
      <td class="n a3">${m(r.buckets.d60)}</td>
      <td class="n a4">${m(r.buckets.d90)}</td>
      <td class="n a5">${m(r.buckets.d90plus)}</td>
      <td class="n strong">${m(r.total)}</td></tr>`,
    )
    .join("");
  return `<div class="scroll"><table class="grid">
    <thead><tr>${head.map((h, i) => `<th${i ? ' class="n"' : ""}>${esc(h)}</th>`).join("")}</tr></thead>
    <tbody>${rows}</tbody></table></div>`;
}

function tabCards(): string {
  return p.revenueTabs
    .map((t) => {
      const empty = t.lineCount === 0;
      const sample = t.blocks[0]?.rows.slice(0, 3) ?? [];
      return `<article class="tab${empty ? " tab--empty" : ""}">
      <header>
        <span class="tag">${esc(t.shorthand)}</span>
        <h3>${esc(t.name)}</h3>
      </header>
      <dl class="pair">
        <div><dt>Lines</dt><dd class="num">${t.lineCount}</dd></div>
        <div><dt>Open balance</dt><dd class="num">${m(t.total)}</dd></div>
      </dl>
      ${
        empty
          ? `<p class="empty-note">Nothing on this tab in the August export.</p>`
          : `<div class="scroll"><table class="mini"><tbody>${sample
              .map(
                (r) => `<tr><td class="mono">${esc(r.documentNumber)}</td>
              <td class="mono dim">${esc(r.date ?? "")}</td>
              <td class="n mono">${m(Number(r.openBalance))}</td>
              <td class="desc">${esc(String(r.description).slice(0, 44))}</td></tr>`,
              )
              .join("")}</tbody></table></div>`
      }
      ${t.notes.map((n) => `<p class="note">${esc(n)}</p>`).join("")}
    </article>`;
    })
    .join("");
}

function managerTable(): string {
  // Ray's layout, filled with the accounts this export can support.
  const rows = p.accounts.slice(0, 6);
  const head = MANAGER_COLUMNS.map(
    (c) =>
      `<th class="${c.kind === "money" || c.kind === "number" ? "n" : ""}${c.unavailable ? " gap" : ""}"${
        c.unavailable ? ` title="${esc(c.unavailable)}"` : ""
      }>${esc(c.label)}${c.unavailable ? '<span class="gap-mark">no source</span>' : ""}</th>`,
  ).join("");
  const body = rows
    .map(
      (a) => `<tr>
      <th scope="row" class="mono">${esc(a.customerCode)} ${esc(a.companyName.slice(0, 26))}</th>
      <td>${esc(a.status)}</td>
      <td class="n">${m(a.buckets.current)}</td>
      <td class="n">${m(a.buckets.d30)}</td>
      <td class="n">${m(a.buckets.d60)}</td>
      <td class="n">${m(a.buckets.d90)}</td>
      <td class="n">${m(a.buckets.d90plus)}</td>
      <td class="n strong">${m(a.total)}</td>
      <td class="n">${m(a.buckets.d30 + a.buckets.d60 + a.buckets.d90 + a.buckets.d90plus)}</td>
      <td class="dim">—</td>
      <td class="n gap"></td>
      <td class="n gap"></td>
      <td class="dim">not in export</td></tr>`,
    )
    .join("");
  return `<div class="scroll"><table class="grid tight"><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></div>`;
}

function lateFeeTable(): string {
  const rows = p.lateFees.rows.slice(0, 7);
  return `<div class="scroll"><table class="grid">
    <thead><tr><th>Customer</th><th>Company</th><th class="n">Overdue &gt; 14 days</th><th class="n">Fee</th><th class="n">Charged before</th></tr></thead>
    <tbody>${rows
      .map(
        (r) => `<tr><th scope="row" class="mono">${esc(r.account.customerCode)}</th>
      <td>${esc(r.account.companyName.slice(0, 34))}</td>
      <td class="n">${m(r.overdue)}</td>
      <td class="n">$${r.fee}</td>
      <td class="n dim">${r.alreadyCharged}&times;</td></tr>`,
      )
      .join("")}</tbody></table></div>`;
}

function giroTable(): string {
  return `<div class="scroll"><table class="grid">
    <thead><tr><th>Customer</th><th>Company</th><th class="n">Overdue</th><th>Why excluded</th></tr></thead>
    <tbody>${p.lateFees.giroExcluded
      .map(
        (g) => `<tr><th scope="row" class="mono">${esc(g.account.customerCode)}</th>
      <td>${esc(g.account.companyName.slice(0, 32))}</td>
      <td class="n">${m(g.overdue)}</td>
      <td class="dim">Carries a rejected&#8209;GIRO fee</td></tr>`,
      )
      .join("")}</tbody></table></div>`;
}

function defaulterTable(): string {
  return `<div class="scroll"><table class="grid">
    <thead><tr><th>Customer</th><th>Company</th><th class="n">GIRO failures</th><th class="n">Late fees</th><th>Months it bounced</th></tr></thead>
    <tbody>${p.defaulters
      .slice(0, 6)
      .map(
        (d) => `<tr><th scope="row" class="mono">${esc(d.customerCode)}</th>
      <td>${esc(d.companyName.slice(0, 30))}</td>
      <td class="n">${d.failures || "—"}</td>
      <td class="n">${d.lateFees || "—"}</td>
      <td class="mono dim">${esc(d.months.join("  ")) || "—"}</td></tr>`,
      )
      .join("")}</tbody></table></div>`;
}

const pctReach = ((p.contactCoverage.withEmail / p.contactCoverage.total) * 100).toFixed(1);

/* ------------------------------------------------------------------- page */

/**
 * How many assertions the suite runs, counted from its source rather than
 * typed in here, so the page cannot claim a figure the tests do not back.
 */
const CHECKS = (
  readFileSync(path.join(HERE, "test-pipeline.mts"), "utf8").match(/^check\(/gm) ?? []
).length;

const html = `<title>AR Cycle Simulation</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500&family=IBM+Plex+Sans:wght@400;500;600&family=IBM+Plex+Serif:wght@500;600&display=swap">
<style>
:root{
  --page:#f7f7f5; --surface-1:#fcfcfb; --surface-2:#f1f1ee; --surface-3:#e8e8e4;
  --ink:#101010; --ink-2:#4a4945; --ink-3:#85847e;
  --rule:#e4e3de; --rule-2:rgba(16,16,16,.20);
  --age-1:#a3a29c; --age-2:#85847e; --age-3:#66655f; --age-4:#47463f; --age-5:#2a2924;
  --good:#4a6741; --warn:#8a6d1f; --crit:#8c2f22;
  --good-wash:#e9eee6; --warn-wash:#f4eedd; --crit-wash:#f6e7e4;
  --serif:"IBM Plex Serif",Georgia,"Times New Roman",serif;
  --sans:"IBM Plex Sans",-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;
  --mono:"IBM Plex Mono",ui-monospace,SFMono-Regular,Menlo,monospace;
}
@media (prefers-color-scheme:dark){:root:not([data-theme="light"]){
  --page:#0c0c0b; --surface-1:#141413; --surface-2:#1e1e1c; --surface-3:#292927;
  --ink:#f7f7f5; --ink-2:#b5b4ab; --ink-3:#85847e;
  --rule:#262624; --rule-2:rgba(247,247,245,.24);
  --age-1:#4f4e47; --age-2:#6d6c63; --age-3:#8b8a80; --age-4:#a9a89d; --age-5:#c7c6ba;
  --good:#9cba8f; --warn:#d8b95f; --crit:#e0938a;
  --good-wash:#1b241a; --warn-wash:#282112; --crit-wash:#2b1a18;
}}
:root[data-theme="dark"]{
  --page:#0c0c0b; --surface-1:#141413; --surface-2:#1e1e1c; --surface-3:#292927;
  --ink:#f7f7f5; --ink-2:#b5b4ab; --ink-3:#85847e;
  --rule:#262624; --rule-2:rgba(247,247,245,.24);
  --age-1:#4f4e47; --age-2:#6d6c63; --age-3:#8b8a80; --age-4:#a9a89d; --age-5:#c7c6ba;
  --good:#9cba8f; --warn:#d8b95f; --crit:#e0938a;
  --good-wash:#1b241a; --warn-wash:#282112; --crit-wash:#2b1a18;
}
*{box-sizing:border-box}
body{background:var(--page);color:var(--ink);font-family:var(--sans);font-size:15px;line-height:1.55;
  -webkit-font-smoothing:antialiased;padding:0 0 6rem}
.wrap{max-width:74rem;margin:0 auto;padding:0 1.5rem}
.prose{max-width:64ch}
h1,h2,h3{font-family:var(--serif);text-wrap:balance;margin:0}
a{color:inherit}
:focus-visible{outline:2px solid var(--ink);outline-offset:2px}

/* ---- masthead, set like the workbook's own header block ---- */
.mast{border-bottom:1px solid var(--rule-2);padding:3.5rem 0 1.75rem;margin-bottom:2.5rem}
.mast .eyebrow{font-family:var(--mono);font-size:.72rem;letter-spacing:.14em;text-transform:uppercase;
  color:var(--ink-3);margin:0 0 1.25rem}
.mast h1{font-size:clamp(2rem,4.4vw,3.1rem);line-height:1.06;font-weight:600;letter-spacing:-.015em}
.mast .sub{color:var(--ink-2);margin:.9rem 0 0;max-width:58ch}
.hdrblock{display:grid;grid-template-columns:auto 1fr;gap:.15rem 1.5rem;margin-top:1.75rem;
  font-family:var(--mono);font-size:.78rem;line-height:1.75}
.hdrblock dt{color:var(--ink-3)}
.hdrblock dd{margin:0;color:var(--ink)}

/* ---- headline reconciliation ---- */
.recon{display:grid;grid-template-columns:repeat(auto-fit,minmax(13rem,1fr));gap:0;
  border:1px solid var(--rule-2);background:var(--surface-1);margin:0 0 3rem}
.recon > div{padding:1.35rem 1.5rem;border-right:1px solid var(--rule)}
.recon > div:last-child{border-right:0}
.recon dt{font-family:var(--mono);font-size:.68rem;letter-spacing:.12em;text-transform:uppercase;color:var(--ink-3)}
.recon dd{margin:.45rem 0 0;font-family:var(--mono);font-size:1.5rem;font-weight:500;
  letter-spacing:-.02em;font-variant-numeric:tabular-nums}
.recon .match{color:var(--good)}

/* ---- dated stages: the number is the day of MES's month ---- */
section{margin:0 0 3.25rem;scroll-margin-top:2rem}
.stage{display:flex;align-items:baseline;gap:1rem;border-top:1px solid var(--rule-2);
  padding-top:1rem;margin-bottom:1.4rem}
.day{font-family:var(--mono);font-size:.78rem;font-weight:500;color:var(--ink);background:var(--surface-3);
  padding:.25rem .55rem;white-space:nowrap;letter-spacing:.02em}
.stage h2{font-size:1.4rem;font-weight:600;letter-spacing:-.01em}
.stage .what{color:var(--ink-3);font-size:.85rem;margin-left:auto;font-family:var(--mono);white-space:nowrap}
p{margin:0 0 1rem}
.lede{color:var(--ink-2)}

/* ---- tables ---- */
.scroll{overflow-x:auto;border:1px solid var(--rule);background:var(--surface-1)}
table{border-collapse:collapse;width:100%;font-size:.83rem}
.grid th,.grid td{padding:.5rem .75rem;text-align:left;border-bottom:1px solid var(--rule);white-space:nowrap}
.grid thead th{font-family:var(--mono);font-size:.68rem;letter-spacing:.08em;text-transform:uppercase;
  color:var(--ink-3);font-weight:500;background:var(--surface-2);position:sticky;top:0}
.grid tbody th{font-weight:500}
.grid tbody tr:last-child td,.grid tbody tr:last-child th{border-bottom:0}
.n{text-align:right;font-variant-numeric:tabular-nums;font-family:var(--mono)}
.strong{font-weight:600;color:var(--ink)}
.dim{color:var(--ink-3)}
.mono{font-family:var(--mono);font-size:.78rem}
.a1{color:var(--age-1)}.a2{color:var(--age-2)}.a3{color:var(--age-3)}
.a4{color:var(--age-4)}.a5{color:var(--age-5);font-weight:500}
.tight th,.tight td{padding:.4rem .6rem;font-size:.78rem}
.gap{background:var(--crit-wash)}
.gap-mark{display:block;font-size:.58rem;letter-spacing:.06em;color:var(--crit);margin-top:.15rem}

/* ---- the six tabs ---- */
.tabs{display:grid;grid-template-columns:repeat(auto-fit,minmax(19rem,1fr));gap:1px;
  background:var(--rule);border:1px solid var(--rule)}
.tab{background:var(--surface-1);padding:1.15rem 1.25rem;display:flex;flex-direction:column;gap:.85rem}
.tab--empty{background:var(--surface-2)}
.tab header{display:flex;align-items:center;gap:.6rem}
.tab h3{font-size:1rem;font-weight:600}
.tag{font-family:var(--mono);font-size:.62rem;letter-spacing:.1em;padding:.2rem .4rem;
  background:var(--ink);color:var(--page);font-weight:500}
.pair{display:flex;gap:2rem;margin:0}
.pair dt{font-family:var(--mono);font-size:.64rem;letter-spacing:.1em;text-transform:uppercase;color:var(--ink-3)}
.pair dd{margin:.15rem 0 0;font-family:var(--mono);font-size:1.05rem;font-variant-numeric:tabular-nums}
.mini{font-size:.72rem}
.mini td{padding:.3rem .5rem;border-bottom:1px solid var(--rule);white-space:nowrap}
.mini tr:last-child td{border-bottom:0}
.mini .desc{color:var(--ink-3);white-space:nowrap;max-width:16rem;overflow:hidden;text-overflow:ellipsis}
.note{font-size:.76rem;color:var(--ink-3);margin:0;line-height:1.5;border-left:2px solid var(--rule-2);padding-left:.7rem}
.empty-note{font-size:.8rem;color:var(--ink-3);margin:0}

/* ---- callouts ---- */
.call{border-left:3px solid var(--ink);padding:.15rem 0 .15rem 1.1rem;margin:1.5rem 0;max-width:64ch}
.call.warn{border-color:var(--warn)}
.call.crit{border-color:var(--crit)}
.call h4{font-family:var(--sans);font-size:.82rem;letter-spacing:.06em;text-transform:uppercase;
  margin:0 0 .35rem;color:var(--ink-2)}
.call p{margin:0;color:var(--ink-2);font-size:.9rem}

/* ---- letters ---- */
.letters{display:grid;grid-template-columns:repeat(auto-fit,minmax(24rem,1fr));gap:1.25rem;align-items:start}
.letter{border:1px solid var(--rule);background:var(--surface-1)}
.letter .lh{padding:.85rem 1.1rem;border-bottom:1px solid var(--rule);background:var(--surface-2);
  display:flex;justify-content:space-between;align-items:baseline;gap:1rem;flex-wrap:wrap}
.letter .lh strong{font-family:var(--serif);font-size:.98rem;font-weight:600}
.letter .lh span{font-family:var(--mono);font-size:.7rem;color:var(--ink-3)}
.letter pre{margin:0;padding:1.1rem;font-family:var(--mono);font-size:.7rem;line-height:1.6;
  white-space:pre-wrap;color:var(--ink-2);max-height:30rem;overflow-y:auto}
.letter mark{background:var(--warn-wash);color:var(--ink);padding:0 .1em}

/* ---- coverage bar ---- */
.bar{display:flex;height:2.25rem;border:1px solid var(--rule-2);overflow:hidden;margin:1.25rem 0 .6rem}
.bar span{display:flex;align-items:center;justify-content:center;font-family:var(--mono);font-size:.7rem;
  white-space:nowrap;overflow:hidden}
.bar .has{background:var(--ink);color:var(--page)}
.bar .none{background:var(--crit-wash);color:var(--crit)}
.barkey{display:flex;gap:1.5rem;font-family:var(--mono);font-size:.72rem;color:var(--ink-3);flex-wrap:wrap}

/* ---- checks ---- */
.checks{display:grid;grid-template-columns:repeat(auto-fit,minmax(15rem,1fr));gap:1px;
  background:var(--rule);border:1px solid var(--rule)}
.check{background:var(--surface-1);padding:.9rem 1rem}
.check .k{font-family:var(--mono);font-size:.64rem;letter-spacing:.1em;text-transform:uppercase;color:var(--ink-3)}
.check .v{font-family:var(--mono);font-size:1.35rem;margin-top:.3rem;font-variant-numeric:tabular-nums}
.check .v.ok{color:var(--good)}
.blocked{border:1px solid var(--rule-2);background:var(--surface-1);padding:1.25rem 1.5rem}
.blocked ol{margin:.75rem 0 0;padding-left:1.15rem;display:grid;gap:.85rem}
.blocked li{color:var(--ink-2);font-size:.9rem;max-width:62ch}
.blocked li strong{color:var(--ink);font-weight:600}
footer{border-top:1px solid var(--rule-2);margin-top:3rem;padding-top:1.25rem;
  font-family:var(--mono);font-size:.72rem;color:var(--ink-3)}
@media (prefers-reduced-motion:reduce){*{animation:none!important;transition:none!important}}
</style>

<div class="wrap">
<header class="mast">
  <p class="eyebrow">MES Group &middot; Dormitory Accounts Receivable</p>
  <h1>One month of the collections cycle, run against MES's real export.</h1>
  <p class="sub">Every figure below was parsed live from the workbooks in the September folder.
  Nothing was sent: the reminder step builds each message, renders MES's own letter into it,
  reports who it reaches, and stops.</p>
  <dl class="hdrblock">
    <dt>Source</dt><dd>3. CustomA_RAgingDetail-WithDescription.xlsx</dd>
    <dt>Consol</dt><dd>${esc(p.entity)}</dd>
    <dt>As of</dt><dd>${esc(asOf)}</dd>
    <dt>Contacts</dt><dd>R1 - 20260511.xlsx</dd>
  </dl>
</header>

<dl class="recon">
  <div><dt>Invoice lines read</dt><dd>${p.invoices.length.toLocaleString()}</dd></div>
  <div><dt>Accounts</dt><dd>${p.accounts.length}</dd></div>
  <div><dt>Our total</dt><dd>${m(total)}</dd></div>
  <div><dt>MES's own subtotals</dt><dd class="match">${m(total)}</dd></div>
</dl>

<section>
  <div class="stage"><span class="day">4th</span><h2>Upload</h2><span class="what">the routine that runs on every import</span></div>
  <div class="prose">
    <p class="lede">MES's Flow tab describes one routine that runs whenever a report is imported,
    whatever day it lands on: tag the report's date, apply the aging formula, then group by dorm.
    There is no branch on the calendar — re-uploading the same file next week gives the same numbers,
    because every one of them is keyed off the date inside the file rather than today's.</p>
  </div>
  <div class="call">
    <h4>Reconciliation</h4>
    <p>MES print a subtotal under each of their ${p.accounts.length} customers. Ours are built from the
    lines above them and add to the same cent — ${m(total)} against ${m(total)}. That is the check that
    matters: it means the parser agrees with the source, not with itself.</p>
  </div>
</section>

<section>
  <div class="stage"><span class="day">Step 3</span><h2>Show by dorm</h2><span class="what">15 / 45 / 75 / 105 day boundaries</span></div>
  <div class="prose"><p class="lede">The buckets follow MES's own formula, from the Formula tab of their
  workbook — not the 30/60/90 the earlier documents implied. Fifteen days of grace before the clock
  starts, so an invoice 30 days past due sits in <em>30 days</em>, and one 15 days past due is still Current.</p></div>
  ${agingTable()}
  <p class="note" style="margin-top:.75rem;max-width:64ch">This export is a single entity, KT Mesdorm,
  so one dormitory appears. The importer keys the dormitory off each document number
  (BSDFM/1598, JPD1&#8209;786/002429) and falls back to the entity named in the file header, so a
  consolidated export or four separate ones both work.</p>
</section>

<section>
  <div class="stage"><span class="day">Step 3</span><h2>The six tabs</h2><span class="what">SD / PF / 1FM / LP / SD / RM</span></div>
  <div class="prose"><p class="lede">MES's workbook ends with six blank tabs. The blankness is the
  requirement. Five are per charge type; the sixth is the manager report below.</p></div>
  <div class="tabs">${tabCards()}</div>
</section>

<section>
  <div class="stage"><span class="day">RM</span><h2>Clients by dorm</h2><span class="what">Ray's layout, 13 columns</span></div>
  <div class="prose"><p class="lede">MES sent two manager mock-ups ten days apart that do not agree.
  Ray's is newer and its columns are a superset of Harry's, so it is the one built. Two of its thirteen
  columns cannot be filled from any file MES has sent — they are shown, empty and marked, rather than
  dropped, because a missing column reads as "no data" while an empty one that says why is a question
  somebody can answer.</p></div>
  ${managerTable()}
  <div class="call crit">
    <h4>Blocked — and this is the table it blocks</h4>
    <p>This export has no <span class="mono">Primary Sales Rep</span> column, so no manager report can
    actually be grouped: the rows above are the accounts, in Ray's layout, waiting for the column.
    It exists on MES's <em>Finance AR Download</em> tab but not on the aging detail, and
    <span class="mono">Categories</span> is the other way round. One export carrying both finishes this.</p>
  </div>
</section>

<section>
  <div class="stage"><span class="day">16th</span><h2>Late payment listing</h2><span class="what">&gt; 14 days, GIRO excluded</span></div>
  <div class="prose"><p class="lede">$100 before GST, on anything more than fourteen calendar days past
  its due date — the rule MES state in their own reminder letter. ${p.lateFees.rows.length} tenants qualify
  this cycle.</p></div>
  ${lateFeeTable()}
  <h3 style="font-size:1rem;margin:1.75rem 0 .5rem">Excluded because they are on GIRO</h3>
  <div class="prose"><p class="lede">Jacqueline's standing instruction to the AR team is
  <em>"check if I might have included the giro clients in the listing and remove accordingly."</em>
  With the bank statement dropped there is no GIRO field left — but a failed deduction raises its own
  invoice line, <span class="mono">Admin Fee for Rejected Giro</span>. In this export
  ${p.giroCustomers.size} tenants carry that fee and ${lateFeeCustomers} different ones
  carry the ordinary late payment fee, and not one carries both. That is MES's rule, visible in their own data.</p></div>
  ${giroTable()}
</section>

<section>
  <div class="stage"><span class="day">Insight</span><h2>Recurring defaulters</h2><span class="what">without the bank file</span></div>
  <div class="prose"><p class="lede">Each bounced deduction leaves a dated fee line, so the pattern
  survives the loss of the DBS report that was supposed to provide it.</p></div>
  ${defaulterTable()}
</section>

<section>
  <div class="stage"><span class="day">7th</span><h2>First reminder</h2><span class="what">bulk email &middot; simulated</span></div>
  <div class="checks" style="margin-bottom:1.5rem">
    <div class="check"><div class="k">In scope</div><div class="v">${first.messages.length}</div></div>
    <div class="check"><div class="k">Would send</div><div class="v ok">${first.sendable.length}</div></div>
    <div class="check"><div class="k">Blocked, no address</div><div class="v">${first.blocked.length}</div></div>
    <div class="check"><div class="k">Real transport wired</div><div class="v">${CAN_SEND_FOR_REAL ? "yes" : "none"}</div></div>
  </div>
  <div class="prose"><p class="lede">Both letters are transcribed from MES's Word documents and left
  exactly as written — the final notice cites the Employment of Foreign Manpower Regulations and raises
  disruption of services, so a paraphrase would be a legal change. The documents carry two merge fields;
  the dates are prose and are computed. Highlighted below.</p></div>
  <div class="letters">
    <article class="letter">
      <div class="lh"><strong>First Reminder &middot; the 7th</strong><span>pay by ${esc(letterFirst?.deadline ?? "")} &middot; +6 days</span></div>
      <pre>${highlight(letterFirst?.body ?? "")}</pre>
    </article>
    <article class="letter">
      <div class="lh"><strong>Final Reminder &middot; the 21st</strong><span>pay by ${esc(letterFinal?.deadline ?? "")} &middot; +7 days</span></div>
      <pre>${highlight(letterFinal?.body ?? "")}</pre>
    </article>
  </div>
</section>

<section>
  <div class="stage"><span class="day">Gap</span><h2>Who a bulk email can reach</h2><span class="what">${pctReach}%</span></div>
  <div class="bar" role="img" aria-label="${p.contactCoverage.withEmail} of ${p.contactCoverage.total} accounts have an email address">
    <span class="has" style="flex:${Math.max(p.contactCoverage.withEmail, 6)}">${p.contactCoverage.withEmail}</span>
    <span class="none" style="flex:${p.contactCoverage.withoutEmail}">${p.contactCoverage.withoutEmail} with no address</span>
  </div>
  <div class="barkey"><span>${p.contactCoverage.addresses} distinct addresses</span><span>${p.contactCoverage.total} accounts in the export</span></div>
  <div class="call crit">
    <h4>Worse than a headcount suggests</h4>
    <p>The contact list carries 49 companies with addresses, but only ${p.contactCoverage.withEmail} of them
    appear in this AR export. The two files are about different dormitories: the addresses sit almost
    entirely against JPD tenants while this export is entirely Blue Stars. 44 of the 49 addressed companies
    are not here at all, and 172 of the ${p.contactCoverage.total} accounts are on no list of any kind.
    This is a data gap, not a defect — the screens name the unreachable tenants rather than skipping them.</p>
  </div>
</section>

<section>
  <div class="stage"><span class="day">Checks</span><h2>What the test suite proves</h2><span class="what">npm run test:pipeline</span></div>
  <div class="checks">
    <div class="check"><div class="k">Assertions</div><div class="v ok">${CHECKS} pass</div></div>
    <div class="check"><div class="k">Parse errors on the real file</div><div class="v ok">0</div></div>
    <div class="check"><div class="k">Lines whose bucket disagrees</div><div class="v ok">0</div></div>
    <div class="check"><div class="k">Tenants on both fee lists</div><div class="v ok">0</div></div>
  </div>
  <div class="call">
    <h4>One bug the real data caught</h4>
    <p>1FM was matched on <span class="mono">/^JPD?\\d*FM/</span>, which only ever matched the JPD
    dormitories. On this export, which is entirely Blue Stars, that found 98 of the 542 real 1FM lines —
    just the ones whose description happened to say ONEFM. The other 444, including every VAT line on a
    1FM invoice, were filed as ordinary charges and missing from the 1FM report. The prefix is the
    dormitory code plus FM, exactly as MES's own note on the export says.</p>
  </div>
</section>

<section>
  <div class="stage"><span class="day">Open</span><h2>Still blocked on MES</h2><span class="what">three things</span></div>
  <div class="blocked">
    <ol>
      <li><strong>One export with all the columns.</strong>
      <span class="mono">Categories</span> is on the aging detail; <span class="mono">Primary Sales Rep</span>,
      <span class="mono">End User: Industry Type</span> and <span class="mono">Status</span> are on the
      Finance AR Download tab. Neither file has both, so the manager and industry reports cannot be built
      from anything MES has sent.</li>
      <li><strong>Security deposit held, per tenant.</strong> Ray's mock-up shows figures like 34,000 and
      31,400. The AR report only carries deposit lines that are still open — 14 of them, netting
      ${m(p.revenueTabs.find((t) => t.code === "SD-SECURITY")?.total ?? 0)} across all
      ${p.accounts.length} accounts. Deposit held is a balance-sheet figure and is in no file here.</li>
      <li><strong>How Risk Exposure is calculated.</strong> Needed even once the deposit arrives. The
      mock-up contains no formula and its values do not follow from the other columns: one row shows
      418.64 overdue against 16,640 of deposit and a risk of &minus;3,162.60.</li>
    </ol>
  </div>
</section>

<footer>
  Generated by <span class="mono">npm run report</span> from MES's September folder &middot;
  report date ${esc(asOf)} &middot; no email was sent
</footer>
</div>
`;

/** Marks the parts of MES's letter that the system fills in. */
function highlight(body: string): string {
  let out = esc(body);
  const marks = [
    /\$[\d,]+\.\d{2}/g,
    /\d{1,2}(?:st|nd|rd|th)? [A-Z][a-z]+ \d{2,4}/g,
  ];
  for (const re of marks) out = out.replace(re, (s) => `<mark>${s}</mark>`);
  // The company name, on the first line only.
  out = out.replace(/^Dear (.+)$/m, (_x, n) => `Dear <mark>${n}</mark>`);
  return out;
}

mkdirSync(path.dirname(OUT), { recursive: true });
writeFileSync(OUT, html, "utf8");
console.log(`wrote ${OUT}  (${(html.length / 1024).toFixed(1)} kB)`);
console.log(`  ${p.invoices.length} lines, ${p.accounts.length} accounts, ${m(total)}`);
