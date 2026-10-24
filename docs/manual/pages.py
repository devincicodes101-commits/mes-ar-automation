"""Page numbers for the contents, and the final merge. Called by build.mjs.

  python pages.py find  pass1.pdf id1 id2 ...   -> {"id1": 3, ...} on stdout
  python pages.py merge out.pdf outline.json cover.pdf body.pdf

Chrome writes a named destination for every element a link points at, and the
contents links to every heading, so the page a heading landed on is the page
of its destination. Numbers are the body's own, as printed in its footer.
"""

import json
import os
import sys

from pypdf import PdfReader, PdfWriter


def find(pdf, ids):
    reader = PdfReader(pdf)
    dests = reader.named_destinations
    out = {}
    for i in ids:
        d = dests.get(i) or dests.get("/" + i)
        if d is not None:
            out[i] = reader.get_destination_page_number(d) + 1
    print(json.dumps(out))


def merge(target, outline_file, cover, body):
    writer = PdfWriter()
    writer.append(PdfReader(cover), import_outline=False)
    offset = len(writer.pages)
    writer.append(PdfReader(body), import_outline=False)
    parent = None
    for item in json.load(open(outline_file, encoding="utf-8")):
        if not item.get("page"):
            continue
        made = writer.add_outline_item(item["title"], item["page"] - 1 + offset,
                                       parent=parent if item["level"] == 2 else None)
        if item["level"] == 1:
            parent = made
    writer.add_metadata({"/Title": "MES AR Automation - User Manual", "/Author": "MES Group"})
    tmp = target + ".tmp"
    with open(tmp, "wb") as f:
        writer.write(f)
    try:
        os.replace(tmp, target)
        print(f"Built {target}")
    except PermissionError:
        # The PDF is open in a viewer, which locks it on Windows.
        alt = target[:-4] + " (new).pdf"
        os.replace(tmp, alt)
        print(f"{target} is open in another program, so this build is {alt}")


if __name__ == "__main__":
    cmd, *rest = sys.argv[1:]
    if cmd == "find":
        find(rest[0], rest[1:])
    elif cmd == "merge":
        merge(rest[0], *rest[1:])
    else:
        sys.exit(f"unknown command {cmd}")
