from __future__ import annotations

import re
from typing import Any

from .ooxml import NS, iter_story_parts, parse_xml, read_zip, replace_zip_parts, xml_bytes


def _replacement_for(match: re.Match[str], replacement: str, preserve_length: bool) -> str:
    if not preserve_length:
        return replacement
    token = replacement or "X"
    repeated = (token * (len(match.group(0)) // len(token) + 1))[: len(match.group(0))]
    return repeated


def redact_docx_bytes(
    docx_bytes: bytes,
    *,
    patterns: list[str],
    replacement: str = "X",
    preserve_length: bool = True,
    include_comments: bool = False,
) -> tuple[bytes, dict[str, Any]]:
    compiled = [re.compile(pattern) for pattern in patterns if str(pattern or "").strip()]
    if not compiled:
        return docx_bytes, {"redactions": 0, "patterns": []}

    replacements: dict[str, bytes] = {}
    stats = {"redactions": 0, "patterns": len(compiled), "parts": []}
    with read_zip(docx_bytes) as archive:
        story_names = {part.name for part in iter_story_parts(docx_bytes, include_comments=include_comments)}
        for name in archive.namelist():
            if name not in story_names:
                continue
            root = parse_xml(archive.read(name))
            changed = False
            part_count = 0
            for text_node in root.xpath(".//w:t | .//w:delText | .//w:instrText", namespaces=NS):
                original = text_node.text or ""
                updated = original
                for pattern in compiled:
                    updated, count = pattern.subn(lambda match: _replacement_for(match, replacement, preserve_length), updated)
                    part_count += count
                if updated != original:
                    text_node.text = updated
                    changed = True
            if changed:
                stats["redactions"] += part_count
                stats["parts"].append({"part": name, "count": part_count})
                replacements[name] = xml_bytes(root)
    return replace_zip_parts(docx_bytes, replacements), stats
