from __future__ import annotations

import re
from typing import Any

from lxml import etree

from .ooxml import NS, iter_story_parts, parse_xml, qn, read_zip, replace_zip_parts, visible_text, xml_bytes

PLACEHOLDER_RE = re.compile(r"\{\{([A-Za-z0-9_-]+)\}\}")


def _sdt_tag(sdt: etree._Element) -> str:
    return sdt.xpath("string(.//w:sdtPr/w:tag/@w:val)", namespaces=NS) or ""


def _sdt_alias(sdt: etree._Element) -> str:
    return sdt.xpath("string(.//w:sdtPr/w:alias/@w:val)", namespaces=NS) or ""


def inspect_content_controls(docx_bytes: bytes) -> dict[str, Any]:
    controls: list[dict[str, Any]] = []
    placeholders: list[dict[str, Any]] = []
    wrapped_tags: set[str] = set()

    for part in iter_story_parts(docx_bytes):
        for sdt in part.root.xpath(".//w:sdt", namespaces=NS):
            tag = _sdt_tag(sdt)
            alias = _sdt_alias(sdt)
            if tag:
                wrapped_tags.add(tag)
            controls.append(
                {
                    "part": part.name,
                    "tag": tag or None,
                    "alias": alias or None,
                    "text": visible_text(sdt)[:240],
                    "kind": "plain_text" if sdt.find(".//w:sdtPr/w:text", namespaces=NS) is not None else "unknown",
                }
            )

        for text_node in part.root.xpath(".//w:t", namespaces=NS):
            text = text_node.text or ""
            for match in PLACEHOLDER_RE.finditer(text):
                tag = match.group(1)
                placeholders.append(
                    {
                        "part": part.name,
                        "tag": tag,
                        "placeholder": match.group(0),
                        "wrapped": tag in wrapped_tags,
                    }
                )

    unwrapped = [item for item in placeholders if not item["wrapped"]]
    return {
        "controls": controls,
        "placeholders": placeholders,
        "control_count": len(controls),
        "placeholder_count": len(placeholders),
        "unwrapped_placeholder_count": len(unwrapped),
    }


def fill_content_controls(docx_bytes: bytes, values: dict[str, str]) -> bytes:
    """Fill plain text SDTs by tag while preserving the package shape."""
    replacements: dict[str, bytes] = {}
    with read_zip(docx_bytes) as archive:
        story_names = {part.name for part in iter_story_parts(docx_bytes)}
        for name in archive.namelist():
            if name not in story_names:
                continue
            root = parse_xml(archive.read(name))
            changed = False
            for sdt in root.xpath(".//w:sdt", namespaces=NS):
                tag = _sdt_tag(sdt)
                if not tag or tag not in values:
                    continue
                content = sdt.find("w:sdtContent", namespaces=NS)
                if content is None:
                    continue
                for child in list(content):
                    content.remove(child)
                run = etree.SubElement(content, qn("w", "r"))
                text = etree.SubElement(run, qn("w", "t"))
                text.text = str(values[tag])
                changed = True
            if changed:
                replacements[name] = xml_bytes(root)
    return replace_zip_parts(docx_bytes, replacements)


def _build_plain_text_sdt(tag: str, text_value: str) -> etree._Element:
    sdt = etree.Element(qn("w", "sdt"))
    sdt_pr = etree.SubElement(sdt, qn("w", "sdtPr"))
    alias = etree.SubElement(sdt_pr, qn("w", "alias"))
    alias.set(qn("w", "val"), tag)
    tag_node = etree.SubElement(sdt_pr, qn("w", "tag"))
    tag_node.set(qn("w", "val"), tag)
    etree.SubElement(sdt_pr, qn("w", "text"))
    content = etree.SubElement(sdt, qn("w", "sdtContent"))
    run = etree.SubElement(content, qn("w", "r"))
    text = etree.SubElement(run, qn("w", "t"))
    text.text = text_value
    return sdt


def _has_sdt_ancestor(node: etree._Element) -> bool:
    parent = node.getparent()
    while parent is not None:
        if parent.tag == qn("w", "sdt"):
            return True
        parent = parent.getparent()
    return False


def wrap_placeholders_as_content_controls(docx_bytes: bytes) -> tuple[bytes, dict[str, Any]]:
    """Wrap exact {{TAG}} text runs as plain text SDTs."""
    replacements: dict[str, bytes] = {}
    stats = {"wrapped": 0, "skipped": 0, "tags": []}

    with read_zip(docx_bytes) as archive:
        story_names = {part.name for part in iter_story_parts(docx_bytes)}
        for name in archive.namelist():
            if name not in story_names:
                continue
            root = parse_xml(archive.read(name))
            changed = False
            for text_node in list(root.xpath(".//w:t", namespaces=NS)):
                raw_text = text_node.text or ""
                if _has_sdt_ancestor(text_node):
                    continue
                match = PLACEHOLDER_RE.fullmatch(raw_text.strip())
                if not match:
                    if PLACEHOLDER_RE.search(raw_text):
                        stats["skipped"] += 1
                    continue
                parent_run = text_node.getparent()
                if parent_run is None or parent_run.tag != qn("w", "r"):
                    stats["skipped"] += 1
                    continue
                container = parent_run.getparent()
                if container is None or container.tag == qn("w", "sdtContent"):
                    stats["skipped"] += 1
                    continue
                tag = match.group(1)
                index = container.index(parent_run)
                container.remove(parent_run)
                container.insert(index, _build_plain_text_sdt(tag, raw_text))
                stats["wrapped"] += 1
                stats["tags"].append(tag)
                changed = True
            if changed:
                replacements[name] = xml_bytes(root)

    return replace_zip_parts(docx_bytes, replacements), stats
