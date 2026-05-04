from __future__ import annotations

from lxml import etree

from .ooxml import CT_NS, NS, REL_NS, W_NS, parse_xml, qn, read_zip, replace_zip_parts, xml_bytes


def _strip_rsid(root: etree._Element) -> int:
    removed = 0
    for node in root.iter():
        for key in list(node.attrib.keys()):
            if key.startswith(f"{{{W_NS}}}rsid"):
                del node.attrib[key]
                removed += 1
    return removed


def _remove_track_revisions(root: etree._Element) -> bool:
    changed = False
    for node in root.xpath(".//w:trackRevisions", namespaces=NS):
        parent = node.getparent()
        if parent is not None:
            parent.remove(node)
            changed = True
    return changed


def _unwrap(node: etree._Element) -> None:
    parent = node.getparent()
    if parent is None:
        return
    index = parent.index(node)
    children = list(node)
    parent.remove(node)
    for offset, child in enumerate(children):
        parent.insert(index + offset, child)


def _apply_tracked_changes(root: etree._Element, mode: str) -> None:
    for tag, kind in (("moveTo", "ins"), ("moveFrom", "del"), ("ins", "ins"), ("del", "del")):
        for node in reversed(root.xpath(f".//w:{tag}", namespaces=NS)):
            parent = node.getparent()
            if parent is None:
                continue
            if kind == "ins":
                if mode == "accept":
                    _unwrap(node)
                elif mode == "reject":
                    parent.remove(node)
            else:
                if mode == "accept":
                    parent.remove(node)
                elif mode == "reject":
                    _unwrap(node)


def _strip_comment_anchors(root: etree._Element) -> bool:
    changed = False
    for xpath in (".//w:commentRangeStart", ".//w:commentRangeEnd", ".//w:commentReference"):
        for node in root.xpath(xpath, namespaces=NS):
            parent = node.getparent()
            if parent is not None:
                parent.remove(node)
                changed = True
    return changed


def clean_docx_bytes(
    docx_bytes: bytes,
    *,
    scrub_metadata: bool = True,
    strip_comments: bool = True,
    tracked_changes: str = "accept",
) -> tuple[bytes, dict[str, int]]:
    stats = {
        "rsid_attrs_removed": 0,
        "comments_removed": 0,
        "tracked_changes_processed": 0,
        "metadata_scrubbed": 0,
    }
    replacements: dict[str, bytes] = {}
    removals: set[str] = set()

    with read_zip(docx_bytes) as archive:
        names = set(archive.namelist())
        story_names = [
            name for name in names
            if name == "word/document.xml"
            or name in {"word/footnotes.xml", "word/endnotes.xml"}
            or name.startswith("word/header")
            or name.startswith("word/footer")
        ]
        for name in story_names:
            if not name.endswith(".xml"):
                continue
            root = parse_xml(archive.read(name))
            changed = False
            removed_rsid = _strip_rsid(root)
            if removed_rsid:
                stats["rsid_attrs_removed"] += removed_rsid
                changed = True
            if strip_comments and _strip_comment_anchors(root):
                changed = True
            if name == "word/document.xml" and tracked_changes in {"accept", "reject"}:
                before = len(root.xpath(".//w:ins | .//w:del | .//w:moveTo | .//w:moveFrom", namespaces=NS))
                _apply_tracked_changes(root, tracked_changes)
                after = len(root.xpath(".//w:ins | .//w:del | .//w:moveTo | .//w:moveFrom", namespaces=NS))
                if before != after:
                    stats["tracked_changes_processed"] += before
                    changed = True
            if changed:
                replacements[name] = xml_bytes(root)

        if "word/settings.xml" in names:
            root = parse_xml(archive.read("word/settings.xml"))
            if _remove_track_revisions(root):
                replacements["word/settings.xml"] = xml_bytes(root)

        if scrub_metadata and "docProps/core.xml" in names:
            core = parse_xml(archive.read("docProps/core.xml"))
            changed = False
            for expr in (".//*[local-name()='creator']", ".//*[local-name()='lastModifiedBy']"):
                for node in core.xpath(expr):
                    if (node.text or "").strip():
                        node.text = ""
                        changed = True
            if changed:
                stats["metadata_scrubbed"] = 1
                replacements["docProps/core.xml"] = xml_bytes(core)
        if scrub_metadata and "docProps/custom.xml" in names:
            removals.add("docProps/custom.xml")
            stats["metadata_scrubbed"] = 1

        if strip_comments and "word/comments.xml" in names:
            removals.add("word/comments.xml")
            stats["comments_removed"] = 1
        for extra in ("word/commentsExtended.xml", "word/commentsIds.xml"):
            if strip_comments and extra in names:
                removals.add(extra)

        if "_rels/.rels" in names and scrub_metadata:
            rels = parse_xml(archive.read("_rels/.rels"))
            changed = False
            for rel in list(rels.findall(f"{{{REL_NS}}}Relationship")):
                if (rel.get("Target") or "").endswith("docProps/custom.xml"):
                    rels.remove(rel)
                    changed = True
            if changed:
                replacements["_rels/.rels"] = xml_bytes(rels)

        if "[Content_Types].xml" in names:
            content_types = parse_xml(archive.read("[Content_Types].xml"))
            changed = False
            removed_parts = {f"/{name}" for name in removals}
            for override in list(content_types.findall(f"{{{CT_NS}}}Override")):
                if (override.get("PartName") or "") in removed_parts:
                    content_types.remove(override)
                    changed = True
            if changed:
                replacements["[Content_Types].xml"] = xml_bytes(content_types)

    return replace_zip_parts(docx_bytes, replacements, removals), stats
