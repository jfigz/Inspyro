from __future__ import annotations

import io
import re
import zipfile
from collections.abc import Iterable
from dataclasses import dataclass
from pathlib import PurePosixPath
from typing import Any

from lxml import etree

W_NS = "http://schemas.openxmlformats.org/wordprocessingml/2006/main"
R_NS = "http://schemas.openxmlformats.org/officeDocument/2006/relationships"
REL_NS = "http://schemas.openxmlformats.org/package/2006/relationships"
CT_NS = "http://schemas.openxmlformats.org/package/2006/content-types"
WP_NS = "http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing"
A_NS = "http://schemas.openxmlformats.org/drawingml/2006/main"
V_NS = "urn:schemas-microsoft-com:vml"

NS = {
    "w": W_NS,
    "r": R_NS,
    "rel": REL_NS,
    "ct": CT_NS,
    "wp": WP_NS,
    "a": A_NS,
    "v": V_NS,
}


@dataclass(frozen=True)
class XmlPart:
    name: str
    root: etree._Element


def qn(prefix: str, local: str) -> str:
    ns = NS.get(prefix)
    if not ns:
        raise ValueError(f"Unknown OOXML namespace prefix: {prefix}")
    return f"{{{ns}}}{local}"


def parse_xml(data: bytes) -> etree._Element:
    parser = etree.XMLParser(recover=True, remove_blank_text=False)
    return etree.fromstring(data, parser=parser)


def xml_bytes(root: etree._Element) -> bytes:
    return etree.tostring(root, xml_declaration=True, encoding="UTF-8", standalone="yes")


def iter_story_part_names(names: Iterable[str], *, include_comments: bool = False) -> list[str]:
    parts: list[str] = []
    for name in names:
        if name == "word/document.xml":
            parts.append(name)
        elif re.match(r"word/header\d+\.xml$", name) or re.match(r"word/footer\d+\.xml$", name):
            parts.append(name)
        elif name in ("word/footnotes.xml", "word/endnotes.xml"):
            parts.append(name)
        elif include_comments and name == "word/comments.xml":
            parts.append(name)
    return parts


def read_zip(docx_bytes: bytes) -> zipfile.ZipFile:
    return zipfile.ZipFile(io.BytesIO(docx_bytes), "r")


def iter_story_parts(docx_bytes: bytes, *, include_comments: bool = False) -> list[XmlPart]:
    with read_zip(docx_bytes) as archive:
        parts = []
        for name in iter_story_part_names(archive.namelist(), include_comments=include_comments):
            try:
                parts.append(XmlPart(name=name, root=parse_xml(archive.read(name))))
            except Exception:
                continue
        return parts


def visible_text(root: etree._Element) -> str:
    return "".join(root.xpath(".//w:t/text() | .//w:delText/text()", namespaces=NS))


def replace_zip_parts(docx_bytes: bytes, replacements: dict[str, bytes], removals: set[str] | None = None) -> bytes:
    removals = removals or set()
    output = io.BytesIO()
    with zipfile.ZipFile(io.BytesIO(docx_bytes), "r") as source, zipfile.ZipFile(output, "w", zipfile.ZIP_DEFLATED) as target:
        for info in source.infolist():
            name = info.filename
            if name in removals:
                continue
            if name in replacements:
                target.writestr(name, replacements[name])
            else:
                target.writestr(name, source.read(name))
        for name, data in replacements.items():
            if name not in source.namelist():
                target.writestr(name, data)
    return output.getvalue()


def summarize_findings(findings: list[dict[str, Any]]) -> dict[str, int]:
    counts = {"error": 0, "warning": 0, "info": 0}
    for finding in findings:
        severity = str(finding.get("severity") or "info").lower()
        if severity == "high":
            severity = "error"
        elif severity == "medium":
            severity = "warning"
        if severity not in counts:
            severity = "info"
        counts[severity] += 1
    return counts


def rels_name_for_part(part_name: str) -> str:
    part_path = PurePosixPath(part_name)
    return str(part_path.parent / "_rels" / f"{part_path.name}.rels")
