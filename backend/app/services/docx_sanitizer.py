from __future__ import annotations

import base64
import io
import re
import zipfile
from dataclasses import dataclass
from pathlib import PurePosixPath
from typing import Iterable

from lxml import etree


WORD_NS = "http://schemas.openxmlformats.org/wordprocessingml/2006/main"
OFFICE_REL_NS = "http://schemas.openxmlformats.org/officeDocument/2006/relationships"
PACKAGE_REL_NS = "http://schemas.openxmlformats.org/package/2006/relationships"
XML_NS = "http://www.w3.org/XML/1998/namespace"
NSMAP = {
    "w": WORD_NS,
    "r": OFFICE_REL_NS,
    "pr": PACKAGE_REL_NS,
}
W = f"{{{WORD_NS}}}"
R = f"{{{OFFICE_REL_NS}}}"
XML = f"{{{XML_NS}}}"
PROVENANCE_PATH_MARKER = "/api/docx/provenance/open"
FIELD_HYPERLINK_RE = re.compile(r"\bHYPERLINK\b", re.IGNORECASE)


@dataclass(frozen=True)
class DocxSanitizationResult:
    docx_bytes: bytes
    provenance_relationships_detected: int
    relationships_removed: int
    hyperlink_nodes_removed: int
    field_code_hyperlinks_removed: int
    parts_modified: tuple[str, ...]

    @property
    def changed(self) -> bool:
        return bool(
            self.relationships_removed
            or self.hyperlink_nodes_removed
            or self.field_code_hyperlinks_removed
        )


def sanitize_docx_bytes_for_delivery(docx_bytes: bytes) -> bytes:
    return sanitize_docx_bytes_for_delivery_result(docx_bytes).docx_bytes


def sanitize_docx_b64_for_delivery(docx_b64: str | None) -> str | None:
    if not docx_b64:
        return docx_b64
    sanitized = sanitize_docx_bytes_for_delivery(base64.b64decode(docx_b64))
    return base64.b64encode(sanitized).decode("ascii")


def sanitize_docx_bytes_for_delivery_result(docx_bytes: bytes) -> DocxSanitizationResult:
    if not docx_bytes:
        return DocxSanitizationResult(
            docx_bytes=b"",
            provenance_relationships_detected=0,
            relationships_removed=0,
            hyperlink_nodes_removed=0,
            field_code_hyperlinks_removed=0,
            parts_modified=(),
        )

    parser = etree.XMLParser(remove_blank_text=False, resolve_entities=False, recover=False)
    original_buffer = io.BytesIO(docx_bytes)
    output_buffer = io.BytesIO()

    provenance_relationships_detected = 0
    relationships_removed = 0
    hyperlink_nodes_removed = 0
    field_code_hyperlinks_removed = 0
    modified_parts: list[str] = []
    rewritten_entries: dict[str, bytes] = {}

    try:
        zin_context = zipfile.ZipFile(original_buffer, "r")
    except zipfile.BadZipFile:
        return DocxSanitizationResult(
            docx_bytes=docx_bytes,
            provenance_relationships_detected=0,
            relationships_removed=0,
            hyperlink_nodes_removed=0,
            field_code_hyperlinks_removed=0,
            parts_modified=(),
        )

    with zin_context as zin:
        names = set(zin.namelist())
        candidate_parts = _iter_candidate_word_parts(names)

        for part_name in candidate_parts:
            xml_bytes = zin.read(part_name)
            rels_name = _rels_name_for_part(part_name)
            rels_bytes = zin.read(rels_name) if rels_name in names else None

            try:
                xml_root = etree.fromstring(xml_bytes, parser)
            except etree.XMLSyntaxError:
                continue

            rels_root = None
            provenance_rel_ids: set[str] = set()
            provenance_rel_elements: list[etree._Element] = []

            if rels_bytes is not None:
                try:
                    rels_root = etree.fromstring(rels_bytes, parser)
                except etree.XMLSyntaxError:
                    rels_root = None

            if rels_root is not None:
                provenance_rel_elements = _find_provenance_relationships(rels_root)
                provenance_rel_ids = {
                    str(rel.get("Id") or "").strip()
                    for rel in provenance_rel_elements
                    if str(rel.get("Id") or "").strip()
                }
                provenance_relationships_detected += len(provenance_rel_elements)

            removed_hyperlinks = _unwrap_provenance_hyperlinks(xml_root, provenance_rel_ids)
            removed_field_codes = _remove_provenance_field_codes(xml_root)
            removed_relationships = 0

            if rels_root is not None and provenance_rel_elements:
                for rel in provenance_rel_elements:
                    parent = rel.getparent()
                    if parent is not None:
                        parent.remove(rel)
                        removed_relationships += 1

            if removed_hyperlinks or removed_field_codes or removed_relationships:
                rewritten_entries[part_name] = _serialize_xml(xml_root, original=xml_bytes)
                modified_parts.append(part_name)
                hyperlink_nodes_removed += removed_hyperlinks
                field_code_hyperlinks_removed += removed_field_codes

                if rels_root is not None and rels_name:
                    rewritten_entries[rels_name] = _serialize_xml(rels_root, original=rels_bytes or b"")
                    if rels_name not in modified_parts:
                        modified_parts.append(rels_name)
                relationships_removed += removed_relationships

        if not rewritten_entries:
            return DocxSanitizationResult(
                docx_bytes=docx_bytes,
                provenance_relationships_detected=provenance_relationships_detected,
                relationships_removed=0,
                hyperlink_nodes_removed=0,
                field_code_hyperlinks_removed=0,
                parts_modified=(),
            )

        with zipfile.ZipFile(output_buffer, "w") as zout:
            for item in zin.infolist():
                payload = rewritten_entries.get(item.filename)
                if payload is None:
                    payload = zin.read(item.filename)
                zout.writestr(item, payload)

    return DocxSanitizationResult(
        docx_bytes=output_buffer.getvalue(),
        provenance_relationships_detected=provenance_relationships_detected,
        relationships_removed=relationships_removed,
        hyperlink_nodes_removed=hyperlink_nodes_removed,
        field_code_hyperlinks_removed=field_code_hyperlinks_removed,
        parts_modified=tuple(modified_parts),
    )


def _iter_candidate_word_parts(names: Iterable[str]) -> list[str]:
    parts = []
    for name in sorted(names):
        if not name.startswith("word/") or not name.endswith(".xml"):
            continue
        if "/_rels/" in name:
            continue
        parts.append(name)
    return parts


def _rels_name_for_part(part_name: str) -> str:
    part_path = PurePosixPath(part_name)
    return str(part_path.parent / "_rels" / f"{part_path.name}.rels")


def _serialize_xml(root: etree._Element, *, original: bytes) -> bytes:
    xml_declaration = original.lstrip().startswith(b"<?xml")
    return etree.tostring(root, encoding="UTF-8", xml_declaration=xml_declaration)


def _find_provenance_relationships(rels_root: etree._Element) -> list[etree._Element]:
    relationships = []
    for rel in rels_root.findall(".//pr:Relationship", NSMAP):
        target = str(rel.get("Target") or "")
        if _is_provenance_target(target):
            relationships.append(rel)
    return relationships


def _is_provenance_target(target: str | None) -> bool:
    normalized = str(target or "").strip().replace("\\", "/").lower()
    return PROVENANCE_PATH_MARKER in normalized


def _unwrap_provenance_hyperlinks(xml_root: etree._Element, provenance_rel_ids: set[str]) -> int:
    if not provenance_rel_ids:
        return 0

    removed = 0
    xpath = ".//w:hyperlink[@r:id]"
    for hyperlink in list(xml_root.xpath(xpath, namespaces=NSMAP)):
        rel_id = str(hyperlink.get(f"{R}id") or "").strip()
        if rel_id not in provenance_rel_ids:
            continue
        _unwrap_element_preserving_children(hyperlink)
        removed += 1
    return removed


def _remove_provenance_field_codes(xml_root: etree._Element) -> int:
    removed = 0

    for fld_simple in list(xml_root.xpath(".//w:fldSimple", namespaces=NSMAP)):
        instruction = fld_simple.get(f"{W}instr") or fld_simple.get("instr")
        if not _instruction_targets_provenance(instruction):
            continue
        _unwrap_element_preserving_children(fld_simple)
        removed += 1

    for parent in list(xml_root.iter()):
        removed += _remove_provenance_complex_fields_from_parent(parent)

    return removed


def _instruction_targets_provenance(instruction: str | None) -> bool:
    if not instruction:
        return False
    normalized = " ".join(str(instruction).split())
    return bool(FIELD_HYPERLINK_RE.search(normalized) and _is_provenance_target(normalized))


def _remove_provenance_complex_fields_from_parent(parent: etree._Element) -> int:
    children = list(parent)
    if not children:
        return 0

    removals: list[tuple[int, int | None, int]] = []
    idx = 0
    while idx < len(children):
        node = children[idx]
        if _fld_char_type(node) != "begin":
            idx += 1
            continue

        depth = 1
        separator_idx: int | None = None
        instruction_parts: list[str] = []
        end_idx: int | None = None
        cursor = idx + 1

        while cursor < len(children):
            current = children[cursor]
            field_type = _fld_char_type(current)
            if field_type == "begin":
                depth += 1
            elif field_type == "end":
                depth -= 1
                if depth == 0:
                    end_idx = cursor
                    break
            elif depth == 1 and field_type == "separate" and separator_idx is None:
                separator_idx = cursor

            if depth == 1:
                instruction_parts.extend(_instr_text_fragments(current))
            cursor += 1

        if end_idx is None:
            break

        if _instruction_targets_provenance("".join(instruction_parts)):
            removals.append((idx, separator_idx, end_idx))

        idx = end_idx + 1

    removed = 0
    for start_idx, separator_idx, end_idx in reversed(removals):
        current_children = list(parent)
        if end_idx >= len(current_children):
            continue
        keep_range = range(separator_idx + 1, end_idx) if separator_idx is not None else range(0, 0)
        for child_idx in range(end_idx, start_idx - 1, -1):
            if child_idx in keep_range:
                continue
            node = current_children[child_idx]
            _remove_node_preserving_tail(node)
        removed += 1
    return removed


def _fld_char_type(node: etree._Element) -> str | None:
    if node.tag != f"{W}r":
        return None
    fld_char = node.find("w:fldChar", NSMAP)
    if fld_char is None:
        return None
    return fld_char.get(f"{W}fldCharType") or fld_char.get("fldCharType")


def _instr_text_fragments(node: etree._Element) -> list[str]:
    if node.tag != f"{W}r":
        return []
    fragments = []
    for instr in node.findall("w:instrText", NSMAP):
        fragments.append(instr.text or "")
    for instr in node.findall("w:delInstrText", NSMAP):
        fragments.append(instr.text or "")
    return fragments


def _unwrap_element_preserving_children(node: etree._Element) -> None:
    parent = node.getparent()
    if parent is None:
        return

    insert_at = parent.index(node)
    children = list(node)
    for child in children:
        node.remove(child)
        parent.insert(insert_at, child)
        insert_at += 1

    _append_tail(parent, insert_at - 1, node.tail)
    parent.remove(node)


def _remove_node_preserving_tail(node: etree._Element) -> None:
    parent = node.getparent()
    if parent is None:
        return
    previous_index = parent.index(node) - 1
    _append_tail(parent, previous_index, node.tail)
    parent.remove(node)


def _append_tail(parent: etree._Element, previous_index: int, tail: str | None) -> None:
    if not tail:
        return
    if previous_index >= 0:
        previous = parent[previous_index]
        previous.tail = (previous.tail or "") + tail
        return
    parent.text = (parent.text or "") + tail
