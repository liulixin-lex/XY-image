#!/usr/bin/env python3
"""
Split the display face (优设标题黑 / YouSheBiaoTiHei) into unicode-range
chunks, the same way Google Fonts serves CJK: a page downloads only the
chunks that hold the glyphs it renders (a two-line headline costs a few
small files instead of the 1.4 MB original).

Chunk boundaries reuse Google's frequency-ordered slices for Noto Sans SC
(`font-src/cjk-slices.json`, captured from fonts.googleapis.com), so common
characters cluster together and headlines touch as few chunks as possible.

Licence: 优设标题黑 is published by YouShe Network Technology (优设网) as free
for commercial use. The font's name table carries its copyright and is kept
as is (no renaming); CSS refers to it as "GGUU Display" only as a local
family alias. TODO(owner): keep the publisher's licence text with the launch
checklist and re-check it allows web subsetting before going live.

The first chunk, `display-ui.woff2`, holds Latin, punctuation and every
CJK character that appears in the app's own source (headings, labels and
buttons all come from there). The root layout preloads it, so the display
lines of any page paint in the right face on first render instead of
swapping chunk by chunk; user text falls through to the frequency chunks.
Re-run this script after adding copy with new characters.

Usage (needs fontTools + brotli, e.g. `pip install fonttools brotli`):
    python3 scripts/split-display-font.py

Outputs:
    public/fonts/display/display-<n>.woff2 (+ NOTICE.txt)
    src/app/display-font.css   (imported by globals.css)
"""
import json
import os
import re
import shutil
import sys
import tempfile

from fontTools import subset
from fontTools.ttLib import TTFont

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, "scripts/font-src/YouSheBiaoTiHei.woff2")
SLICES = os.path.join(ROOT, "scripts/font-src/cjk-slices.json")
OUT_DIR = os.path.join(ROOT, "public/fonts/display")
CSS_OUT = os.path.join(ROOT, "src/app/display-font.css")
SRC_DIR = os.path.join(ROOT, "src")
UI_CHUNK = "display-ui.woff2"
FAMILY = "GGUU Display"
NOTICE = (
    "Display face: 优设标题黑 (YouSheBiaoTiHei) v1.00,\n"
    "(c) Copyright YouShe Network Technology Co., Ltd. Published by its owner\n"
    "as free for commercial use. Served here as unicode-range subsets.\n"
)


def compact_ranges(codepoints):
    """[0x41, 0x42, 0x43, 0x50] -> 'U+41-43, U+50'"""
    out = []
    start = prev = None
    for cp in sorted(codepoints):
        if start is None:
            start = prev = cp
        elif cp == prev + 1:
            prev = cp
        else:
            out.append((start, prev))
            start = prev = cp
    if start is not None:
        out.append((start, prev))
    return ", ".join(f"U+{a:x}" if a == b else f"U+{a:x}-{b:x}" for a, b in out)


def ui_codepoints():
    """CJK characters in the app's source (comments and tests excluded)."""
    found = set()
    for root, _dirs, files in os.walk(SRC_DIR):
        if os.sep + "preview-" in root:
            continue
        for name in files:
            if not name.endswith((".ts", ".tsx")) or ".test." in name:
                continue
            with open(os.path.join(root, name), encoding="utf-8") as handle:
                text = handle.read()
            text = re.sub(r"/\*.*?\*/", "", text, flags=re.S)
            text = re.sub(r"(^|\s)//.*", "", text)
            found.update(ord(ch) for ch in text if "\u3400" <= ch <= "\u9fff")
    return found


def main():
    # Decompress once; subsetting from a plain TTF is much faster.
    tmp_ttf = os.path.join(tempfile.mkdtemp(prefix="split-display-font-"), "source.ttf")
    source = TTFont(SRC)
    source.flavor = None
    source.save(tmp_ttf)
    font = TTFont(tmp_ttf)
    available = set(font.getBestCmap().keys())
    slices = json.load(open(SLICES))
    # Latin, digits, punctuation and the UI's own characters first: they
    # show up on every page, so they ship as one preloaded chunk.
    latin = [[0x20, 0x7E], [0xA0, 0xFF], [0x2010, 0x2027], [0x3000, 0x303F], [0xFF01, 0xFF5E]]
    ui = sorted(ui_codepoints())
    slices = [latin + [[cp, cp] for cp in ui]] + slices

    if os.path.isdir(OUT_DIR):
        shutil.rmtree(OUT_DIR)
    os.makedirs(OUT_DIR)
    with open(os.path.join(OUT_DIR, "NOTICE.txt"), "w") as notice:
        notice.write(NOTICE)

    seen = set()
    faces = []
    total = 0
    for ranges in slices:
        wanted = set()
        for a, b in ranges:
            wanted.update(range(a, b + 1))
        codepoints = (wanted & available) - seen
        if not codepoints:
            continue
        seen |= codepoints
        options = subset.Options()
        options.flavor = "woff2"
        options.layout_features = ["*"]
        options.name_IDs = ["*"]
        options.notdef_outline = True
        subsetter = subset.Subsetter(options)
        chunk = TTFont(tmp_ttf)
        subsetter.populate(unicodes=codepoints)
        subsetter.subset(chunk)
        name = UI_CHUNK if not faces else f"display-{len(faces)}.woff2"
        path = os.path.join(OUT_DIR, name)
        chunk.flavor = "woff2"
        chunk.save(path)
        size = os.path.getsize(path)
        total += size
        faces.append((name, compact_ranges(codepoints)))

    leftover = available - seen
    with open(CSS_OUT, "w") as css:
        css.write(
            "/* Generated by scripts/split-display-font.py. Do not edit by hand.\n"
            " * 优设标题黑 (YouSheBiaoTiHei), (c) YouShe Network Technology Co., Ltd,\n"
            " * free for commercial use per its publisher (see /fonts/display/NOTICE.txt).\n"
            f" * {len(faces)} chunks, {total // 1024} KB total; a page loads only the chunks it uses.\n"
            f" * {UI_CHUNK} (Latin + the UI's own characters) is preloaded by the root layout. */\n"
        )
        for name, urange in faces:
            css.write(
                "@font-face {\n"
                f'  font-family: "{FAMILY}";\n'
                "  font-style: normal;\n"
                "  font-weight: 400;\n"
                "  font-display: swap;\n"
                f'  src: url("/fonts/display/{name}") format("woff2");\n'
                f"  unicode-range: {urange};\n"
                "}\n"
            )
    print(f"{len(faces)} chunks, {total // 1024} KB, {len(leftover)} glyphs outside the slices", file=sys.stderr)


if __name__ == "__main__":
    main()
