// Builds out/MES-AR-User-Manual.pdf from cover.html, chapters/*.html and shots/.
//
//   node build.mjs
//
// Two passes, because a table of contents needs page numbers and Chrome only
// knows them once it has laid the pages out: the first pass is read back by
// pages.py for the page each heading landed on, the second prints them.

import { chromium } from "playwright-core";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, "out");
const CHROME = process.env.MANUAL_CHROME ?? "C:/Program Files/Google/Chrome/Application/chrome.exe";
const PYTHON = process.env.MANUAL_PYTHON ?? "python";
mkdirSync(OUT, { recursive: true });

const meta = JSON.parse(readFileSync(join(HERE, "manual.json"), "utf8"));
const css = readFileSync(join(HERE, "manual.css"), "utf8");

/* The width a full-width picture is printed at, in CSS pixels (A4 less margins). */
const PRINT_WIDTH = 650;
/* And the tallest, leaving room on the page for the caption. */
const MAX_PRINT_HEIGHT = 780;

const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const strip = (s) => s.replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
const attr = (tag, name) => tag.match(new RegExp(`${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`))?.slice(1).find((x) => x !== undefined);

// ------------------------------------------------------------ chapters

/**
 * A chapter is one file. Its <h1> is the chapter title and each <h2> a
 * section; both are numbered here, so moving a section renumbers it. A file
 * with <body data-planned> is listed in the contents and not printed.
 */
function chapters() {
  const dir = join(HERE, "chapters");
  let n = 0;
  return readdirSync(dir)
    .filter((f) => f.endsWith(".html"))
    .sort()
    .map((file) => {
      let html = readFileSync(join(dir, file), "utf8");
      const planned = /<body[^>]*data-planned/.test(html) || /data-planned/.test(html.split("\n")[0]);
      html = html.replace(/^\s*<!--[\s\S]*?-->/, "");
      const part = attr(html.match(/<section[^>]*class="part"[^>]*>/)?.[0] ?? "", "data-part");
      n += 1;
      const num = n;
      const title = strip(html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/)?.[1] ?? file);
      let s = 0;
      let f = 0;
      const sections = [];
      html = html
        .replace(/<h1([^>]*)>([\s\S]*?)<\/h1>/, (_, a, t) => `<h1${a} id="ch${num}"><span class="num">${num}</span> ${t}</h1>`)
        .replace(/<h2([^>]*)>([\s\S]*?)<\/h2>/g, (_, a, t) => {
          s += 1;
          sections.push({ id: `ch${num}-${s}`, label: `${num}.${s}`, title: strip(t) });
          return `<h2${a} id="ch${num}-${s}"><span class="num">${num}.${s}</span> ${t}</h2>`;
        })
        .replace(/<figure\b((?:[^>"']|"[^"]*"|'[^']*')*\bclass="[^"]*\bshot\b[^"]*"(?:[^>"']|"[^"]*"|'[^']*')*)>([\s\S]*?)<\/figure>/g, (_, a, inner) => {
          f += 1;
          return figure(a, inner, `${num}.${f}`);
        });
      return { file, num, title, part, planned, sections, html };
    });
}

/** A screenshot, with its red marks drawn over it from shots/<id>.json. */
function figure(attrs, inner, label) {
  const id = attr(attrs, "id");
  const caption = inner.match(/<figcaption>([\s\S]*?)<\/figcaption>/)?.[1] ?? "";
  const items = [...inner.matchAll(/<li\b(?:[^>"']|"[^"]*"|'[^']*')*>([\s\S]*?)<\/li>/g)].map((m) => m[1]);
  const width = attr(attrs, "data-width");
  const png = join(HERE, "shots", `${id}.png`);
  const json = join(HERE, "shots", `${id}.json`);
  if (!existsSync(png) || !existsSync(json)) {
    return `<figure class="figure missing"><div class="nopic">Screenshot not taken yet: <b>${esc(id ?? "?")}</b>. Run <code>node shots.mjs ${esc(id ?? "")}</code>.</div><figcaption><b>Figure ${label}</b> ${caption}</figcaption></figure>`;
  }
  const shot = JSON.parse(readFileSync(json, "utf8"));
  /* Printed no wider than the page, and no wider than data-width if given. */
  /* No taller than most of a page, so a picture never has to be split. */
  const shown = Math.min(shot.w, width ? Number(width) : PRINT_WIDTH, (MAX_PRINT_HEIGHT * shot.w) / shot.h);
  const k = shot.w / shown;
  const r = 10 * k;
  const marks = shot.marks
    .map((m, i) => {
      const x = m.x * shot.w, y = m.y * shot.h, w = m.w * shot.w, h = m.h * shot.h;
      /* The number sits just left of the box, level with its top, so it covers
         nothing; above the box where there is no room; else on its corner. */
      let cx = x - r - 3 * k, cy = y + r;
      if (cx - r < 0) { cx = x + r; cy = y - r - 3 * k; }
      if (cy - r < 0) { cx = x; cy = y; }
      cx = Math.max(r + 1, Math.min(shot.w - r - 1, cx));
      cy = Math.max(r + 1, Math.min(shot.h - r - 1, cy));
      return `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${5 * k}" class="ring" style="stroke-width:${2.2 * k}px"/>` +
        `<circle cx="${cx}" cy="${cy}" r="${r}" class="badge"/>` +
        `<text x="${cx}" y="${cy}" class="badge-n" style="font-size:${11.5 * k}px">${i + 1}</text>`;
    })
    .join("");
  const list = items.length
    ? `<ol class="callouts">${items.map((t) => `<li>${t}</li>`).join("")}</ol>`
    : "";
  return `<figure class="figure">
  <div class="frame" style="width:${shown}px"><img src="${pathToFileURL(png)}" alt="">
  <svg viewBox="0 0 ${shot.w} ${shot.h}" preserveAspectRatio="none">${marks}</svg></div>
  <figcaption><b>Figure ${label}</b> ${caption}</figcaption>${list}</figure>`;
}

// ------------------------------------------------------------ the document

function contents(chs, pages) {
  const at = (id) => (pages ? pages[id] ?? "" : "000");
  let lastPart = null;
  const rows = [];
  for (const c of chs) {
    if (c.part && c.part !== lastPart) {
      rows.push(`<li class="toc-part">${esc(c.part)}</li>`);
      lastPart = c.part;
    }
    rows.push(
      `<li class="toc-ch${c.planned ? " planned" : ""}"><a href="#ch${c.num}"><span class="n">${c.num}</span><span class="t">${esc(c.title)}</span>` +
        `<span class="dots"></span><span class="p">${c.planned ? "in full manual" : at(`ch${c.num}`)}</span></a></li>`,
    );
    for (const s of c.sections) {
      rows.push(
        `<li class="toc-sec${c.planned ? " planned" : ""}"><a href="#${s.id}"><span class="n">${s.label}</span><span class="t">${esc(s.title)}</span>` +
          `<span class="dots"></span><span class="p">${c.planned ? "" : at(s.id)}</span></a></li>`,
      );
    }
  }
  return `<section class="toc"><h1 class="toc-title">Contents</h1><ol>${rows.join("")}</ol></section>`;
}

function body(chs, pages) {
  return `<!doctype html><html><head><meta charset="utf-8"><title>${esc(meta.title)}</title><style>${css}</style></head><body>
${contents(chs, pages)}
${chs.filter((c) => !c.planned).map((c) => `<article class="chapter">${c.part ? `<div class="part-label">${esc(c.part)}</div>` : ""}${c.html}</article>`).join("\n")}
</body></html>`;
}

function cover() {
  const logo = pathToFileURL(join(HERE, "..", "..", "public", "mes-logo.png"));
  const html = readFileSync(join(HERE, "cover.html"), "utf8")
    .replace(/\{\{(\w+)\}\}/g, (_, k) => (k === "logo" ? String(logo) : esc(String(meta[k] ?? ""))));
  return `<!doctype html><html><head><meta charset="utf-8"><style>${css}</style></head><body class="cover-page">${html}</body></html>`;
}

const footer = `<div style="width:100%;font:8px 'Segoe UI',system-ui,sans-serif;color:#6b7280;padding:0 18mm;display:flex;justify-content:space-between">
<span>${esc(meta.title)} · ${esc(meta.version)}</span><span><span class="pageNumber"></span></span></div>`;

async function print(browser, html, file, { withFooter }) {
  const page = await browser.newPage();
  const src = join(OUT, file.replace(/\.pdf$/, ".html"));
  writeFileSync(src, html);
  await page.goto(pathToFileURL(src).href, { waitUntil: "load" });
  await page.pdf({
    path: join(OUT, file),
    format: "A4",
    printBackground: true,
    margin: withFooter ? { top: "16mm", bottom: "18mm", left: "18mm", right: "18mm" } : { top: "0", bottom: "0", left: "0", right: "0" },
    displayHeaderFooter: withFooter,
    headerTemplate: "<span></span>",
    footerTemplate: footer,
    outline: true,
    tagged: true,
  });
  await page.close();
}

// ------------------------------------------------------------------- main

const chs = chapters();
const browser = await chromium.launch({ executablePath: CHROME, headless: true });
await print(browser, body(chs, null), "pass1.pdf", { withFooter: true });
const ids = chs.flatMap((c) => (c.planned ? [] : [`ch${c.num}`, ...c.sections.map((s) => s.id)]));
const pages = JSON.parse(execFileSync(PYTHON, [join(HERE, "pages.py"), "find", join(OUT, "pass1.pdf"), ...ids], { encoding: "utf8" }));
await print(browser, body(chs, pages), "body.pdf", { withFooter: true });
await print(browser, cover(), "cover.pdf", { withFooter: false });
await browser.close();
/* The PDF's bookmarks, written here rather than taken from Chrome, which
   repeats a heading's number and title in its own outline. */
const outline = [{ title: "Contents", level: 1, page: 1 }];
for (const c of chs.filter((x) => !x.planned)) {
  outline.push({ title: `${c.num}  ${c.title}`, level: 1, page: pages[`ch${c.num}`] });
  for (const sec of c.sections) outline.push({ title: `${sec.label}  ${sec.title}`, level: 2, page: pages[sec.id] });
}
writeFileSync(join(OUT, "outline.json"), JSON.stringify(outline));
const final = join(OUT, meta.file);
execFileSync(PYTHON, [join(HERE, "pages.py"), "merge", final, join(OUT, "outline.json"), join(OUT, "cover.pdf"), join(OUT, "body.pdf")], { stdio: "inherit" });
