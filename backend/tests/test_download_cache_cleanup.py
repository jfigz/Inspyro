import base64
import os
import sys
import time
import unittest
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest.mock import patch


sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app.services import docx_downloads, pdf_downloads


class TestDownloadCacheCleanup(unittest.TestCase):
    def test_startup_cleanup_removes_orphan_files(self):
        with TemporaryDirectory() as tmp_docx, TemporaryDirectory() as tmp_pdf:
            docx_dir = Path(tmp_docx)
            pdf_dir = Path(tmp_pdf)
            (docx_dir / "orphan.docx").write_bytes(b"old-docx")
            (docx_dir / "keep.txt").write_text("keep", encoding="utf-8")
            (pdf_dir / "orphan.pdf").write_bytes(b"%PDF-1.4 orphan")
            (pdf_dir / "keep.txt").write_text("keep", encoding="utf-8")

            with patch.object(docx_downloads, "DOCX_DOWNLOAD_DIR", docx_dir):
                with patch.object(pdf_downloads, "PDF_DOWNLOAD_DIR", pdf_dir):
                    with docx_downloads._DOCX_LOCK:
                        docx_downloads._DOCX_CACHE.clear()
                        docx_downloads._DOCX_LAST_FILESYSTEM_CLEANUP_AT = 0.0
                    with pdf_downloads._PDF_LOCK:
                        pdf_downloads._PDF_CACHE.clear()
                        pdf_downloads._PDF_LAST_FILESYSTEM_CLEANUP_AT = 0.0

                    docx_downloads._initialize_docx_download_store()
                    pdf_downloads._initialize_pdf_download_store()

            self.assertFalse((docx_dir / "orphan.docx").exists())
            self.assertFalse((pdf_dir / "orphan.pdf").exists())
            self.assertTrue((docx_dir / "keep.txt").exists())
            self.assertTrue((pdf_dir / "keep.txt").exists())

    def test_filesystem_cleanup_respects_interval_guard(self):
        with TemporaryDirectory() as tmp_docx, TemporaryDirectory() as tmp_pdf:
            docx_dir = Path(tmp_docx)
            pdf_dir = Path(tmp_pdf)
            docx_orphan = docx_dir / "orphan.docx"
            pdf_orphan = pdf_dir / "orphan.pdf"
            docx_orphan.write_bytes(b"orphan")
            pdf_orphan.write_bytes(b"%PDF-1.4 orphan")
            now = time.time()

            with patch.object(docx_downloads, "DOCX_DOWNLOAD_DIR", docx_dir):
                with patch.object(docx_downloads, "DOCX_FILESYSTEM_CLEANUP_INTERVAL_SECONDS", 3600):
                    with docx_downloads._DOCX_LOCK:
                        docx_downloads._DOCX_CACHE.clear()
                        docx_downloads._DOCX_LAST_FILESYSTEM_CLEANUP_AT = now
                        docx_downloads._cleanup_filesystem_locked(now + 1)
                    self.assertTrue(docx_orphan.exists())
                    with docx_downloads._DOCX_LOCK:
                        docx_downloads._cleanup_filesystem_locked(now + 3601)
                    self.assertFalse(docx_orphan.exists())

            with patch.object(pdf_downloads, "PDF_DOWNLOAD_DIR", pdf_dir):
                with patch.object(pdf_downloads, "PDF_FILESYSTEM_CLEANUP_INTERVAL_SECONDS", 3600):
                    with pdf_downloads._PDF_LOCK:
                        pdf_downloads._PDF_CACHE.clear()
                        pdf_downloads._PDF_LAST_FILESYSTEM_CLEANUP_AT = now
                        pdf_downloads._cleanup_filesystem_locked(now + 1)
                    self.assertTrue(pdf_orphan.exists())
                    with pdf_downloads._PDF_LOCK:
                        pdf_downloads._cleanup_filesystem_locked(now + 3601)
                    self.assertFalse(pdf_orphan.exists())

    def test_expired_entries_are_removed_on_get(self):
        with TemporaryDirectory() as tmp_docx, TemporaryDirectory() as tmp_pdf:
            docx_dir = Path(tmp_docx)
            pdf_dir = Path(tmp_pdf)

            with patch.object(docx_downloads, "DOCX_DOWNLOAD_DIR", docx_dir):
                with patch.object(docx_downloads, "DOCX_FILESYSTEM_CLEANUP_INTERVAL_SECONDS", 3600):
                    with docx_downloads._DOCX_LOCK:
                        docx_downloads._DOCX_CACHE.clear()
                        docx_downloads._DOCX_LAST_FILESYSTEM_CLEANUP_AT = 0.0
                    docx_payload = base64.b64encode(b"fake-docx").decode("ascii")
                    stored_docx = docx_downloads.store_docx_base64(docx_payload, filename="test.docx")
                    docx_token = stored_docx["token"]
                    docx_path = Path(stored_docx["path"])
                    self.assertTrue(docx_path.exists())
                    with docx_downloads._DOCX_LOCK:
                        docx_downloads._DOCX_CACHE[docx_token]["expires_at"] = time.time() - 1
                    self.assertIsNone(docx_downloads.get_docx_file(docx_token))
                    self.assertFalse(docx_path.exists())

            with patch.object(pdf_downloads, "PDF_DOWNLOAD_DIR", pdf_dir):
                with patch.object(pdf_downloads, "PDF_FILESYSTEM_CLEANUP_INTERVAL_SECONDS", 3600):
                    with pdf_downloads._PDF_LOCK:
                        pdf_downloads._PDF_CACHE.clear()
                        pdf_downloads._PDF_LAST_FILESYSTEM_CLEANUP_AT = 0.0
                    stored_pdf = pdf_downloads.store_pdf_bytes(b"%PDF-1.4\n%%EOF\n", filename="test.pdf")
                    pdf_token = stored_pdf["token"]
                    pdf_path = Path(stored_pdf["path"])
                    self.assertTrue(pdf_path.exists())
                    with pdf_downloads._PDF_LOCK:
                        pdf_downloads._PDF_CACHE[pdf_token]["expires_at"] = time.time() - 1
                    self.assertIsNone(pdf_downloads.get_pdf_file(pdf_token))
                    self.assertFalse(pdf_path.exists())


if __name__ == "__main__":
    unittest.main()
