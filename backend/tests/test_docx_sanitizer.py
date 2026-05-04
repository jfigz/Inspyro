import base64
import io
import os
import sys
import unittest
import zipfile

from lxml import etree

sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app.services.docx_sanitizer import (
    sanitize_docx_b64_for_delivery,
    sanitize_docx_bytes_for_delivery,
    sanitize_docx_bytes_for_delivery_result,
)
from librerias_propias.docx_builder.api import build_doc
from librerias_propias.docx_builder.session import get_session, reset_session_cache


WORD_NS = "http://schemas.openxmlformats.org/wordprocessingml/2006/main"
OFFICE_REL_NS = "http://schemas.openxmlformats.org/officeDocument/2006/relationships"
PACKAGE_REL_NS = "http://schemas.openxmlformats.org/package/2006/relationships"
NSMAP = {
    "w": WORD_NS,
    "r": OFFICE_REL_NS,
    "pr": PACKAGE_REL_NS,
}
W = f"{{{WORD_NS}}}"
R = f"{{{OFFICE_REL_NS}}}"
PR = f"{{{PACKAGE_REL_NS}}}"
PROVENANCE_URL = "http://127.0.0.1:8000/api/docx/provenance/open?provenance_id=prov-123"
NORMAL_URL = "https://example.com/reporte"


def _serialize_xml(root: etree._Element) -> bytes:
    return etree.tostring(root, encoding="UTF-8", xml_declaration=True)


def _read_docx_entries(docx_bytes: bytes) -> dict[str, bytes]:
    with zipfile.ZipFile(io.BytesIO(docx_bytes), "r") as zf:
        return {name: zf.read(name) for name in zf.namelist()}


def _write_docx_entries(entries: dict[str, bytes]) -> bytes:
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w", compression=zipfile.ZIP_DEFLATED) as zf:
        for name, payload in entries.items():
            zf.writestr(name, payload)
    return buffer.getvalue()


def _build_paragraph_with_hyperlink(text: str, rel_id: str) -> etree._Element:
    paragraph = etree.Element(f"{W}p", nsmap=NSMAP)
    hyperlink = etree.SubElement(paragraph, f"{W}hyperlink")
    hyperlink.set(f"{R}id", rel_id)
    run = etree.SubElement(hyperlink, f"{W}r")
    node = etree.SubElement(run, f"{W}t")
    node.text = text
    return paragraph


def _build_fldsimple_paragraph(text: str, target: str) -> etree._Element:
    paragraph = etree.Element(f"{W}p", nsmap=NSMAP)
    fld_simple = etree.SubElement(paragraph, f"{W}fldSimple")
    fld_simple.set(f"{W}instr", f' HYPERLINK "{target}" ')
    run = etree.SubElement(fld_simple, f"{W}r")
    node = etree.SubElement(run, f"{W}t")
    node.text = text
    return paragraph


def _build_complex_field_paragraph(text: str, target: str) -> etree._Element:
    paragraph = etree.Element(f"{W}p", nsmap=NSMAP)

    begin_run = etree.SubElement(paragraph, f"{W}r")
    begin = etree.SubElement(begin_run, f"{W}fldChar")
    begin.set(f"{W}fldCharType", "begin")

    instr_run = etree.SubElement(paragraph, f"{W}r")
    instr = etree.SubElement(instr_run, f"{W}instrText")
    instr.set("{http://www.w3.org/XML/1998/namespace}space", "preserve")
    instr.text = f' HYPERLINK "{target}" '

    sep_run = etree.SubElement(paragraph, f"{W}r")
    sep = etree.SubElement(sep_run, f"{W}fldChar")
    sep.set(f"{W}fldCharType", "separate")

    result_run = etree.SubElement(paragraph, f"{W}r")
    result_text = etree.SubElement(result_run, f"{W}t")
    result_text.text = text

    end_run = etree.SubElement(paragraph, f"{W}r")
    end = etree.SubElement(end_run, f"{W}fldChar")
    end.set(f"{W}fldCharType", "end")

    return paragraph


def _append_external_relationship(rels_xml: bytes | None, rel_id: str, target: str) -> bytes:
    if rels_xml:
        root = etree.fromstring(rels_xml)
    else:
        root = etree.Element(f"{PR}Relationships", nsmap={None: PACKAGE_REL_NS})

    relationship = etree.SubElement(root, f"{PR}Relationship")
    relationship.set("Id", rel_id)
    relationship.set("Type", "http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink")
    relationship.set("Target", target)
    relationship.set("TargetMode", "External")
    return _serialize_xml(root)


def _empty_story_part(root_tag: str) -> bytes:
    root = etree.Element(f"{W}{root_tag}", nsmap=NSMAP)
    root.append(etree.Element(f"{W}p"))
    return _serialize_xml(root)


def _build_docx_with_provenance_everywhere() -> bytes:
    namespace = {}
    with build_doc(order=1, namespace=namespace, block_id="cell-link-normal") as builder:
        builder.link("Enlace normal", NORMAL_URL)
    with build_doc(order=2, namespace=namespace, block_id="cell-link-provenance") as builder:
        builder.text("Texto con procedencia")

    session = get_session(namespace)
    raw_docx = base64.b64decode(session.export_docx_base64())
    entries = _read_docx_entries(raw_docx)

    document_root = etree.fromstring(entries["word/document.xml"])
    document_root.append(_build_fldsimple_paragraph("Campo simple procedencia", PROVENANCE_URL))
    document_root.append(_build_complex_field_paragraph("Campo complejo procedencia", PROVENANCE_URL))
    entries["word/document.xml"] = _serialize_xml(document_root)

    for part_name, rel_name, rel_id, text in (
        ("word/header1.xml", "word/_rels/header1.xml.rels", "rIdProvHeader", "Encabezado con procedencia"),
        ("word/footer1.xml", "word/_rels/footer1.xml.rels", "rIdProvFooter", "Pie con procedencia"),
    ):
        if part_name not in entries:
            entries[part_name] = _empty_story_part("hdr" if "header" in part_name else "ftr")
        root = etree.fromstring(entries[part_name])
        root.append(_build_paragraph_with_hyperlink(text, rel_id))
        entries[part_name] = _serialize_xml(root)
        entries[rel_name] = _append_external_relationship(entries.get(rel_name), rel_id, PROVENANCE_URL)

    return _write_docx_entries(entries)


def _relationship_targets(docx_bytes: bytes) -> list[str]:
    targets: list[str] = []
    with zipfile.ZipFile(io.BytesIO(docx_bytes), "r") as zf:
        for name in zf.namelist():
            if not name.endswith(".rels"):
                continue
            root = etree.fromstring(zf.read(name))
            for rel in root.findall(".//pr:Relationship", NSMAP):
                targets.append(str(rel.get("Target") or ""))
    return targets


def _package_contains(docx_bytes: bytes, marker: str) -> bool:
    needle = marker.encode("utf-8")
    with zipfile.ZipFile(io.BytesIO(docx_bytes), "r") as zf:
        return any(needle in zf.read(name) for name in zf.namelist())


def _visible_text(docx_bytes: bytes) -> str:
    chunks: list[str] = []
    with zipfile.ZipFile(io.BytesIO(docx_bytes), "r") as zf:
        for name in zf.namelist():
            if not name.startswith("word/") or not name.endswith(".xml") or "/_rels/" in name:
                continue
            root = etree.fromstring(zf.read(name))
            for node in root.findall(".//w:t", NSMAP):
                chunks.append(node.text or "")
    return " ".join(chunks)


class TestDocxSanitizer(unittest.TestCase):
    def setUp(self):
        reset_session_cache()

    def tearDown(self):
        reset_session_cache()

    def test_sanitizer_removes_provenance_from_body_header_footer_and_field_codes(self):
        original_docx = _build_docx_with_provenance_everywhere()
        original_targets = _relationship_targets(original_docx)

        self.assertIn(NORMAL_URL, original_targets)
        self.assertTrue(any(PROVENANCE_URL in target for target in original_targets))
        self.assertTrue(_package_contains(original_docx, PROVENANCE_URL))

        result = sanitize_docx_bytes_for_delivery_result(original_docx)
        sanitized_docx = result.docx_bytes
        sanitized_targets = _relationship_targets(sanitized_docx)

        self.assertTrue(result.changed)
        self.assertGreaterEqual(result.provenance_relationships_detected, 3)
        self.assertGreaterEqual(result.relationships_removed, 3)
        self.assertGreaterEqual(result.hyperlink_nodes_removed, 3)
        self.assertGreaterEqual(result.field_code_hyperlinks_removed, 2)
        self.assertIn(NORMAL_URL, sanitized_targets)
        self.assertFalse(any(PROVENANCE_URL in target for target in sanitized_targets))
        self.assertFalse(_package_contains(sanitized_docx, PROVENANCE_URL))

        text = _visible_text(sanitized_docx)
        self.assertIn("Enlace normal", text)
        self.assertIn("Texto con procedencia", text)
        self.assertIn("Encabezado con procedencia", text)
        self.assertIn("Pie con procedencia", text)
        self.assertIn("Campo simple procedencia", text)
        self.assertIn("Campo complejo procedencia", text)

    def test_sanitizer_base64_matches_bytes_variant(self):
        original_docx = _build_docx_with_provenance_everywhere()
        original_b64 = base64.b64encode(original_docx).decode("ascii")

        sanitized_from_bytes = sanitize_docx_bytes_for_delivery(original_docx)
        sanitized_from_b64 = base64.b64decode(sanitize_docx_b64_for_delivery(original_b64))

        self.assertEqual(sanitized_from_bytes, sanitized_from_b64)


if __name__ == "__main__":
    unittest.main()
