from __future__ import annotations

from typing import Any

from lxml import etree

from .ooxml import NS, parse_xml, qn, read_zip, replace_zip_parts, xml_bytes

ALLOWED_PROTECTION_MODES = {"readOnly", "comments", "trackedChanges", "forms", "off"}


def set_document_protection(docx_bytes: bytes, *, mode: str = "readOnly") -> tuple[bytes, dict[str, Any]]:
    normalized = str(mode or "readOnly").strip()
    if normalized not in ALLOWED_PROTECTION_MODES:
        raise ValueError("mode must be readOnly, comments, trackedChanges, forms or off")

    with read_zip(docx_bytes) as archive:
        if "word/settings.xml" in archive.namelist():
            root = parse_xml(archive.read("word/settings.xml"))
        else:
            root = etree.Element(qn("w", "settings"), nsmap={"w": NS["w"]})

    for node in root.xpath(".//w:documentProtection", namespaces=NS):
        parent = node.getparent()
        if parent is not None:
            parent.remove(node)

    if normalized != "off":
        protection = etree.SubElement(root, qn("w", "documentProtection"))
        protection.set(qn("w", "edit"), normalized)
        protection.set(qn("w", "enforcement"), "1")

    return replace_zip_parts(docx_bytes, {"word/settings.xml": xml_bytes(root)}), {"mode": normalized, "protected": normalized != "off"}
