#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Assemble the final image-generation prompt for the photo-isometric-poster skill.

Reads the master templates in ../references/prompt-{zh,en}.txt, fills the slots and
prints the finished prompt. Standard library only — no network, no third-party
dependency, safe to run on any host.

Examples
--------
python3 build_prompt.py --title "STILL WATERS" \
    --subject "an elderly fisherman standing in a wooden skiff, facing left" \
    --palette "deep indigo, mist blue-grey, warm sand white, oxidised copper"

python3 build_prompt.py --title "NORTHBOUND" --subject "a lone cyclist" \
    --variant wide --layout leftright --lang both
"""

from __future__ import annotations

import argparse
import re
import sys
from pathlib import Path

SKILL_ROOT = Path(__file__).resolve().parent.parent
REF_DIR = SKILL_ROOT / "references"

VARIANTS = {
    "vertical": {"ratio": "3:4", "zh": "3:4 竖版", "en": "3:4 vertical", "px": "1200x1600（或 1536x2048）",
                 "half_zh": "3:2 横幅", "half_en": "3:2 landscape", "half_px": "1536x1024"},
    "square": {"ratio": "1:1", "zh": "1:1 方形", "en": "1:1 square", "px": "1440x1440",
               "half_zh": "2:1 横幅", "half_en": "2:1 landscape", "half_px": "1536x768"},
    "landscape": {"ratio": "4:3", "zh": "4:3 横版", "en": "4:3 landscape", "px": "1600x1200",
                  "half_zh": "8:3 横幅", "half_en": "8:3 landscape", "half_px": "2048x768"},
    "wide": {"ratio": "16:9", "zh": "16:9 宽幅", "en": "16:9 wide", "px": "1920x1080",
             "half_zh": "超宽幅", "half_en": "ultra-wide landscape", "half_px": "2560x720"},
}

LAYOUTS = {
    "topbottom": {
        "zh_axis": "上下", "zh_dim": "高度", "zh_up": "上区", "zh_down": "下区",
        "zh_edge": "紧贴水平分界线下方",
        "en_axis": "top and bottom", "en_dim": "height", "en_up": "UPPER REGION", "en_down": "LOWER REGION",
        "en_edge": "just below the horizontal dividing line",
    },
    "leftright": {
        "zh_axis": "左右", "zh_dim": "宽度", "zh_up": "左区", "zh_down": "右区",
        "zh_edge": "紧贴垂直分界线右侧",
        "en_axis": "left and right", "en_dim": "width", "en_up": "LEFT REGION", "en_down": "RIGHT REGION",
        "en_edge": "just to the right of the vertical dividing line",
    },
}

# Markers that must survive any edit to the master templates. If one goes missing
# the prompt has silently lost a constraint that was added to fix a real failure.
REQUIRED_MARKERS = {
    "zh": [
        ("30° 等距轴测投影", "等距轴测（修「下区偏正面平视」）"),
        ("必须是两种截然不同的媒介", "上下区媒介分离"),
        ("近白背景之内", "文字必须落在下区近白背景内、不得加色块底衬"),
        ("同一水平基线上", "标题与编号同行"),
        ("层叠纸板", "薄纸板基座"),
        ("不得是扁平矢量插画", "禁止扁平矢量（下区必须是实体模型）"),
    ],
    "en": [
        ("30° isometric projection", "isometric projection"),
        ("two clearly different media", "two separate media"),
        ("near-white backdrop of the", "text sits inside the backdrop, no backing panel"),
        ("same baseline on one single line", "title and number on one line"),
        ("thin stack of layered card", "thin layered slab base"),
        ("must not be a flat vector illustration", "flat vector forbidden"),
    ],
}

DEFAULT_NOTES = "ONE / 01、一行极短的英文地点或年份注释"

PLACEHOLDER_RE = re.compile(r"\{\{[A-Z_]+\}\}")


def load_template(lang: str) -> str:
    path = REF_DIR / ("prompt-%s.txt" % lang)
    if not path.is_file():
        raise SystemExit(
            "Template not found: %s\n"
            "The script must stay inside the skill folder (scripts/ next to references/)." % path
        )
    return path.read_text(encoding="utf-8")


def fill(template: str, values: dict, label: str) -> str:
    text = template
    for key, val in values.items():
        text = text.replace("{{%s}}" % key, val)
    leftover = sorted(set(PLACEHOLDER_RE.findall(text)))
    if leftover:
        raise SystemExit("Unfilled placeholder(s) in %s template: %s" % (label, ", ".join(leftover)))
    return text.strip() + "\n"


def blocks_for(values: dict, notes: str, layout: dict):
    subject = values["subject"].strip()
    palette = values["palette"].strip()
    extra = values["extra"].strip()
    notes = notes.strip()

    if notes:
        notes_zh = "，并搭配极少量编号、短句或微型注释（英文，例如：%s）" % notes
        notes_en = ", accompanied by a tiny amount of numbering, short phrases or micro-annotations (in English, e.g. %s)" % notes
    else:
        notes_zh = "，并搭配极少量编号、短句或微型注释"
        notes_en = ", accompanied by a tiny amount of numbering, short phrases or micro-annotations"

    subject_block_zh = (
        "【主体锚定】\n%s两区必须是同一个主体，姿态、轮廓与身份特征一一对应、可一眼辨认：%s。\n\n"
        % (layout["zh_axis"], subject)
        if subject else ""
    )
    subject_block_en = (
        "[SUBJECT ANCHOR]\nBoth regions must depict the same subject — posture, silhouette and identity features corresponding one to one and instantly recognisable: %s.\n\n" % subject
        if subject else ""
    )
    palette_block_zh = (
        "【色彩锚定】\n以原照片中提取的有限色盘为准：%s。除此之外不得引入任何新色相。\n\n" % palette
        if palette else ""
    )
    palette_block_en = (
        "[PALETTE ANCHOR]\nHold to the limited palette extracted from the photograph: %s. Do not introduce any hue outside it.\n\n" % palette
        if palette else ""
    )
    extra_block_zh = "\n【补充要求】\n%s\n" % extra if extra else ""
    extra_block_en = "\n[ADDITIONAL REQUIREMENTS]\n%s\n" % extra if extra else ""

    return {
        "NOTES_SENTENCE": notes_zh,
        "NOTES_SENTENCE_EN": notes_en,
        "SUBJECT_BLOCK": subject_block_zh,
        "SUBJECT_BLOCK_EN": subject_block_en,
        "PALETTE_BLOCK": palette_block_zh,
        "PALETTE_BLOCK_EN": palette_block_en,
        "EXTRA_BLOCK": extra_block_zh,
        "EXTRA_BLOCK_EN": extra_block_en,
    }


def _apply(text: str, pairs, lang: str) -> str:
    """Apply exact-string replacements, warning (not failing) when one no longer matches.

    A silent no-op here is how the lower-only prompt once drifted into the wrong
    medium, so a missed target is reported loudly on stderr.
    """
    for old, new, label in pairs:
        if old not in text:
            print(
                "[warn] %s: replacement target missing (%s) — the master template "
                "has probably drifted, re-check to_lower_only()" % (lang, label),
                file=sys.stderr,
            )
            continue
        text = text.replace(old, new)
    return text


def to_lower_only(text: str, lang: str, variant: dict, layout: dict) -> str:
    """Turn the two-region master prompt into a model-only prompt.

    Used by the composite route: the upper region is produced by cropping the
    original photo locally (perfect fidelity, zero generation), so only the
    model half needs to be generated.
    """
    if lang == "zh":
        up, down = layout["zh_up"], layout["zh_down"]
        text = re.sub(
            r"【[^】]*原始照片】.*?(?=【[^】]*微缩等距模型】)", "", text, flags=re.S
        )
        text = text.replace(
            "【%s · 微缩等距模型】" % down, "【画面 · 微缩等距模型】"
        )
        text = _apply(text, [
            ("%s两区必须是同一个主体，姿态、轮廓与身份特征一一对应、可一眼辨认：" % layout["zh_axis"],
             "主体必须一眼可辨，并保留以下身份特征：", "subject anchor"),
            ("%s不得虚构照片中不存在的主体" % down,
             "不得虚构原照片中不存在的主体", "no-invent clause"),
            ("%s与%s必须是两种截然不同的媒介。" % (down, up),
             "画面中不得出现任何照片边框、拼贴痕迹或相机拍摄痕迹。", "media separation"),
            ("标题与编号放在%s的留白区域，%s；二者必须处在同一水平基线上、在同一行内左右排开，"
             "中间留出明显的水平间距，构成一个被拉开的完整版式单元，编号不得换行到标题下方。"
             % (down, layout["zh_edge"]),
             "标题与编号放在画面的留白区域，在同一行内左右排开，二者之间留出明显的水平间距。",
             "typography placement"),
            ("标题与编号必须完整落在%s的近白背景之内，与照片区的下边缘之间留出明显间隙（不小于标题字号的一半）；"
             % down,
             "标题与编号放在画面的留白区域内，四周留出充足空白；", "text placement"),
            ("不得在照片区上放置任何色块、白色底衬、遮罩或半透明蒙版。",
             "不得加色块底衬或半透明蒙版。", "no backing panel"),
            ("完全取自上方原照片", "完全取自原照片", "colour source wording"),
        ], "zh")
        head = "整张画面为%s的纯微缩模型，画面中不包含任何照片区域，只输出模型本身。" % variant["half_zh"]
    else:
        up, down = layout["en_up"], layout["en_down"]
        text = re.sub(
            r"\[[^\]]*ORIGINAL PHOTOGRAPH\].*?(?=\[[^\]]*MINIATURE ISOMETRIC MODEL\])",
            "", text, flags=re.S,
        )
        text = text.replace(
            "[%s · MINIATURE ISOMETRIC MODEL]" % down,
            "[THE IMAGE · MINIATURE ISOMETRIC MODEL]",
        )
        text = _apply(text, [
            ("Both regions must depict the same subject — posture, silhouette and identity "
             "features corresponding one to one and instantly recognisable:",
             "The subject in the model must be instantly recognisable, keeping these identity features:",
             "subject anchor"),
            ("the model region must not invent", "do not invent", "no-invent clause"),
            ("The two regions must be two clearly different media.",
             "No photographic frame, collage seam or camera-capture trace may appear in the image.",
             "media separation"),
            ("Place the title and its numbering in the white space of the %s, %s; they must sit on "
             "the same baseline on one single line, separated by a clearly wide horizontal gap so that "
             "they form one deliberately spread typographic unit — the number must never wrap onto a "
             "line below the title." % (down, layout["en_edge"]),
             "Place the title and its numbering in the image's white space, on one single line, "
             "separated by a clearly wide horizontal gap.",
             "typography placement"),
            ("The title and its numbering must sit entirely within the near-white backdrop of the %s, leaving a "
             "clear gap (at least half the title's cap height) below the lower edge of the photographic region;"
             % down,
             "Place the title and its numbering in the image's white space, with generous clear space around it;",
             "text placement"),
            ("never place any colour block, white backing panel, mask or translucent scrim over the photographic region.",
             "never add a colour-block backing panel or translucent scrim.", "no backing panel"),
            ("Colour is taken entirely from the photograph above", "Colour is taken entirely from the reference photograph",
             "colour source wording"),
        ], "en")
        head = ("Output a pure %s miniature-model image only — it contains no photographic "
                "region at all." % variant["half_en"])

    lines = text.split("\n")
    for i, line in enumerate(lines):
        if line.strip():
            lines[i] = head
            break
    return "\n".join(lines).strip() + "\n"


def smart_title(raw: str) -> str:
    """Sentence-ish case for the title, matching the editorial reference.

    Lower-case words get an initial capital; words that already carry an internal
    capital (acronyms such as AI) are left untouched.
    """
    out = []
    for word in raw.split():
        if word.islower() or (word.isalpha() and word.isupper() and len(word) > 3):
            out.append(word[:1].upper() + word[1:].lower())
        else:
            out.append(word)
    return " ".join(out)


def check_template_markers(lang: str, text: str) -> list:
    missing = []
    for marker, label in REQUIRED_MARKERS[lang]:
        if marker not in text:
            missing.append(label)
    return missing


def build(args) -> str:
    variant = VARIANTS[args.variant]
    layout = LAYOUTS[args.layout]
    notes = args.notes if args.notes else ("" if args.no_notes else DEFAULT_NOTES)
    notes = "" if notes == "-" else notes
    raw_title = args.title.strip()
    title = raw_title.upper() if args.uppercase else smart_title(raw_title)

    values = {
        "subject": args.subject,
        "palette": args.palette,
        "extra": args.extra,
    }
    common = blocks_for(values, notes, layout)

    chunks = []
    if args.lang in ("zh", "both"):
        zh_values = {
            "ASPECT": variant["zh"],
            "AXIS": layout["zh_axis"],
            "DIM": layout["zh_dim"],
            "UP": layout["zh_up"],
            "DOWN": layout["zh_down"],
            "EDGE": layout["zh_edge"],
            "TITLE": title,
            "NOTES_SENTENCE": common["NOTES_SENTENCE"],
            "SUBJECT_BLOCK": common["SUBJECT_BLOCK"],
            "PALETTE_BLOCK": common["PALETTE_BLOCK"],
            "EXTRA_BLOCK": common["EXTRA_BLOCK"],
        }
        body = fill(load_template("zh"), zh_values, "zh")
        for label in check_template_markers("zh", body):
            print("[warn] zh master prompt lost the %s constraint" % label, file=sys.stderr)
        if args.part == "lower":
            body = to_lower_only(body, "zh", variant, layout)
        chunks.append(body if args.lang == "zh" else "===== 中文母版 =====\n" + body)

    if args.lang in ("en", "both"):
        en_values = {
            "ASPECT": variant["en"],
            "AXIS": layout["en_axis"],
            "DIM": layout["en_dim"],
            "UP": layout["en_up"],
            "DOWN": layout["en_down"],
            "EDGE_EN": layout["en_edge"],
            "TITLE": title,
            "NOTES_SENTENCE_EN": common["NOTES_SENTENCE_EN"],
            "SUBJECT_BLOCK_EN": common["SUBJECT_BLOCK_EN"],
            "PALETTE_BLOCK_EN": common["PALETTE_BLOCK_EN"],
            "EXTRA_BLOCK_EN": common["EXTRA_BLOCK_EN"],
        }
        body = fill(load_template("en"), en_values, "en")
        for label in check_template_markers("en", body):
            print("[warn] en master prompt lost the %s constraint" % label, file=sys.stderr)
        if args.part == "lower":
            body = to_lower_only(body, "en", variant, layout)
        chunks.append(body if args.lang == "en" else "\n===== English master prompt =====\n" + body)

    return "\n".join(chunks)


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(
        description="Assemble the final prompt for the photo-isometric-poster skill.",
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    parser.add_argument("--title", required=True, help='Short English title, 2-4 words (e.g. "Pasture", "Still Waters")')
    parser.add_argument("--subject", default="", help="One sentence: who/what + where + posture")
    parser.add_argument("--palette", default="", help="3-5 hues taken from the photo, e.g. \"deep indigo, mist blue-grey, warm sand white\"")
    parser.add_argument("--notes", default="", help="Tiny annotations, e.g. \"03\" or \"No.03 / 2024\". Pass \"-\" to omit annotations entirely.")
    parser.add_argument("--no-notes", action="store_true", help="Render the template without the annotation clause")
    parser.add_argument("--extra", default="", help="Extra requirements appended at the end")
    parser.add_argument("--variant", choices=sorted(VARIANTS), default="vertical", help="Canvas ratio (default: vertical 3:4)")
    parser.add_argument("--layout", choices=sorted(LAYOUTS), default="topbottom", help="Split axis (default: topbottom)")
    parser.add_argument("--lang", choices=["zh", "en", "both"], default="zh", help="Which master prompt to emit")
    parser.add_argument("--uppercase", action="store_true",
                        help='Force the title to ALL CAPS (default: editorial sentence case, e.g. "Pasture")')
    parser.add_argument("--no-uppercase", dest="uppercase", action="store_false",
                        help="Deprecated alias — sentence case is now the default")
    parser.add_argument("--part", choices=["full", "lower"], default="full",
                        help="full = 整张海报提示词；lower = 只生成下半区微缩模型（合成路线：上区用原图裁切，零生成、100%% 保真）")
    parser.add_argument("--out", default="", help="Write to this file instead of stdout")
    args = parser.parse_args(argv)

    prompt = build(args)

    if args.out:
        Path(args.out).expanduser().write_text(prompt, encoding="utf-8")

    ratio_note = VARIANTS[args.variant]
    warn = []
    if not args.subject.strip():
        warn.append("--subject is empty: the prompt loses its subject anchor, both regions may drift apart.")
    if not args.palette.strip():
        warn.append("--palette is empty: the model will guess the palette and may drift into a fixed colour scheme.")
    if warn:
        for line in warn:
            print("[warn] %s" % line, file=sys.stderr)
    size_note = ratio_note["px"] if args.part == "full" else ratio_note["half_px"]
    print(
        "[info] part %s | ratio %s | recommended size %s | layout %s | lang %s"
        % (args.part, ratio_note["ratio"], size_note, args.layout, args.lang),
        file=sys.stderr,
    )

    if args.out:
        print("[info] written to %s (%d chars)" % (args.out, len(prompt)), file=sys.stderr)
    else:
        sys.stdout.write(prompt)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
