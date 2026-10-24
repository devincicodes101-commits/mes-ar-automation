// Takes every screenshot the manual uses, straight from the running app.
//
//   node shots.mjs              every figure in chapters/*.html
//   node shots.mjs upload-new   only the figures named
//
// Each <figure class="shot"> in a chapter says what to capture (see README.md):
// the page, the steps to get the screen into shape, what to crop to, and in its
// <li data-find> items the things to circle. This writes shots/<id>.png and
// shots/<id>.json, the boxes to draw as a share of the picture, so build.mjs can
// draw the red marks over the image and they stay sharp at any size.

import { chromium } from "playwright-core";
import { mkdirSync, readFileSync, readdirSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));

/* Sign-in details stay out of git: docs/manual/.env, or the environment. */
if (existsSync(join(HERE, ".env"))) {
  for (const line of readFileSync(join(HERE, ".env"), "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z_]+)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
}
const BASE = process.env.MANUAL_BASE ?? "https://mes-ar-automation.vercel.app";
const CHROME = process.env.MANUAL_CHROME ?? "C:/Program Files/Google/Chrome/Application/chrome.exe";

/* Figures can sign in as someone else, for the screens a role sees differently. */
const LOGINS = {
  admin: [process.env.MANUAL_EMAIL, process.env.MANUAL_PASSWORD],
  csd: [process.env.MANUAL_CSD_EMAIL, process.env.MANUAL_CSD_PASSWORD],
  rm: [process.env.MANUAL_RM_EMAIL, process.env.MANUAL_RM_PASSWORD],
  management: [process.env.MANUAL_MANAGEMENT_EMAIL, process.env.MANUAL_MANAGEMENT_PASSWORD],
};

const VIEWPORTS = {
  desktop: { width: 1120, height: 760 },
  phone: { width: 390, height: 844 },
};

// ------------------------------------------------------------ reading chapters

/** The attributes of one tag, either quote style. */
function attrs(tag) {
  const out = {};
  for (const m of tag.matchAll(/([a-z-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) out[m[1]] = m[2] ?? m[3];
  return out;
}

const decode = (s) => s.replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");

export function figures() {
  const list = [];
  const dir = join(HERE, "chapters");
  for (const file of readdirSync(dir).filter((f) => f.endsWith(".html")).sort()) {
    const html = readFileSync(join(dir, file), "utf8");
    for (const m of html.matchAll(/<figure\b((?:[^>"']|"[^"]*"|'[^']*')*\bclass="[^"]*\bshot\b[^"]*"(?:[^>"']|"[^"]*"|'[^']*')*)>([\s\S]*?)<\/figure>/g)) {
      const a = attrs(m[1]);
      const marks = [...m[2].matchAll(/<li\b((?:[^>"']|"[^"]*"|'[^']*')*)>/g)].map((li) => attrs(li[1])).filter((x) => x["data-find"]);
      list.push({
        file,
        id: a.id,
        path: a["data-path"] ?? "/",
        steps: decode(a["data-steps"] ?? ""),
        clip: decode(a["data-clip"] ?? "window"),
        device: a["data-device"] ?? "desktop",
        height: a["data-height"] ? Number(a["data-height"]) : null,
        vw: a["data-vw"] ? Number(a["data-vw"]) : null,
        maxh: a["data-maxh"] ? Number(a["data-maxh"]) : null,
        as: a["data-as"] ?? "admin",
        toasts: "data-toasts" in a,
        strip: "data-strip" in a,
        marks: marks.map((x) => ({ find: decode(x["data-find"]), pad: Number(x["data-pad"] ?? 5) })),
      });
    }
  }
  return list;
}

// ------------------------------------------------------------ driving the app

async function signIn(page, who) {
  const [email, password] = LOGINS[who] ?? [];
  if (!email || !password) throw new Error(`No sign-in for "${who}". Set it in docs/manual/.env (see README.md).`);
  await page.goto(`${BASE}/login`, { waitUntil: "networkidle" });
  await page.fill('input[name="username"]', email);
  await page.fill('input[name="password"]', password);
  await page.click('button[type="submit"]');
  await page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 90000 });
}

/** Until the content, not its loading placeholders, is on screen. */
async function settle(page) {
  /* A screen with a full report behind it can take half a minute to fill. */
  for (let i = 0; i < 240; i++) {
    const ready = await page
      .evaluate(() => {
        const root = document.querySelector("main") ?? document.body;
        const side = document.querySelector("aside");
        return root.innerText.trim().length > 60 && !root.querySelector(".skeleton, .animate-pulse") &&
          !(side && side.querySelector(".skeleton, .animate-pulse"));
      })
      .catch(() => false);
    if (ready) break;
    await page.waitForTimeout(500);
  }
  await page.waitForTimeout(1000);
}

/**
 * The steps, one per line or separated by ";;":
 *   click: <selector>          press something
 *   fill: <selector> => text   type into a box
 *   file: <selector> => path   choose a file (path from docs/manual)
 *   select: <selector> => val  pick from a drop-down
 *   hover: <selector>
 *   wait: <ms>                 or  wait: <selector>
 *   scroll: <selector>         bring it into view
 *   goto: <path>
 * Selectors are Playwright's: text=..., role=button[name="..."], css, a >> b.
 */
async function run(page, steps) {
  for (const raw of steps.split(/;;|\n/).map((s) => s.trim()).filter(Boolean)) {
    const i = raw.indexOf(":");
    const verb = raw.slice(0, i).trim();
    const rest = raw.slice(i + 1).trim();
    const [sel, value] = rest.split(/\s=>\s/);
    if (verb === "click") await page.locator(sel).first().click();
    else if (verb === "fill") await page.locator(sel).first().fill(value ?? "");
    else if (verb === "file") await page.locator(sel).first().setInputFiles(resolve(HERE, value));
    else if (verb === "select") await page.locator(sel).first().selectOption(value);
    else if (verb === "hover") await page.locator(sel).first().hover();
    else if (verb === "scroll") await page.locator(sel).first().scrollIntoViewIfNeeded();
    else if (verb === "goto") await page.goto(`${BASE}${rest}`, { waitUntil: "domcontentloaded" });
    else if (verb === "wait") {
      if (/^\d+$/.test(rest)) await page.waitForTimeout(Number(rest));
      else await page.locator(rest).first().waitFor({ timeout: 120000 });
    } else throw new Error(`Unknown step "${raw}"`);
    await page.waitForTimeout(400);
  }
  await settle(page);
}

/* The app scrolls inside a fixed-height shell; let the page grow instead, so
   a crop can reach anything below the fold. */
async function unfix(page) {
  await page.evaluate(() => {
    for (let el = document.querySelector("main"); el; el = el.parentElement) {
      const cs = getComputedStyle(el);
      if (["auto", "scroll", "hidden"].includes(cs.overflowY)) el.style.overflowY = "visible";
      if (el.classList.contains("h-dvh") || cs.height === `${innerHeight}px`) el.style.height = "auto";
    }
  });
  await page.waitForTimeout(300);
}

async function box(page, selector) {
  const loc = page.locator(selector).first();
  await loc.waitFor({ state: "visible", timeout: 15000 });
  const b = await loc.boundingBox();
  const sy = await page.evaluate(() => scrollY);
  const sx = await page.evaluate(() => scrollX);
  return { x: b.x + sx, y: b.y + sy, w: b.width, h: b.height };
}

/* One sign-in per role for the whole run, not one per figure. */
const sessions = {};
async function sessionFor(browser, who) {
  /* data-as="none": signed out, for the sign-in page. */
  if (who === "none") return undefined;
  if (!sessions[who]) {
    const ctx = await browser.newContext();
    await signIn(await ctx.newPage(), who);
    sessions[who] = await ctx.storageState();
    await ctx.close();
  }
  return sessions[who];
}

async function capture(browser, fig) {
  const ctx = await browser.newContext({
    viewport: {
      ...VIEWPORTS[fig.device],
      ...(fig.vw ? { width: fig.vw } : {}),
      ...(fig.height ? { height: fig.height } : {}),
    },
    deviceScaleFactor: 2,
    colorScheme: "light",
    storageState: await sessionFor(browser, fig.as),
  });
  if (!fig.strip) {
    await ctx.addInitScript(() => {
      setInterval(() => {
        for (const el of document.querySelectorAll("main div.rounded-lg.border")) {
          const t = el.textContent ?? "";
          if (/Letters would go out from|No mailbox is connected|needs reconnecting/.test(t) &&
              el.querySelector("button") && !el.querySelector("h2")) el.style.display = "none";
        }
      }, 100);
    });
  }
  /* No smooth scrolling or transitions: a box measured while something is
     still moving lands a few pixels off its mark. */
  await ctx.addInitScript(() => {
    const css = "html,*{scroll-behavior:auto!important}*,*::before,*::after{transition:none!important;animation-duration:0s!important}";
    const add = () => { const st = document.createElement("style"); st.textContent = css; document.head.appendChild(st); };
    if (document.head) add(); else document.addEventListener("DOMContentLoaded", add);
  });
  const page = await ctx.newPage();
  await page.goto(`${BASE}${fig.path}`, { waitUntil: "domcontentloaded", timeout: 120000 });
  await settle(page);
  await run(page, fig.steps);

  /* Pop-up notices ("Read 1 file") cover what the figure is about. */
  if (!fig.toasts) await page.addStyleTag({ content: 'div.fixed[role="status"]{visibility:hidden!important}' });
  /* The mailbox warning strip at the top of the letter screens belongs to the
     state of one system on one day, not to the screen being explained. */
  /* (Hidden by the script added when the page was opened, because the strip
     appears whenever its own check finishes, which can be after the page has
     settled.) */

  let clip;
  if (fig.clip === "window") {
    const v = page.viewportSize();
    clip = { x: 0, y: 0, w: v.width, h: v.height };
  } else {
    await unfix(page);
    /* Make the window as tall as the page, so what is measured is laid out
       exactly as it is photographed. (A full-page screenshot resizes the
       window itself, and anything sized to the window moves.) */
    const tall = await page.evaluate(() => document.documentElement.scrollHeight);
    await page.setViewportSize({ width: page.viewportSize().width, height: Math.min(tall, 12000) });
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.waitForTimeout(700);
    if (fig.clip === "page") {
      const size = await page.evaluate(() => ({ w: document.documentElement.scrollWidth, h: document.documentElement.scrollHeight }));
      clip = { x: 0, y: 0, ...size };
    } else {
      const b = await box(page, fig.clip);
      /* Room around the crop for the numbered badges to sit outside the marks. */
      const m = 40;
      clip = { x: Math.max(0, b.x - m), y: Math.max(0, b.y - m), w: b.w + 2 * m, h: b.h + 2 * m };
      /* data-maxh: only the top of a long list. */
      if (fig.maxh) clip.h = Math.min(clip.h, fig.maxh);
    }
  }

  /* Kept inside the window: a crop that runs past its edge is cut short by the
     screenshot, and the marks would then be placed against the wrong size. */
  {
    const v = page.viewportSize();
    clip.w = Math.min(clip.w, v.width - clip.x);
    clip.h = Math.min(clip.h, v.height - clip.y);
  }
  await page.waitForTimeout(300);

  const marks = [];
  for (const mark of fig.marks) {
    const b = await box(page, mark.find).catch((e) => {
      throw new Error(`${fig.id}: could not find "${mark.find}" (${e.message.split("\n")[0]})`);
    });
    const p = mark.pad;
    marks.push({
      x: (b.x - p - clip.x) / clip.w,
      y: (b.y - p - clip.y) / clip.h,
      w: (b.w + 2 * p) / clip.w,
      h: (b.h + 2 * p) / clip.h,
    });
  }

  mkdirSync(join(HERE, "shots"), { recursive: true });
  await page.screenshot({
    path: join(HERE, "shots", `${fig.id}.png`),
    clip: { x: clip.x, y: clip.y, width: clip.w, height: clip.h },
    fullPage: false,
    animations: "disabled",
  });
  writeFileSync(join(HERE, "shots", `${fig.id}.json`), JSON.stringify({ w: clip.w, h: clip.h, marks }, null, 1));
  await ctx.close();
}

// ------------------------------------------------------------------- main

const only = process.argv.slice(2);
const todo = figures().filter((f) => !only.length || only.includes(f.id));
if (!todo.length) {
  console.error(only.length ? `No figure called ${only.join(", ")}` : "No figures found in chapters/");
  process.exit(1);
}
const browser = await chromium.launch({ executablePath: CHROME, headless: true });
let failed = 0;
for (const fig of todo) {
  try {
    await capture(browser, fig);
    console.log(`ok    ${fig.id}  (${fig.file})`);
  } catch (e) {
    failed++;
    console.log(`FAIL  ${fig.id}  ${e.message.split("\n")[0]}`);
  }
}
await browser.close();
process.exit(failed ? 1 : 0);
