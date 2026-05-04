from __future__ import annotations

import re
from collections import Counter
from typing import Any

from lxml import etree

from .ooxml import NS, iter_story_parts, qn, read_zip, replace_zip_parts, visible_text, xml_bytes


def extract_fields_from_root(root: etree._Element) -> list[dict[str, Any]]:
    fields: list[dict[str, Any]] = []
    for el in root.findall(".//w:fldSimple", namespaces=NS):
        instr = re.sub(r"\s+", " ", el.get(qn("w", "instr")) or "").strip()
        if instr:
            fields.append({"kind": "simple", "instruction": instr, "result": visible_text(el)})

    in_field = False
    chunks: list[str] = []
    result_chunks: list[str] = []
    for node in root.iter():
        if node.tag == qn("w", "fldChar"):
            field_type = node.get(qn("w", "fldCharType"))
            if field_type == "begin":
                in_field = True
                chunks = []
                result_chunks = []
            elif field_type == "end" and in_field:
                instr = re.sub(r"\s+", " ", "".join(chunks)).strip()
                if instr:
                    fields.append({"kind": "complex", "instruction": instr, "result": "".join(result_chunks).strip()})
                in_field = False
                chunks = []
                result_chunks = []
        elif in_field and node.tag == qn("w", "instrText"):
            chunks.append(node.text or "")
        elif in_field and node.tag in {qn("w", "t"), qn("w", "delText")}:
            result_chunks.append(node.text or "")
    return fields


def report_fields(docx_bytes: bytes) -> dict[str, Any]:
    items: list[dict[str, Any]] = []
    counts: Counter[str] = Counter()
    for part in iter_story_parts(docx_bytes, include_comments=True):
        for field in extract_fields_from_root(part.root):
            field_type = (str(field.get("instruction") or "").split() or ["unknown"])[0].upper()
            counts[field_type] += 1
            items.append({"part": part.name, "type": field_type, **field})
    return {"items": items, "counts": dict(counts), "field_count": len(items)}


def flatten_simple_fields(docx_bytes: bytes) -> tuple[bytes, dict[str, int]]:
    """Replace fldSimple elements with their current visible result text."""
    replacements: dict[str, bytes] = {}
    stats = {"flattened": 0}
    with read_zip(docx_bytes) as archive:
        story_names = {part.name for part in iter_story_parts(docx_bytes, include_comments=True)}
        for name in archive.namelist():
            if name not in story_names:
                continue
            root = etree.fromstring(archive.read(name))
            changed = False
            for field in list(root.findall(".//w:fldSimple", namespaces=NS)):
                parent = field.getparent()
                if parent is None:
                    continue
                index = parent.index(field)
                result_text = visible_text(field)
                parent.remove(field)
                run = etree.Element(qn("w", "r"))
                text = etree.SubElement(run, qn("w", "t"))
                text.text = result_text
                parent.insert(index, run)
                stats["flattened"] += 1
                changed = True
            if changed:
                replacements[name] = xml_bytes(root)
    return replace_zip_parts(docx_bytes, replacements), stats
