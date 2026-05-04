from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from lxml import etree

from .ooxml import CT_NS, NS, parse_xml, qn, read_zip, replace_zip_parts, visible_text, xml_bytes

COMMENTS_CT = "application/vnd.openxmlformats-officedocument.wordprocessingml.comments+xml"


def extract_comments(docx_bytes: bytes) -> dict[str, Any]:
    with read_zip(docx_bytes) as archive:
        if "word/comments.xml" not in archive.namelist():
            return {"comments": [], "comment_count": 0}
        root = parse_xml(archive.read("word/comments.xml"))
    comments: list[dict[str, Any]] = []
    for comment in root.xpath(".//w:comment", namespaces=NS):
        comments.append(
            {
                "id": comment.get(qn("w", "id")),
                "author": comment.get(qn("w", "author")),
                "date": comment.get(qn("w", "date")),
                "initials": comment.get(qn("w", "initials")),
                "text": visible_text(comment).strip(),
            }
        )
    return {"comments": comments, "comment_count": len(comments)}


def comment_anchor_report(docx_bytes: bytes) -> dict[str, int]:
    starts = 0
    refs = 0
    for part in iter_story_parts_safe(docx_bytes):
        starts += len(part.xpath(".//w:commentRangeStart", namespaces=NS))
        refs += len(part.xpath(".//w:commentReference", namespaces=NS))
    return {"comment_anchors": starts, "comment_references": refs}


def iter_story_parts_safe(docx_bytes: bytes) -> list[etree._Element]:
    from .ooxml import iter_story_parts

    return [part.root for part in iter_story_parts(docx_bytes)]


def _comments_root(existing: bytes | None = None) -> etree._Element:
    if existing:
        return parse_xml(existing)
    return etree.Element(qn("w", "comments"), nsmap={"w": NS["w"]})


def _next_comment_id(root: etree._Element) -> int:
    ids = []
    for node in root.xpath(".//w:comment", namespaces=NS):
        try:
            ids.append(int(node.get(qn("w", "id")) or "0"))
        except ValueError:
            continue
    return (max(ids) + 1) if ids else 0


def _ensure_comments_content_type(docx_bytes: bytes) -> dict[str, bytes]:
    replacements: dict[str, bytes] = {}
    with read_zip(docx_bytes) as archive:
        if "[Content_Types].xml" not in archive.namelist():
            return replacements
        root = parse_xml(archive.read("[Content_Types].xml"))
        exists = any(
            node.get("PartName") == "/word/comments.xml"
            for node in root.findall(f"{{{CT_NS}}}Override")
        )
        if not exists:
            override = etree.SubElement(root, f"{{{CT_NS}}}Override")
            override.set("PartName", "/word/comments.xml")
            override.set("ContentType", COMMENTS_CT)
            replacements["[Content_Types].xml"] = xml_bytes(root)
    return replacements


def add_document_comment(
    docx_bytes: bytes,
    *,
    text: str,
    author: str = "Inspyro",
    initials: str = "IP",
) -> tuple[bytes, dict[str, Any]]:
    """Append a package comment without anchoring it into a paragraph."""
    replacements = _ensure_comments_content_type(docx_bytes)
    with read_zip(docx_bytes) as archive:
        root = _comments_root(archive.read("word/comments.xml") if "word/comments.xml" in archive.namelist() else None)
    comment_id = _next_comment_id(root)
    comment = etree.SubElement(root, qn("w", "comment"))
    comment.set(qn("w", "id"), str(comment_id))
    comment.set(qn("w", "author"), author)
    comment.set(qn("w", "initials"), initials)
    comment.set(qn("w", "date"), datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"))
    paragraph = etree.SubElement(comment, qn("w", "p"))
    run = etree.SubElement(paragraph, qn("w", "r"))
    text_node = etree.SubElement(run, qn("w", "t"))
    text_node.text = text
    replacements["word/comments.xml"] = xml_bytes(root)
    return replace_zip_parts(docx_bytes, replacements), {"comment_id": comment_id, "comment_count": len(root.xpath(".//w:comment", namespaces=NS))}
