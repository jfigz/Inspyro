import base64
import io
import os
import sys
import unittest
import zipfile
from pathlib import Path
from tempfile import TemporaryDirectory

from lxml import etree

sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from librerias_propias.docx_builder.session import get_session, reset_session_cache


PACKAGE_REL_NS = "http://schemas.openxmlformats.org/package/2006/relationships"
NSMAP = {"pr": PACKAGE_REL_NS}
PROVENANCE_MARKER = "/api/docx/provenance/open"
NORMAL_URL = "https://example.com/reporte"


def _package_contains(docx_bytes: bytes, marker: str) -> bool:
    needle = marker.encode("utf-8")
    with zipfile.ZipFile(io.BytesIO(docx_bytes), "r") as zf:
        return any(needle in zf.read(name) for name in zf.namelist())


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


class TestDocxExportDelivery(unittest.TestCase):
    def setUp(self):
        reset_session_cache()

    def tearDown(self):
        reset_session_cache()

    def test_doc_export_delivery_variants_are_sanitized_but_raw_session_export_is_not(self):
        with TemporaryDirectory() as tmp_dir:
            output_path = str(Path(tmp_dir) / "delivery.docx")
            namespace: dict[str, object] = {}
            exec(
                (
                    "from librerias_propias.docx_builder.api import build_doc, doc_export\n"
                    f"with build_doc(order=1, block_id='cell-link-normal') as doc:\n"
                    f"    doc.link('Enlace normal', {NORMAL_URL!r})\n"
                    "with build_doc(order=2, block_id='cell-link-provenance') as doc:\n"
                    "    doc.text('Texto con procedencia')\n"
                    "export_b64 = doc_export(format='docx')\n"
                    "export_bytes = doc_export(format='bytes')\n"
                    f"export_path = doc_export(format='path', path={output_path!r})\n"
                ),
                namespace,
            )

            raw_docx = base64.b64decode(get_session(namespace).export_docx_base64())
            delivery_b64 = base64.b64decode(namespace["export_b64"])
            delivery_bytes = namespace["export_bytes"]
            delivery_path = Path(namespace["export_path"])

            self.assertTrue(_package_contains(raw_docx, PROVENANCE_MARKER))
            self.assertFalse(_package_contains(delivery_b64, PROVENANCE_MARKER))
            self.assertFalse(_package_contains(delivery_bytes, PROVENANCE_MARKER))
            self.assertFalse(_package_contains(delivery_path.read_bytes(), PROVENANCE_MARKER))
            self.assertIn(NORMAL_URL, _relationship_targets(delivery_b64))
            self.assertIn(NORMAL_URL, _relationship_targets(delivery_bytes))
            self.assertEqual(delivery_path, Path(output_path))


if __name__ == "__main__":
    unittest.main()
