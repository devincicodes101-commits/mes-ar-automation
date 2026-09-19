"""
The whole system on one page, as a single image.

    python scripts/build-architecture-image.py
    npm run build:architecture

Written because the thing that actually gets looked at is a picture somebody
can send on WhatsApp and open on a phone. A web page needs a link, a browser
and a network; a PNG needs none of those, and it survives being forwarded.

---------------------------------------------------------------------------
Told as the month, not as the stack

An earlier version drew the layers — browser, routes, database — with the URL
of every endpoint on it. That is the diagram an engineer joining the project
wants, and the wrong one for everybody else: it opens with the part of the
system nobody outside it will ever touch, and names things by how they are
built rather than by what they do.

So this starts where the work starts, with an officer and a spreadsheet, and
follows one month through to the next. No endpoint is named. A table is named
only where the point is that it cannot be rebuilt.

Under the six stages sit the three things somebody always asks next: how a
charge is aged, what stops a letter reaching a tenant, and which days of the
month the system acts on its own.

Drawn rather than screenshotted, so every box is placed deliberately and the
file can be regenerated when the system changes.
"""

import math
import os
from PIL import Image, ImageDraw, ImageFont

# --------------------------------------------------------------------- scale
#
# Drawn at 2x and left there. WhatsApp re-encodes what it sends, and a diagram
# that started at screen resolution comes out the other side unreadable, so it
# starts with room to lose.
S = 2
W, H = 1240 * S, 1306 * S

FONTS = "C:/Windows/Fonts"


def font(name, size):
    return ImageFont.truetype(os.path.join(FONTS, name), int(size * S))


REG, BOLD = "segoeui.ttf", "segoeuib.ttf"
MONO, MONOB = "consola.ttf", "consolab.ttf"

f_title = font(BOLD, 26)
f_sub = font(REG, 13)
f_layer = font(MONOB, 10)
f_stage = font(BOLD, 15)
f_body = font(REG, 11.5)
f_small = font(REG, 10)
f_tiny = font(REG, 9.5)
f_chip = font(MONO, 10)
f_num = font(MONOB, 17)
f_stagenum = font(MONOB, 12)
f_bucket = font(BOLD, 12.5)
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
SOFT = (198, 212, 216)
TINT = (240, 246, 247)
TEAL = (14, 110, 120)
AMBER = (156, 94, 7)
AMBER_BG = (253, 243, 223)
AMBER_LINE = (201, 167, 90)
RED = (166, 43, 33)
RED_BG = (250, 232, 230)
RED_LINE = (224, 176, 170)
RED_INK = (130, 45, 37)
AMBER_INK = (95, 74, 14)
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


def tracked(x, y, s, fill=TEAL):
    """The small spaced-out caps that name a band."""
    d.text((x * S, y * S), " ".join(s), font=f_layer, fill=fill, anchor="la")


def line(x1, y1, x2, y2, fill=(51, 82, 92), width=1.4):
    d.line([x1 * S, y1 * S, x2 * S, y2 * S], fill=fill, width=int(width * S))


def arrow(x1, y1, x2, y2, fill=(51, 82, 92), width=1.4, size=7):
    line(x1, y1, x2, y2, fill, width)
    a = math.atan2(y2 - y1, x2 - x1)
    for sign in (1, -1):
        b = a + sign * 2.5
        line(x2, y2, x2 + size * math.cos(b), y2 + size * math.sin(b), fill, width)


def bullets(x, y, items, gap=16, fill=INK2, f=None):
    """An item may be one line or several; only the first line gets a dot.

    Every wrapped line used to get its own, which turned one point into two and
    made a five-point list read as eight."""
    yy = y
    for item in items:
        lines = [item] if isinstance(item, str) else item
        d.ellipse([x * S, (yy + 5.5) * S, (x + 3.5) * S, (yy + 9) * S], fill=INK3)
        for ln in lines:
            text(x + 12, yy, ln, f or f_small, fill)
            yy += gap
    return yy


# ===================================================================== title

text(52, 44, "MES Group — Accounts Receivable", f_title, INK)
text(52, 80, "One month, end to end: from the report landing on a desk to knowing who "
             "paid. Built by DeVinci Codes.", f_sub, INK2)
d.line([52 * S, 106 * S, 1188 * S, 106 * S], fill=INK, width=int(2 * S))


# ==================================================================== stages

BW, BH = 352, 256
COL = [52, 436, 820]
ROW = [130, 418]


def stage(n, col, row, title, colour=TEAL):
    x, y = COL[col], ROW[row]
    box(x, y, BW, BH, outline=colour, width=1.6)
    d.ellipse([(x + 16) * S, (y + 16) * S, (x + 38) * S, (y + 38) * S], fill=colour)
    d.text(((x + 27) * S, (y + 27) * S), str(n), font=f_stagenum, fill=WHITE, anchor="mm")
    text(x + 48, y + 18, title, f_stage, INK)
    return x, y


def footer_strip(x, y, s, fill=TINT, outline=SOFT, tint=INK2):
    box(x + 16, y + BH - 46, BW - 32, 30, fill=fill, outline=outline)
    text(x + 28, y + BH - 38, s, f_small, tint)


# -- 1 ----------------------------------------------------------------------
x, y = stage(1, 0, 0, "The officer uploads")
text(x + 16, y + 48, "Any day of the month, usually the 4th.", f_small, INK3)

box(x + 16, y + 68, BW - 32, 82, fill=TINT, outline=SOFT)
text(x + 28, y + 76, "The AR report", f_noteb, INK)
text(x + 28, y + 94, "The Finance AR Download sheet, exported from", f_small, INK2)
text(x + 28, y + 108, "NetSuite. Every charge still owed across JPD1,", f_small, INK2)
text(x + 28, y + 122, "JPD2, Blue Stars and The Leo — around 190", f_small, INK2)
text(x + 28, y + 136, "tenants and 3,000 charge lines.", f_small, INK2)

box(x + 16, y + 156, BW - 32, 50, fill=TINT, outline=SOFT)
text(x + 28, y + 163, "The client contact list", f_noteb, INK)
text(x + 28, y + 180, "Only when it changes. Addresses are added to,", f_small, INK2)
text(x + 28, y + 192, "never wiped by a later upload.", f_small, INK2)

footer_strip(x, y, "Both files stay on the officer's machine until approved.")

arrow(COL[0] + BW + 4, ROW[0] + BH / 2, COL[1] - 10, ROW[0] + BH / 2)

# -- 2 ----------------------------------------------------------------------
x, y = stage(2, 1, 0, "It is read and checked")
text(x + 16, y + 48, "In the browser. Nothing has been sent anywhere yet.", f_small, INK3)
bullets(x + 16, y + 70, [
    ["Each charge is aged from its due date, not the",
     "billing date, and falls into one of five buckets"],
    ["What a charge is for is worked out from its",
     "description: occupancy, late fee, security",
     "deposit, 1FM maintenance"],
    ["Our total is checked against the file's own",
     "grand total — a mismatch stops the upload"],
    ["Anything unreadable is named, row by row"],
])
box(x + 16, y + BH - 46, BW - 32, 30, fill=AMBER_BG, outline=AMBER_LINE)
text(x + 28, y + BH - 38, "The officer reads all of this before approving it.",
     f_small, AMBER_INK)

arrow(COL[1] + BW + 4, ROW[0] + BH / 2, COL[2] - 10, ROW[0] + BH / 2)

# -- 3 ----------------------------------------------------------------------
x, y = stage(3, 2, 0, "Stored, once approved")
text(x + 16, y + 48, "One step. It all saves, or none of it does.", f_small, INK3)

box(x + 16, y + 68, 156, 102, fill=TINT, outline=SOFT)
text(x + 26, y + 76, "Rebuilt each upload", f_noteb, INK2)
for i, s in enumerate(["balances", "charges", "tenants", "addresses"]):
    text(x + 26, y + 96 + i * 17, s, f_chip, INK2)
box(x + 180, y + 68, 156, 102, fill=RED_BG, outline=RED_LINE)
text(x + 190, y + 76, "Exists nowhere else", f_noteb, RED)
for i, s in enumerate(["phone calls", "promises", "letters sent", "late fees"]):
    text(x + 190, y + 96 + i * 17, s, f_chip, RED_INK)

bullets(x + 16, y + 178, [
    ["Re-uploading a month replaces it. A different",
     "month is added; earlier months are untouched."],
], gap=14)

footer_strip(x, y, "A tenant who moved out keeps their record — work hangs off it.")

# the wrap from row one to row two, routed under the first row
WRAP_Y = ROW[0] + BH + 20
line(COL[2] + BW / 2, ROW[0] + BH, COL[2] + BW / 2, WRAP_Y)
line(COL[2] + BW / 2, WRAP_Y, COL[0] + BW / 2, WRAP_Y)
arrow(COL[0] + BW / 2, WRAP_Y, COL[0] + BW / 2, ROW[1] - 6)
text(COL[1] + 24, WRAP_Y - 18, "this is now the month every screen shows", f_small, INK3)

# -- 4 ----------------------------------------------------------------------
x, y = stage(4, 0, 1, "Every screen updates")
text(x + 16, y + 48, "The same figures for everyone, on any machine.", f_small, INK3)
bullets(x + 16, y + 70, [
    ["Outstanding Balances — total owed, what needs",
     "chasing, what is over 90 days, who is in credit"],
    ["Call List — worst money first, with the reason",
     "each tenant is on it"],
    ["Send By Hand — the tenants with no address"],
    ["What Changed — who paid since last month"],
    ["Repeat Defaulters · Chased to the End · Dry Run"],
])
footer_strip(x, y, "A relationship manager sees only their own tenants.")

arrow(COL[0] + BW + 4, ROW[1] + BH / 2, COL[1] - 10, ROW[1] + BH / 2)

# -- 5 ----------------------------------------------------------------------
x, y = stage(5, 1, 1, "The chasing happens", RED)
text(x + 16, y + 48, "On MES's dates, whether or not anyone is at a desk.", f_small, INK3)

box(x + 16, y + 70, BW - 32, 84, fill=RED_BG, outline=RED_LINE)
text(x + 28, y + 78, "7th — first reminder        21st — final notice", f_noteb, RED)
text(x + 28, y + 97, "Letters leave from the officer's own Gmail, so the", f_small, RED_INK)
text(x + 28, y + 111, "tenant sees a real person at MES. Sent one at a", f_small, RED_INK)
text(x + 28, y + 125, "time, and recorded as sent only once the mail", f_small, RED_INK)
text(x + 28, y + 139, "server has accepted it.", f_small, RED_INK)

box(x + 16, y + 158, 156, 48, fill=AMBER_BG, outline=AMBER_LINE)
text(x + 26, y + 164, "16th — late fee", f_noteb, AMBER_INK)
text(x + 26, y + 180, "S$100, once a month.", f_small, AMBER)
text(x + 26, y + 192, "GIRO tenants held back.", f_small, AMBER)

box(x + 180, y + 158, 156, 48, fill=TINT, outline=SOFT)
text(x + 190, y + 164, "No email address", f_noteb, INK2)
text(x + 190, y + 180, "They go on the call list", f_small, INK2)
text(x + 190, y + 192, "and are phoned instead.", f_small, INK2)

footer_strip(x, y, "Every call and promise is logged against the tenant.")

arrow(COL[1] + BW + 4, ROW[1] + BH / 2, COL[2] - 10, ROW[1] + BH / 2)

# -- 6 ----------------------------------------------------------------------
x, y = stage(6, 2, 1, "Next month answers")
text(x + 16, y + 48, "The next report says what the chasing achieved.", f_small, INK3)
bullets(x + 16, y + 70, [
    ["Missing from the newer report — paid in full"],
    ["A smaller balance — a part payment"],
    ["A larger balance — owes more than before"],
    ["The same balance in an older bucket — the",
     "money aged, even though nothing was paid"],
    ["A name not seen before — owing for the",
     "first time"],
])
footer_strip(x, y, "No arithmetic across files. The report is the truth.")


# ================================================================== buckets

BK_Y = 700
box(52, BK_Y, 1136, 108, fill=WHITE, outline=LINE)
tracked(68, BK_Y + 14, "HOW OVERDUE A CHARGE IS — COUNTED FROM ITS DUE DATE")
text(660, BK_Y + 16, "MES's own five buckets. Every screen and every letter uses these.",
     f_small, INK3)

buckets = [
    ("Current", "0 – 15 days", "not chased yet", TEAL, TINT, SOFT),
    ("30 days", "16 – 45 days", "chasing begins", AMBER, AMBER_BG, AMBER_LINE),
    ("60 days", "46 – 75 days", "", AMBER, AMBER_BG, AMBER_LINE),
    ("90 days", "76 – 105 days", "", RED, RED_BG, RED_LINE),
    ("Over 90 days", "106 days and on", "hardest to recover", RED, RED_BG, RED_LINE),
]
bw = 214
for i, (name, span, note, tint, bg, edge) in enumerate(buckets):
    bx = 68 + i * (bw + 8)
    box(bx, BK_Y + 34, bw, 56, fill=bg, outline=edge)
    text(bx + 12, BK_Y + 41, name, f_bucket, tint)
    text(bx + 12, BK_Y + 59, span, f_chip, INK2)
    if note:
        text(bx + 12, BK_Y + 74, note, f_tiny, INK3)
    if i:
        arrow(bx - 6, BK_Y + 62, bx - 1, BK_Y + 62, INK3, 1.2, 4)


# ==================================================================== gates

GT_Y = 828
box(52, GT_Y, 1136, 112, fill=WHITE, outline=LINE)
tracked(68, GT_Y + 14, "WHAT STOPS A LETTER")
text(400, GT_Y + 16, "Five checks. Any one of them refusing means nothing is sent, "
                     "and nothing is recorded as sent.", f_small, INK3)

gates = [
    ("Sending is switched off", "Letters are still written", "and recorded. None leave."),
    ("Not on the approved list", "While testing, only agreed", "addresses can be written to."),
    ("The tenant has no address", "They go to the call list", "and are phoned instead."),
    ("A blank was left in it", "A demand addressed to", "{{company}} is worse than none."),
    ("No mailbox is connected", "Nobody has signed in with", "Google. Blocked, not failed."),
]
gw = 214
for i, (title, l1, l2) in enumerate(gates):
    gx = 68 + i * (gw + 8)
    box(gx, GT_Y + 38, gw, 60, fill=TINT, outline=SOFT)
    d.ellipse([(gx + 10) * S, (GT_Y + 46) * S, (gx + 25) * S, (GT_Y + 61) * S], fill=RED)
    d.text(((gx + 17.5) * S, (GT_Y + 53.5) * S), str(i + 1),
           font=font(MONOB, 9), fill=WHITE, anchor="mm")
    text(gx + 32, GT_Y + 46, title, f_noteb, INK)
    text(gx + 12, GT_Y + 68, l1, f_tiny, INK2)
    text(gx + 12, GT_Y + 81, l2, f_tiny, INK2)


# ================================================================= the month

MB_Y = 960
box(52, MB_Y, 1136, 216, fill=WHITE, outline=LINE)
tracked(68, MB_Y + 14, "THE MONTH — SIX DAYS CARRY MEANING")
text(560, MB_Y + 16, "Every other day, the schedule wakes, finds nothing to do, and stops.",
     f_small, INK3)

box(940, MB_Y + 38, 232, 36, fill=AMBER_BG, outline=AMBER_LINE)
text(952, MB_Y + 45, "09:00 daily, Singapore time", f_noteb, AMBER_INK)
text(952, MB_Y + 60, "Nobody has to remember to run it.", f_small, AMBER)

BAR_Y = MB_Y + 126
x0, x1 = 132, 890
d.line([x0 * S, BAR_Y * S, x1 * S, BAR_Y * S], fill=LINE, width=int(1.6 * S))


def day_x(day):
    return x0 + (day - 1) / 30 * (x1 - x0)


# Alternating sides. The 15th and the 16th are one day apart and would print on
# top of each other otherwise, which is the whole reason for alternating.
days = [
    (1, "GIRO deductions", "14-day deadline passes", TEAL, "up"),
    (4, "Report uploaded", "the month is rebuilt", TEAL, "down"),
    (7, "First reminder", "letters go out", RED, "up"),
    (15, "Second deadline", "30 days from billing", TEAL, "down"),
    (16, "S$100 late fee", "GIRO tenants held back", AMBER, "up"),
    (21, "Final notice", "letters go out", RED, "down"),
]

for day, label, sub, colour, side in days:
    dx = day_x(day)
    r = 5.5 if colour is TEAL else 6.5
    d.ellipse([(dx - r) * S, (BAR_Y - r) * S, (dx + r) * S, (BAR_Y + r) * S], fill=colour)
    if side == "up":
        line(dx, BAR_Y - 7, dx, BAR_Y - 30, colour, 1.3)
        d.text((dx * S, (BAR_Y - 36) * S), str(day), font=f_num, fill=colour, anchor="ms")
        d.text((dx * S, (BAR_Y - 56) * S), label, font=f_daylbl, fill=colour, anchor="ms")
        d.text((dx * S, (BAR_Y - 71) * S), sub, font=f_daysub, fill=INK2, anchor="ms")
    else:
        line(dx, BAR_Y + 7, dx, BAR_Y + 28, colour, 1.3)
        d.text((dx * S, (BAR_Y + 46) * S), str(day), font=f_num, fill=colour, anchor="ms")
        d.text((dx * S, (BAR_Y + 64) * S), label, font=f_daylbl, fill=INK, anchor="ms")
        d.text((dx * S, (BAR_Y + 79) * S), sub, font=f_daysub, fill=INK2, anchor="ms")

d.text((x0 * S, (BAR_Y + 21) * S), "day 1", font=f_chip, fill=INK3, anchor="ms")
d.text((x1 * S, (BAR_Y + 21) * S), "31", font=f_chip, fill=INK3, anchor="ms")

for i, (colour, label) in enumerate([
    (RED, "sends mail"), (AMBER, "raises money"), (TEAL, "moves the picture"),
]):
    yy = BAR_Y - 30 + i * 22
    d.ellipse([944 * S, yy * S, 954 * S, (yy + 10) * S], fill=colour)
    text(962, yy - 1, label, f_small, INK2)


# ================================================================== footnotes

d.line([52 * S, 1200 * S, 1188 * S, 1200 * S], fill=(214, 223, 226), width=int(1 * S))
text(52, 1216, "What the system will not do", f_noteb, INK)
for i, n in enumerate([
    "Charge the S$100 fee twice, or to a tenant paying by GIRO.",
    "Replace a month of real figures with a file it could not read.",
    "Let a relationship manager see another manager's tenants.",
]):
    text(64, 1238 + i * 17, "—   " + n, f_note, INK2)

text(700, 1238, "A missed day is caught up the next morning, not lost.", f_note, INK2)
text(700, 1255, "Every letter records which mailbox it actually left from.", f_note, INK2)
text(700, 1272, "Every figure here is taken from the system as it runs today.", f_note, INK3)


# ======================================================================= save

out = os.path.join(os.environ.get("USERPROFILE", "."), "Downloads",
                   "MES AR System — How it works.png")
img.save(out, "PNG", optimize=True)
print(out)
print("  %d x %d px   %.1f KB" % (img.width, img.height, os.path.getsize(out) / 1024))
