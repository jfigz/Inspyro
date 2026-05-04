from __future__ import annotations

import difflib
from typing import Any

from .ooxml import iter_story_parts, visible_text
from .render import render_docx_page_png


def extract_docx_text(docx_bytes: bytes) -> str:
    paragraphs: list[str] = []
    for part in iter_story_parts(docx_bytes):
        if part.name != "word/document.xml":
            continue
        for paragraph in part.root.xpath(".//w:p", namespaces={"w": "http://schemas.openxmlformats.org/wordprocessingml/2006/main"}):
            text = visible_text(paragraph)
            if text:
                paragraphs.append(text)
    return "\n".join(paragraphs) + ("\n" if paragraphs else "")


def diff_docx_text(a_bytes: bytes, b_bytes: bytes) -> str:
    return "".join(
        difflib.unified_diff(
            extract_docx_text(a_bytes).splitlines(keepends=True),
            extract_docx_text(b_bytes).splitlines(keepends=True),
            fromfile="a.docx",
            tofile="b.docx",
        )
    )


def diff_first_page(a_bytes: bytes, b_bytes: bytes) -> dict[str, Any]:
    import io
    from PIL import Image, ImageChops

    a_png, a_meta = render_docx_page_png(a_bytes, page=1)
    b_png, b_meta = render_docx_page_png(b_bytes, page=1)
    a_img = Image.open(io.BytesIO(a_png)).convert("RGB")
    b_img = Image.open(io.BytesIO(b_png)).convert("RGB")
    if a_img.size != b_img.size:
        width = max(a_img.size[0], b_img.size[0])
        height = max(a_img.size[1], b_img.size[1])
        a_canvas = Image.new("RGB", (width, height), "white")
        b_canvas = Image.new("RGB", (width, height), "white")
        a_canvas.paste(a_img, (0, 0))
        b_canvas.paste(b_img, (0, 0))
        a_img, b_img = a_canvas, b_canvas
    bbox = ImageChops.difference(a_img, b_img).getbbox()
    return {
        "changed": bbox is not None,
        "page": 1,
        "pages_a": a_meta.get("page_count"),
        "pages_b": b_meta.get("page_count"),
    }
