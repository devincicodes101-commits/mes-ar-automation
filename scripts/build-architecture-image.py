"""
The whole system on one page, as a single image.

    python scripts/build-architecture-image.py

Written because the thing that actually gets looked at is a picture somebody
can send on WhatsApp and open on a phone. A web page needs a link, a browser
and a network; a PNG needs none of those, and it survives being forwarded.

Drawn rather than screenshotted so that every box is positioned deliberately
and the file can be regenerated when the system changes. The figures in it are
the real ones: six cycle days, the $100 fee on the 16th, four dormitories, the
tables that exist and the ones that cannot be rebuilt.
"""

import os
from PIL import Image, ImageDraw, ImageFont

# --------------------------------------------------------------------- scale
#
# Drawn at 2x and left there. WhatsApp re-encodes what it sends, and a diagram
# that started at screen resolution comes out the other side unreadable, so it
# starts with room to lose.
S = 2
W, H = 1240 * S, 1000 * S

FONTS = "C:/Windows/Fonts"


def font(name, size):
    return ImageFont.truetype(os.path.join(FONTS, name), int(size * S))


REG = "segoeui.ttf"
BOLD = "segoeuib.ttf"
MONO = "consola.ttf"
MONOB = "consolab.ttf"

f_title = font(BOLD, 26)
f_sub = font(REG, 13)
f_layer = font(MONOB, 10)
f_head = font(BOLD, 14)
f_body = font(REG, 11)
f_small = font(REG, 10)
f_chip = font(MONO, 10.5)
f_num = font(MONOB, 17)
f_daylbl = font(BOLD, 11)
f_daysub = font(REG, 10)
f_note = font(REG, 10.5)
f_noteb = font(BOLD, 10.5)

# ------------------------------------------------------------------- palette

PAPER = (247, 249, 250)
INK = (15, 29, 36)
INK2 = (70, 96, 107)
INK3 = (122, 146, 156)
LINE = (168, 186, 192)
TEAL = (14, 110, 120)
TEAL_BG = (220, 238, 240)
AMBER = (156, 94, 7)
AMBER_BG = (253, 243, 223)
AMBER_LINE = (201, 167, 90)
RED = (166, 43, 33)
RED_BG = (250, 232, 230)
WHITE = (255, 255, 255)

img = Image.new("RGB", (W, H), PAPER)
d = ImageDraw.Draw(img)


# ------------------------------------------------------------------- helpers

def box(x, y, w, h, fill=WHITE, outline=LINE, width=1, radius=4):
    d.rounded_rectangle(
        [x * S, y * S, (x + w) * S, (y + h) * S],
        radius=radius * S, fill=fill, outline=outline, width=int(width * S),
    )


def text(x, y, s, f=None, fill=INK, anchor="la"):
    d.text((x * S, y * S), s, font=f or f_body, fill=fill, anchor=anchor)


def layer_label(x, y, s, fill=TEAL):
    """The small tracked-out caps that name a band, as in the reference."""
    d.text((x * S, y * S), " ".join(s), font=f_layer, fill=fill, anchor="la")


def arrow(x1, y1, x2, y2, fill=(51, 82, 92), width=1.4, head=6, dash=None):
    if dash:
        _dashed(x1, y1, x2, y2, fill, width, dash)
    else:
        d.line([x1 * S, y1 * S, x2 * S, y2 * S], fill=fill, width=int(width * S))
    # arrowhead, pointing along the line
    import math
    a = math.atan2(y2 - y1, x2 - x1)
    for sign in (1, -1):
        b = a + sign * 2.5
        d.line(
            [x2 * S, y2 * S, (x2 + head * math.cos(b)) * S, (y2 + head * math.sin(b)) * S],
            fill=fill, width=int(width * S),
        )


def _dashed(x1, y1, x2, y2, fill, width, dash):
    import math
    total = math.hypot(x2 - x1, y2 - y1)
    if total == 0:
        return
    ux, uy = (x2 - x1) / total, (y2 - y1) / total
    on, off = dash
    pos = 0.0
    while pos < total:
        seg = min(on, total - pos)
        d.line(
            [(x1 + ux * pos) * S, (y1 + uy * pos) * S,
             (x1 + ux * (pos + seg)) * S, (y1 + uy * (pos + seg)) * S],
            fill=fill, width=int(width * S),
        )
        pos += on + off


def chip(x, y, w, label, fill=TEAL_BG, outline=LINE, tint=INK):
    box(x, y, w, 21, fill=fill, outline=outline, radius=3)
    text(x + 8, y + 5, label, f_chip, tint)


# ===================================================================== title

text(52, 44, "MES Group — Accounts Receivable Automation", f_title, INK)
text(52, 80, "How the system is put together, and what it does on its own. "
             "Built by DeVinci Codes.", f_sub, INK2)
d.line([52 * S, 104 * S, 1188 * S, 104 * S], fill=INK, width=int(2 * S))


# =============================================================== client layer

box(300, 128, 640, 92, outline=TEAL, width=1.6)
layer_label(316, 140, "CLIENT LAYER")
text(316, 158, "The browser — Next.js, React, TypeScript", f_head, INK)
text(316, 180, "Upload Reports · Outstanding Balances · Reminder Emails · Call List", f_body, INK2)
text(316, 195, "Send By Hand · Payment Promises · What Changed · Sent Mail · Dry Run", f_body, INK2)

text(954, 152, "The spreadsheet is", f_small, INK3)
text(954, 166, "read in the browser.", f_small, INK3)
text(954, 186, "Tenant data never", f_small, INK3)
text(954, 200, "leaves the officer's", f_small, INK3)
text(954, 214, "machine unread.", f_small, INK3)

arrow(620, 220, 620, 252)
text(630, 228, "HTTPS  ·  signed-in request", f_chip, (51, 82, 92))


# ================================================================== api layer

box(180, 254, 880, 122, outline=LINE)
layer_label(196, 266, "API ROUTES — NODE, ON VERCEL")

# The cron chip sits first, beside the schedule that calls it, so the one route
# nobody presses is next to the only thing that presses it.
chip(196, 286, 96, "/api/cron", AMBER_BG, AMBER_LINE, (95, 74, 14))
chips = [
    ("/api/upload", 306, 108),
    ("/api/dataset", 426, 112),
    ("/api/send", 550, 94),
    ("/api/activity", 656, 112),
    ("/api/movement", 780, 122),
    ("/api/mail/*", 914, 104),
]
for label, x, w in chips:
    chip(x, 286, w, label)

text(196, 320, "Every route verifies the caller before anything runs, and reads their role from the", f_body, INK2)
text(196, 336, "database — never from the request. These routes hold the keys to everything.", f_body, INK2)
text(196, 358, "All the rules MES gave us live in one tested library, called by the screens and the schedule alike.",
     f_small, INK3)

# the schedule, calling in from the side
box(52, 266, 106, 62, fill=AMBER_BG, outline=AMBER_LINE)
layer_label(64, 276, "SCHEDULE", AMBER)
text(64, 292, "09:00 daily", f_head, (95, 74, 14))
text(64, 312, "Singapore time", f_small, AMBER)
_dashed(158, 296, 188, 296, AMBER_LINE, 1.3, (5, 4))
arrow(182, 296, 196, 296, AMBER_LINE, 1.3)

arrow(400, 376, 400, 414)
arrow(840, 376, 840, 414)


# ==================================================================== storage

box(180, 416, 500, 190, outline=TEAL, width=1.6)
layer_label(196, 428, "SUPABASE POSTGRES — SINGAPORE")
text(196, 446, "The only memory", f_head, INK)

box(196, 472, 224, 116, fill=(240, 246, 247), outline=(198, 212, 216))
text(208, 482, "Rebuilt on every upload", f_noteb, INK2)
for i, s in enumerate([
    "uploads", "tenants", "account_snapshots", "invoices", "contacts",
]):
    text(208, 502 + i * 16, s, f_chip, INK2)

box(436, 472, 228, 116, fill=RED_BG, outline=(224, 176, 170))
text(448, 482, "Exists nowhere else", f_noteb, RED)
for i, s in enumerate([
    "calls", "promises", "emails_sent", "late_fees", "cron_runs",
]):
    text(448, 502 + i * 16, s, f_chip, (130, 45, 37))


# =================================================================== external

box(700, 416, 360, 190, outline=LINE)
layer_label(716, 428, "OUTSIDE MES")
text(716, 446, "Google", f_head, INK)

box(716, 472, 328, 52, fill=(240, 246, 247), outline=(198, 212, 216))
text(728, 480, "Sign in once", f_noteb, INK2)
text(728, 498, "Each officer connects their own Gmail. The", f_small, INK2)
text(728, 512, "connection is kept, so the 7th can send.", f_small, INK2)

box(716, 532, 328, 56, fill=(240, 246, 247), outline=(198, 212, 216))
text(728, 540, "Letters leave as that person", f_noteb, INK2)
text(728, 558, "A tenant sees a real name at MES, not a", f_small, INK2)
text(728, 572, "system address nobody can reply to.", f_small, INK2)


# ============================================================== the month bar

box(180, 616, 880, 224, fill=WHITE, outline=LINE)
layer_label(196, 630, "THE MONTH — SIX DAYS CARRY MEANING")

BAR_Y = 740
x0, x1 = 260, 1000
d.line([x0 * S, BAR_Y * S, x1 * S, BAR_Y * S], fill=LINE, width=int(1.6 * S))


def day_x(day):
    return x0 + (day - 1) / 30 * (x1 - x0)


# Alternating sides. The 15th and the 16th are a day apart and would otherwise
# print on top of each other, which is the whole reason for alternating at all.
days = [
    (1, "GIRO deductions", "14-day deadline passes", TEAL, "up"),
    (4, "Report uploaded", "the month is rebuilt", TEAL, "down"),
    (7, "First reminder", "letters go out", RED, "up"),
    (15, "Second deadline", "30 days from billing", TEAL, "down"),
    (16, "S$100 late fee", "GIRO tenants held back", AMBER, "up"),
    (21, "Final notice", "letters go out", RED, "down"),
]

for day, label, sub, colour, side in days:
    x = day_x(day)
    r = 5.5 if colour is TEAL else 6.5
    d.ellipse([(x - r) * S, (BAR_Y - r) * S, (x + r) * S, (BAR_Y + r) * S], fill=colour)
    if side == "up":
        d.line([x * S, (BAR_Y - 7) * S, x * S, (BAR_Y - 32) * S], fill=colour, width=int(1.3 * S))
        d.text((x * S, (BAR_Y - 38) * S), str(day), font=f_num, fill=colour, anchor="ms")
        d.text((x * S, (BAR_Y - 58) * S), label, font=f_daylbl, fill=colour, anchor="ms")
        d.text((x * S, (BAR_Y - 73) * S), sub, font=f_daysub, fill=INK2, anchor="ms")
    else:
        d.line([x * S, (BAR_Y + 7) * S, x * S, (BAR_Y + 30) * S], fill=colour, width=int(1.3 * S))
        d.text((x * S, (BAR_Y + 48) * S), str(day), font=f_num, fill=colour, anchor="ms")
        d.text((x * S, (BAR_Y + 66) * S), label, font=f_daylbl, fill=INK, anchor="ms")
        d.text((x * S, (BAR_Y + 81) * S), sub, font=f_daysub, fill=INK2, anchor="ms")

d.text((x0 * S, (BAR_Y + 22) * S), "day 1", font=f_chip, fill=INK3, anchor="ms")
d.text((x1 * S, (BAR_Y + 22) * S), "31", font=f_chip, fill=INK3, anchor="ms")

# On the heading line, not under the bar: below the bar it lands on the label
# for the 4th, and the two read as one sentence.
text(700, 632, "Every other day, the schedule wakes, finds nothing to do, and stops.",
     f_small, INK3)


# ============================================================ what happens box

box(52, 416, 110, 190, fill=(240, 246, 247), outline=(198, 212, 216))
layer_label(64, 428, "LEGEND", INK3)
d.line([64 * S, 454 * S, 96 * S, 454 * S], fill=(51, 82, 92), width=int(1.4 * S))
arrow(88, 454, 98, 454)
text(64, 462, "a call", f_small, INK2)
_dashed(64, 490, 98, 490, AMBER_LINE, 1.3, (5, 4))
text(64, 498, "the schedule,", f_small, INK2)
text(64, 512, "nobody logged in", f_small, INK2)
d.ellipse([64 * S, 540 * S, 74 * S, 550 * S], fill=RED)
text(80, 539, "sends mail", f_small, INK2)
d.ellipse([64 * S, 564 * S, 74 * S, 574 * S], fill=AMBER)
text(80, 563, "raises money", f_small, INK2)


# ================================================================== send flow

box(1078, 128, 110, 478, fill=WHITE, outline=LINE)
layer_label(1090, 142, "REMINDER", TEAL)
text(1090, 160, "end to end", f_small, INK3)

steps = [
    "The officer picks the wording on Reminder Emails.",
    "The letter is filled in with that tenant's own balance and dates.",
    "Five checks decide whether it may leave at all.",
    "Gmail delivers it, one tenant at a time.",
    "It is recorded as sent only once Google accepts it.",
    "A tenant with no address goes to the call list instead.",
]


def wrapped(s_, width):
    """Wrapped by character count. The column is fixed and so is the wording,
    so a measured wrap would buy nothing a counted one does not."""
    words, line, lines = s_.split(), "", []
    for w in words:
        trial = (line + " " + w).strip()
        if len(trial) > width:
            lines.append(line)
            line = w
        else:
            line = trial
    lines.append(line)
    return lines


y = 184
for n, step in enumerate(steps, 1):
    d.ellipse([1090 * S, y * S, (1090 + 15) * S, (y + 15) * S], fill=TEAL)
    d.text(((1090 + 7.5) * S, (y + 7.5) * S), str(n), font=font(MONOB, 9), fill=WHITE, anchor="mm")
    lines = wrapped(step, 19)
    for i, ln in enumerate(lines):
        text(1090, y + 21 + i * 13, ln, f_small, INK2)
    y += 28 + len(lines) * 13


# ==================================================================== footnote

d.line([52 * S, 862 * S, 1188 * S, 862 * S], fill=(214, 223, 226), width=int(1 * S))
text(52, 878, "What the system will not do", f_noteb, INK)
notes = [
    "Send to anyone who is not on the approved list while it is being tested.",
    "Record a letter as sent unless a mail server accepted it.",
    "Charge the S$100 fee twice, or to a tenant on GIRO.",
    "Replace a month of real figures with a file it could not read.",
]
for i, n in enumerate(notes):
    text(64, 900 + i * 17, "—   " + n, f_note, INK2)

text(700, 900, "190 tenants · 4 dormitories: JPD1, JPD2, Blue Stars, The Leo", f_note, INK2)
text(700, 917, "Charges age from the due date. Chasing begins at 16 days.", f_note, INK2)
text(700, 934, "A missed day is caught up the next morning, not lost.", f_note, INK2)
text(700, 951, "Every figure here is taken from the system as it runs today.", f_note, INK3)


# ======================================================================= save

out = os.path.join(os.environ.get("USERPROFILE", "."), "Downloads",
                   "MES AR System — Architecture.png")
img.save(out, "PNG", optimize=True)
print(out)
print("  %d x %d px   %.1f KB" % (img.width, img.height, os.path.getsize(out) / 1024))
