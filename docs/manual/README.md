# MES AR Automation user manual

The PDF user manual, built from plain HTML chapters and screenshots taken from
the running app. To change the manual, edit a chapter and rebuild. Do not edit
the PDF.

```
docs/manual/
  manual.json       title, edition, output file name
  cover.html        the cover page ({{title}}-style fields come from manual.json)
  manual.css        the look: A4, MES blue, red marks, panels, test tables
  chapters/*.html   one file per chapter, in file-name order
  shots/            screenshots (PNG) and where to draw their marks (JSON); generated
  samples/          the shortened AR report and contact list the screenshots and tests use
  shots.mjs         takes the screenshots
  build.mjs         builds out/MES-AR-User-Manual.pdf
  pages.py          page numbers for the contents, and the final merge (used by build.mjs)
  out/              the built PDF (and the HTML it was printed from)
```

## Building

Needs Node 18+, Python 3 with `pypdf`, and Google Chrome installed.

```
cd docs/manual
npm install                 # once: playwright-core, which drives the installed Chrome
node shots.mjs              # every screenshot (or: node shots.mjs upload-page settings-mailbox)
node build.mjs              # out/MES-AR-User-Manual.pdf
```

`shots.mjs` signs in to the live site. Put the logins in `docs/manual/.env`,
which git ignores:

```
MANUAL_BASE=https://mes-ar-automation.vercel.app
MANUAL_EMAIL=...            # an Admin login
MANUAL_PASSWORD=...
MANUAL_CSD_EMAIL=...        # optional: for figures with data-as="csd"
MANUAL_CSD_PASSWORD=...
MANUAL_RM_EMAIL=...         # data-as="rm"
MANUAL_RM_PASSWORD=...
MANUAL_MANAGEMENT_EMAIL=... # data-as="management"
MANUAL_MANAGEMENT_PASSWORD=...
```

A figure with `data-as="rm"` (or `csd`, `management`) needs that login switched on in User
Management while it is taken. Switch it off again afterwards if it is a test login.

If the PDF is open in a viewer, Windows will not let it be replaced, and the build writes
`out/MES-AR-User-Manual (new).pdf` instead.

Taking screenshots only reads the app. It never presses a button that saves
or sends, unless a figure's steps tell it to. Do not write steps that press
**Use this report**, **Send**, **Save** or **Disconnect** against the live site.

## Writing a chapter

A chapter is one file in `chapters/`, ordered by its name (`03-upload.html`
comes third). It is plain HTML with no `<html>` or `<body>`.

- `<h1>` is the chapter title and each `<h2>` a section. Both are numbered by
  the build and listed in the contents, so do not type numbers.
- `<section class="part" data-part="The monthly cycle"></section>` at the top
  starts a new part of the contents.
- A first line containing `data-planned` lists the chapter in the contents as
  *in full manual* and leaves it out of the body. Delete that line once the
  chapter is written.
- Cross-references ("section 3.6", "figure 9.1") are typed by hand. Check them
  after moving sections.

Style, kept plain on purpose so it reads as written by a person:

- No em dashes, few italics, bold only for button and field names.
- One box style for side notes, neutral grey, with its label saying what it is:
  `<div class="note"><span class="label">Good to know</span><p>…</p></div>`
  (also "Careful", "If Microsoft says …", "For the system administrator").
- Steps are a plain `<ol>`. On-screen messages are in quotation marks.
- Every screen chapter follows the same order: an opening paragraph
  (`<p class="lead">`), "The screen" with a marked screenshot, one section per
  task, and "What happens in the background" last.

| HTML | Shows |
|---|---|
| `<p class="lead">` | the opening paragraph |
| `<div class="note"><span class="label">…</span>…</div>` | the neutral side box |
| `<table class="tests">` | a test table: #, Do this, You should see, Pass (`<span class="box"></span>`) |
| `<figure class="diagram"><svg>…</svg><figcaption>` | a drawn diagram, in black and grey (see chapters 1 and 12) |

## Screenshots and their red marks

A screenshot is a `<figure class="shot">` in the chapter. The same element says
what to capture and what to circle, so the picture and its notes cannot drift
apart:

```html
<figure class="shot" id="upload-review" data-path="/upload"
  data-steps="file: input[type=file] => samples/QA AR report - as of 23 Oct 2026.xlsx ;; click: role=button[name='Read the file'] ;; wait: text=Compared with the report of"
  data-clip="main div.rounded-lg.bg-surface:has-text('Use this report for')">
  <figcaption>The question before saving, and what would change.</figcaption>
  <ol>
    <li data-find="role=button[name='Use this report']">Use this report saves it for everyone.</li>
  </ol>
</figure>
```

| Attribute | Meaning |
|---|---|
| `id` | the file name in `shots/`; must be unique |
| `data-path` | the page to open |
| `data-steps` | what to do first, separated by `;;`: `click: sel`, `fill: sel => text`, `file: sel => path`, `select: sel => value`, `hover: sel`, `scroll: sel`, `wait: ms` or `wait: sel`, `goto: /path` |
| `data-clip` | `window` (the whole screen with the menu, the default), `page` (the whole page), or a selector to crop to one box |
| `data-device` | `desktop` (1120 wide, the default) or `phone` (390 wide) |
| `data-height` | window height, when `window` needs more or less than 760 |
| `data-maxh` | cut a crop to this height (CSS pixels), to show only the top of a long list |
| `data-vw` | window width, for a wide table that would otherwise scroll sideways (for example 1440) |
| `data-width` | print it narrower than the page (CSS pixels, page width is 650) |
| `data-as` | `admin` (default), `csd`, `rm` or `management` |
| `data-toasts` | keep the pop-up notices, which are hidden otherwise |

Each `<li data-find="selector">` draws a numbered red box around what the
selector finds. Its text becomes the numbered note under the picture. Add
`data-pad="-4"` to draw the box just inside the element, for boxes stacked on
top of each other.
Every `<li>` in the list needs a `data-find`, or the numbers and boxes go out
of step.

Selectors are Playwright's: `text=…`, `role=button[name='…']`, CSS with
`:has-text('…')`, `:has(…)`, `:text-matches('a|b')`, and `>> nth=0` for the
first match. Cards in the app are `div.rounded-lg.bg-surface`. Use `>` to
reach their direct parts.

If the app changes, run `node shots.mjs <id>` for the figures affected and
rebuild. A mark whose selector no longer finds anything fails with the
figure's name. A figure with no screenshot yet prints as a dashed placeholder
that names the command to run.
