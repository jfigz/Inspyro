import base64
import asyncio
import io
import json
import os
import sys
import time
import unittest
import zipfile
import xml.etree.ElementTree as ET
from datetime import datetime, timezone
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest.mock import AsyncMock, patch

from fastapi import HTTPException

sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app.routers import docx as docx_router_module
from app.routers import notebook_execution as notebook_execution_module
from app.services import docx_artifacts, docx_downloads, notebook_service
from librerias_propias.docx_builder.api import build_doc
from librerias_propias.docx_builder.session import get_session, reset_session_cache


REL_NS = {"rel": "http://schemas.openxmlformats.org/package/2006/relationships"}


def _build_docx_with_visible_and_provenance_links() -> str:
    namespace = {}
    with build_doc(order=1, namespace=namespace, block_id="cell-link-normal") as builder:
        builder.link("Enlace normal", "https://example.com/reporte")
    with build_doc(order=2, namespace=namespace, block_id="cell-link-provenance") as builder:
        builder.text("Texto con procedencia")
    session = get_session(namespace)
    return session.export_docx_base64()


def _docx_relationship_targets_from_b64(docx_b64: str) -> list[str]:
    return _docx_relationship_targets_from_bytes(base64.b64decode(docx_b64))


def _docx_relationship_targets_from_bytes(docx_bytes: bytes) -> list[str]:
    with zipfile.ZipFile(io.BytesIO(docx_bytes), "r") as zf:
        rels_root = ET.fromstring(zf.read("word/_rels/document.xml.rels"))
    return [
        str(rel.get("Target") or "")
        for rel in rels_root.findall("rel:Relationship", REL_NS)
    ]


class TestDocxArtifacts(unittest.TestCase):
    def setUp(self):
        reset_session_cache()

    def tearDown(self):
        reset_session_cache()

    def _patch_artifact_store(self, root_dir: Path, *, active_workspace: Path | None = None):
        blobs_dir = root_dir / "blobs"
        blobs_dir.mkdir(parents=True, exist_ok=True)
        manifests_dir = root_dir / "manifests"
        manifests_dir.mkdir(parents=True, exist_ok=True)
        index_path = root_dir / "index.json"
        workspace_dir = active_workspace
        if workspace_dir is not None:
            workspace_dir.mkdir(parents=True, exist_ok=True)
        return patch.multiple(
            docx_artifacts,
            DOCX_ARTIFACT_ROOT=root_dir,
            DOCX_ARTIFACT_BLOBS_DIR=blobs_dir,
            DOCX_ARTIFACT_MANIFESTS_DIR=manifests_dir,
            DOCX_ARTIFACT_INDEX_PATH=index_path,
            get_workspace_snapshot=(lambda: {"active_workspace": str(workspace_dir)} if workspace_dir else {"active_workspace": None}),
        )

    def _patch_download_store(self, root_dir: Path):
        download_dir = root_dir / "downloads"
        download_dir.mkdir(parents=True, exist_ok=True)
        return patch.object(docx_downloads, "DOCX_DOWNLOAD_DIR", download_dir)

    def _reset_artifact_store(self):
        with docx_artifacts._ARTIFACT_LOCK:
            docx_artifacts._ARTIFACTS = None
            docx_artifacts._PROVENANCE_INDEX = None
            docx_artifacts._LAST_CLEANUP_AT = 0.0
            docx_artifacts._initialize_docx_artifact_store()

    def _reset_download_store(self):
        with docx_downloads._DOCX_LOCK:
            docx_downloads._DOCX_CACHE.clear()
            docx_downloads._DOCX_LAST_FILESYSTEM_CLEANUP_AT = 0.0
        download_dir = Path(docx_downloads.DOCX_DOWNLOAD_DIR)
        download_dir.mkdir(parents=True, exist_ok=True)
        for file_path in download_dir.glob("*.docx"):
            file_path.unlink(missing_ok=True)

    def _assert_no_cache_headers(self, response):
        self.assertEqual(
            response.headers.get("cache-control"),
            docx_router_module.DOCX_NO_CACHE_HEADERS["Cache-Control"],
        )
        self.assertEqual(
            response.headers.get("pragma"),
            docx_router_module.DOCX_NO_CACHE_HEADERS["Pragma"],
        )
        self.assertEqual(
            response.headers.get("expires"),
            docx_router_module.DOCX_NO_CACHE_HEADERS["Expires"],
        )

    def test_same_docx_hash_creates_two_history_entries(self):
        payload = base64.b64encode(b"fake-docx-bytes").decode("ascii")
        with TemporaryDirectory() as tmp_dir:
            root_dir = Path(tmp_dir)
            with self._patch_artifact_store(root_dir, active_workspace=root_dir / "workspace"):
                self._reset_artifact_store()
                first = docx_artifacts.store_docx_artifact(
                    payload,
                    filename="report.docx",
                    docx_hash="hash-1",
                    source_kind="notebook",
                    source_path="C:/workspace/demo.ipynb",
                    kernel_id="kernel-1",
                    execution_id="exec-1",
                )
                second = docx_artifacts.store_docx_artifact(
                    payload,
                    filename="report.docx",
                    docx_hash="hash-1",
                    source_kind="notebook",
                    source_path="C:/workspace/demo.ipynb",
                    kernel_id="kernel-1",
                    execution_id="exec-2",
                )

                self.assertNotEqual(first["artifact_id"], second["artifact_id"])
                items = docx_artifacts.list_docx_artifacts(source_path="C:/workspace/demo.ipynb", limit=10)
                self.assertEqual(len(items), 2)
                self.assertEqual(items[0]["docx_hash"], "hash-1")
                self.assertEqual(items[1]["docx_hash"], "hash-1")
                self.assertEqual(items[0]["path"], items[1]["path"])

    def test_prepare_docx_payload_keeps_download_route_when_storage_fails(self):
        payload = base64.b64encode(b"0123456789").decode("ascii")
        with patch.object(notebook_service, "DOCX_INLINE_MAX_B64", 1):
            with patch.object(notebook_service, "store_docx_artifact", side_effect=RuntimeError("artifact_fail")):
                with patch.object(notebook_service, "store_docx_base64", side_effect=RuntimeError("legacy_fail")):
                    result = notebook_service._prepare_docx_payload(
                        payload,
                        kernel_id="kernel-1",
                        source_kind="notebook",
                        source_path="C:/workspace/demo.ipynb",
                    )

        self.assertIsNone(result["docx_file_b64"])
        self.assertEqual(result["docx_ref"], "/api/docx/download?kernel_id=kernel-1")
        self.assertIn("artifact_fail", result["docx_store_error"])
        self.assertIn("legacy_fail", result["docx_store_error"])

    def test_download_route_resolves_artifact_id_after_reload(self):
        payload = base64.b64encode(b"persisted-docx").decode("ascii")
        with TemporaryDirectory() as tmp_dir:
            root_dir = Path(tmp_dir)
            with self._patch_artifact_store(root_dir, active_workspace=root_dir / "workspace"):
                self._reset_artifact_store()
                stored = docx_artifacts.store_docx_artifact(
                    payload,
                    filename="persisted.docx",
                    docx_hash="hash-persisted",
                    source_kind="notebook",
                    source_path="C:/workspace/demo.ipynb",
                    kernel_id="kernel-1",
                    execution_id="exec-1",
                )
                docx_artifacts._ARTIFACTS = None
                response = asyncio.run(
                    docx_router_module.download_docx(
                        artifact_id=stored["artifact_id"],
                        token=None,
                        source_path=None,
                        kernel_id=None,
                    )
                )
                self.assertEqual(response.body, b"persisted-docx")
                self._assert_no_cache_headers(response)

    def test_download_route_kernel_fallback_is_not_cacheable(self):
        payload = base64.b64encode(b"runtime-docx").decode("ascii")
        kernel_id = "kernel-runtime-docx"
        notebook_service.notebook_last_docx_b64[kernel_id] = payload
        try:
            response = asyncio.run(
                docx_router_module.download_docx(
                    artifact_id=None,
                    token=None,
                    source_path=None,
                    kernel_id=kernel_id,
                )
            )
        finally:
            notebook_service.notebook_last_docx_b64.pop(kernel_id, None)

        self.assertEqual(response.body, b"runtime-docx")
        self._assert_no_cache_headers(response)

    def test_docx_history_is_not_cacheable(self):
        payload = base64.b64encode(b"history-docx").decode("ascii")
        with TemporaryDirectory() as tmp_dir:
            root_dir = Path(tmp_dir)
            workspace_dir = root_dir / "workspace"
            with self._patch_artifact_store(root_dir, active_workspace=workspace_dir):
                self._reset_artifact_store()
                stored = docx_artifacts.store_docx_artifact(
                    payload,
                    filename="history.docx",
                    docx_hash="hash-history",
                    source_kind="notebook",
                    source_path="C:/workspace/demo.ipynb",
                    kernel_id="kernel-1",
                    execution_id="exec-1",
                )
                response = asyncio.run(
                    docx_router_module.get_docx_history(
                        source_path="C:/workspace/demo.ipynb",
                        kernel_id=None,
                        limit=10,
                    )
                )

        self.assertEqual(response.status_code, 200)
        self._assert_no_cache_headers(response)
        body = json.loads(response.body.decode("utf-8"))
        self.assertEqual(body["items"][0]["workspace_path"], stored["workspace_path"])
        self.assertEqual(body["items"][0]["workspace_relpath"], stored["workspace_relpath"])

    def test_list_workspace_docx_artifacts_filters_by_source_workspace(self):
        payload = base64.b64encode(b"workspace-filter-docx").decode("ascii")
        with TemporaryDirectory() as tmp_dir:
            root_dir = Path(tmp_dir)
            workspace_a = root_dir / "workspace-a"
            workspace_b = root_dir / "workspace-b"
            workspace_a.mkdir(parents=True)
            workspace_b.mkdir(parents=True)
            source_a = workspace_a / "reports" / "beam.ipynb"
            source_b = workspace_b / "reports" / "column.ipynb"
            source_a.parent.mkdir(parents=True, exist_ok=True)
            source_b.parent.mkdir(parents=True, exist_ok=True)
            source_a.write_text("{}", encoding="utf-8")
            source_b.write_text("{}", encoding="utf-8")

            with self._patch_artifact_store(root_dir / "artifacts", active_workspace=workspace_a):
                self._reset_artifact_store()
                docx_artifacts.store_docx_artifact(
                    payload,
                    filename="beam.docx",
                    docx_hash="hash-a",
                    source_kind="notebook",
                    source_path=str(source_a),
                    kernel_id="kernel-a",
                    execution_id="exec-a",
                )
                docx_artifacts.store_docx_artifact(
                    payload,
                    filename="column.docx",
                    docx_hash="hash-b",
                    source_kind="notebook",
                    source_path=str(source_b),
                    kernel_id="kernel-b",
                    execution_id="exec-b",
                )

                items = docx_artifacts.list_workspace_docx_artifacts(
                    workspace_root=workspace_a,
                    limit=10,
                )

        self.assertEqual(len(items), 1)

    def test_store_docx_artifact_materializes_under_source_workspace_when_active_workspace_changes(self):
        payload = base64.b64encode(b"source-workspace-docx").decode("ascii")
        with TemporaryDirectory() as tmp_dir:
            root_dir = Path(tmp_dir)
            workspace_a = root_dir / "workspace-a"
            workspace_b = root_dir / "workspace-b"
            source_a = workspace_a / "reports" / "beam.ipynb"
            workspace_a.mkdir(parents=True, exist_ok=True)
            workspace_b.mkdir(parents=True, exist_ok=True)
            source_a.parent.mkdir(parents=True, exist_ok=True)
            source_a.write_text("{}", encoding="utf-8")

            with self._patch_artifact_store(root_dir / "artifacts", active_workspace=workspace_b):
                self._reset_artifact_store()
                stored = docx_artifacts.store_docx_artifact(
                    payload,
                    filename="beam.docx",
                    docx_hash="hash-source-workspace",
                    source_kind="notebook",
                    source_path=str(source_a),
                    kernel_id="kernel-a",
                    execution_id="exec-a",
                )

        expected_workspace_root = source_a.parent.resolve()
        self.assertTrue(Path(stored["workspace_path"]).resolve().is_relative_to(expected_workspace_root))
        self.assertFalse(Path(stored["workspace_path"]).resolve().is_relative_to(workspace_b.resolve()))

    def test_reset_docx_artifacts_removes_only_requested_source(self):
        payload = base64.b64encode(b"history-docx").decode("ascii")
        with TemporaryDirectory() as tmp_dir:
            root_dir = Path(tmp_dir)
            workspace_dir = root_dir / "workspace"
            with self._patch_artifact_store(root_dir, active_workspace=workspace_dir):
                self._reset_artifact_store()
                docx_artifacts.store_docx_artifact(
                    payload,
                    filename="history-a.docx",
                    docx_hash="hash-history-a",
                    source_kind="notebook",
                    source_path="C:/workspace/a.ipynb",
                    kernel_id="kernel-a",
                    execution_id="exec-a",
                )
                docx_artifacts.store_docx_artifact(
                    payload,
                    filename="history-b.docx",
                    docx_hash="hash-history-b",
                    source_kind="notebook",
                    source_path="C:/workspace/b.ipynb",
                    kernel_id="kernel-b",
                    execution_id="exec-b",
                )

                removed = docx_artifacts.reset_docx_artifacts(source_path="C:/workspace/a.ipynb")

                self.assertEqual(removed, 1)
                self.assertEqual(
                    docx_artifacts.list_docx_artifacts(source_path="C:/workspace/a.ipynb", limit=10),
                    [],
                )
                remaining = docx_artifacts.list_docx_artifacts(source_path="C:/workspace/b.ipynb", limit=10)
                self.assertEqual(len(remaining), 1)

    def test_docx_test_reset_route_is_env_gated(self):
        with patch.dict(os.environ, {}, clear=False):
            with self.assertRaises(HTTPException) as exc_info:
                asyncio.run(docx_router_module.reset_docx_history_for_tests({}))
        self.assertEqual(exc_info.exception.status_code, 404)

    def test_store_docx_artifact_persists_provenance_manifest_and_index(self):
        payload = base64.b64encode(b"history-docx").decode("ascii")
        manifest = {
            "generated_at": "2026-04-10T00:00:00Z",
            "items": [
                {
                    "provenance_id": "prov-1",
                    "file_path": "C:/workspace/demo.py",
                    "line": 17,
                    "api_name": "heading",
                    "element_kind": "heading",
                    "precision": "exact",
                    "text_preview": "Titulo",
                },
            ],
        }
        with TemporaryDirectory() as tmp_dir:
            root_dir = Path(tmp_dir)
            with self._patch_artifact_store(root_dir, active_workspace=root_dir / "workspace"):
                self._reset_artifact_store()
                stored = docx_artifacts.store_docx_artifact(
                    payload,
                    filename="history.docx",
                    docx_hash="hash-history",
                    source_kind="notebook",
                    source_path="C:/workspace/demo.ipynb",
                    kernel_id="kernel-1",
                    execution_id="exec-1",
                    provenance_manifest=manifest,
                )

                self.assertTrue(stored["docx_provenance_available"])
                self.assertIn("/api/docx/provenance?artifact_id=", stored["docx_provenance_ref"])

                loaded_manifest = docx_artifacts.get_docx_provenance(stored["artifact_id"])
                self.assertIsNotNone(loaded_manifest)
                self.assertEqual(loaded_manifest["artifact_id"], stored["artifact_id"])
                self.assertEqual(loaded_manifest["items"][0]["provenance_id"], "prov-1")

                resolved = docx_artifacts.resolve_docx_provenance("prov-1")
                self.assertIsNotNone(resolved)
                self.assertEqual(resolved["artifact_id"], stored["artifact_id"])
                self.assertEqual(resolved["item"]["line"], 17)

    def test_docx_provenance_routes_are_not_cacheable(self):
        payload = base64.b64encode(b"history-docx").decode("ascii")
        manifest = {
            "items": [
                {
                    "provenance_id": "prov-1",
                    "notebook_cell_id": "cell-1",
                    "line": 7,
                    "api_name": "text",
                    "element_kind": "paragraph",
                    "precision": "fallback",
                    "text_preview": "parrafo",
                },
            ],
        }
        with TemporaryDirectory() as tmp_dir:
            root_dir = Path(tmp_dir)
            with self._patch_artifact_store(root_dir, active_workspace=root_dir / "workspace"):
                self._reset_artifact_store()
                stored = docx_artifacts.store_docx_artifact(
                    payload,
                    filename="history.docx",
                    docx_hash="hash-history",
                    source_kind="notebook",
                    source_path="C:/workspace/demo.ipynb",
                    kernel_id="kernel-1",
                    execution_id="exec-1",
                    provenance_manifest=manifest,
                )

                manifest_response = asyncio.run(
                    docx_router_module.get_docx_provenance_manifest(artifact_id=stored["artifact_id"])
                )
                self.assertEqual(manifest_response.status_code, 200)
                self._assert_no_cache_headers(manifest_response)
                self.assertIn("prov-1", manifest_response.body.decode("utf-8"))

                open_response = asyncio.run(
                    docx_router_module.open_docx_provenance(provenance_id="prov-1")
                )
                self.assertEqual(open_response.status_code, 200)
                self._assert_no_cache_headers(open_response)
                self.assertIn("Procedencia del documento", open_response.body.decode("utf-8"))

                json_response = asyncio.run(
                    docx_router_module.open_docx_provenance(
                        provenance_id="prov-1",
                        response_format="json",
                    )
                )
                self.assertEqual(json_response.status_code, 200)
                self._assert_no_cache_headers(json_response)
                payload = json.loads(json_response.body.decode("utf-8"))
                self.assertEqual(payload["artifact_id"], stored["artifact_id"])
                self.assertEqual(payload["item"]["provenance_id"], "prov-1")
                self.assertEqual(payload["item"]["line"], 7)

    def test_prepare_docx_payload_sanitizes_visible_docx_but_keeps_internal_artifact(self):
        original_b64 = _build_docx_with_visible_and_provenance_links()
        captured_artifact_b64: list[str] = []

        def _store_artifact(docx_b64: str, **_kwargs):
            captured_artifact_b64.append(docx_b64)
            return {
                "artifact_id": "artifact-1",
                "download_url": "/api/docx/download?artifact_id=artifact-1",
                "filename": "visible.docx",
                "docx_provenance_available": True,
                "docx_provenance_ref": "/api/docx/provenance?artifact_id=artifact-1",
            }

        with patch.object(notebook_service, "DOCX_INLINE_MAX_B64", 10**9):
            with patch.object(notebook_service, "store_docx_artifact", side_effect=_store_artifact):
                with patch.object(notebook_service, "store_docx_base64") as store_legacy_mock:
                    payload = notebook_service._prepare_docx_payload(
                        original_b64,
                        kernel_id="kernel-1",
                        source_kind="notebook",
                        source_path="C:/workspace/demo.ipynb",
                    )

        self.assertEqual(len(captured_artifact_b64), 1)
        store_legacy_mock.assert_not_called()
        self.assertTrue(any("/api/docx/provenance/open" in target for target in _docx_relationship_targets_from_b64(captured_artifact_b64[0])))
        self.assertFalse(any("/api/docx/provenance/open" in target for target in _docx_relationship_targets_from_b64(payload["docx_file_b64"])))
        self.assertIn("https://example.com/reporte", _docx_relationship_targets_from_b64(payload["docx_file_b64"]))
        self.assertIsNone(payload["docx_file_token"])
        self.assertEqual(payload["docx_ref"], "/api/docx/download?artifact_id=artifact-1")
        self.assertIn("sanitize_ms", payload["document_timing_ms"])
        self.assertIn("artifact_store_ms", payload["document_timing_ms"])
        self.assertEqual(
            payload["docx_size_bytes"],
            len(base64.b64decode(payload["docx_file_b64"])),
        )

    def test_store_docx_artifact_materializes_visible_copy_inside_active_workspace(self):
        payload = base64.b64encode(b"workspace-docx").decode("ascii")
        with TemporaryDirectory() as tmp_dir:
            root_dir = Path(tmp_dir)
            workspace_dir = root_dir / "workspace"
            with self._patch_artifact_store(root_dir, active_workspace=workspace_dir):
                self._reset_artifact_store()
                stored = docx_artifacts.store_docx_artifact(
                    payload,
                    filename="ignored.docx",
                    docx_hash="hash-workspace",
                    source_kind="notebook",
                    source_path="C:/workspace/demo.ipynb",
                    kernel_id="kernel-1",
                    execution_id="exec-1",
                )
                workspace_path = Path(stored["workspace_path"])
                self.assertTrue(workspace_path.exists())
                self.assertEqual(workspace_path.parent.name, "Docx_Documents")
                self.assertTrue(workspace_path.name.startswith("Docx_document_"))
                self.assertEqual(stored["filename"], workspace_path.name)
                self.assertNotEqual(Path(stored["path"]), workspace_path)

    def test_store_docx_artifact_warns_and_skips_workspace_write_without_active_workspace(self):
        payload = base64.b64encode(b"workspace-docx").decode("ascii")
        with TemporaryDirectory() as tmp_dir:
            root_dir = Path(tmp_dir)
            with self._patch_artifact_store(root_dir, active_workspace=None):
                self._reset_artifact_store()
                with self.assertLogs(docx_artifacts.__name__, level="WARNING") as logs:
                    stored = docx_artifacts.store_docx_artifact(
                        payload,
                        filename="ignored.docx",
                        docx_hash="hash-workspace",
                        source_kind="notebook",
                        source_path="C:/workspace/demo.ipynb",
                        kernel_id="kernel-1",
                        execution_id="exec-1",
                    )

        self.assertIsNone(stored["workspace_path"])
        self.assertIn("active_workspace_missing", "\n".join(logs.output))

    def test_store_docx_artifact_uses_collision_safe_workspace_filenames(self):
        payload = base64.b64encode(b"collision-docx").decode("ascii")

        class _FrozenDateTime(datetime):
            @classmethod
            def now(cls, tz=None):
                base = datetime(2026, 4, 18, 12, 34, 56, 789000)
                return base if tz is None else base.replace(tzinfo=tz)

        with TemporaryDirectory() as tmp_dir:
            root_dir = Path(tmp_dir)
            workspace_dir = root_dir / "workspace"
            with self._patch_artifact_store(root_dir, active_workspace=workspace_dir):
                self._reset_artifact_store()
                with patch.object(docx_artifacts, "datetime", _FrozenDateTime):
                    first = docx_artifacts.store_docx_artifact(payload, filename="ignored.docx", docx_hash="hash-1")
                    second = docx_artifacts.store_docx_artifact(payload, filename="ignored.docx", docx_hash="hash-2")

        self.assertNotEqual(first["filename"], second["filename"])
        self.assertTrue(first["filename"].startswith("Docx_document_2026-04-18_12-34-56-789"))
        self.assertTrue(second["filename"].startswith("Docx_document_2026-04-18_12-34-56-789"))

    def test_store_docx_artifact_reuses_visible_workspace_copy_for_same_execution(self):
        payload = base64.b64encode(b"workspace-docx").decode("ascii")
        with TemporaryDirectory() as tmp_dir:
            root_dir = Path(tmp_dir)
            workspace_dir = root_dir / "workspace"
            with self._patch_artifact_store(root_dir, active_workspace=workspace_dir):
                self._reset_artifact_store()
                first = docx_artifacts.store_docx_artifact(
                    payload,
                    filename="ignored.docx",
                    docx_hash="hash-reused",
                    source_kind="notebook",
                    source_path="C:/workspace/demo.ipynb",
                    kernel_id="kernel-1",
                    execution_id="exec-reused",
                )
                first_workspace_files = list((workspace_dir / "Docx_Documents").glob("*.docx"))
                second = docx_artifacts.store_docx_artifact(
                    payload,
                    filename="ignored.docx",
                    docx_hash="hash-reused",
                    source_kind="notebook",
                    source_path="C:/workspace/demo.ipynb",
                    kernel_id="kernel-1",
                    execution_id="exec-reused",
                )
                second_workspace_files = list((workspace_dir / "Docx_Documents").glob("*.docx"))

        self.assertNotEqual(first["artifact_id"], second["artifact_id"])
        self.assertEqual(first["workspace_path"], second["workspace_path"])
        self.assertEqual(first["workspace_relpath"], second["workspace_relpath"])
        self.assertEqual(len(first_workspace_files), 1)
        self.assertEqual(len(second_workspace_files), 1)
        self.assertEqual(second["artifact_timing_ms"].get("workspace_write_ms"), 0)

    def test_download_route_prefers_delivery_cache_for_artifact_when_workspace_copy_missing(self):
        payload = _build_docx_with_visible_and_provenance_links()
        with TemporaryDirectory() as tmp_dir:
            root_dir = Path(tmp_dir)
            with self._patch_artifact_store(root_dir, active_workspace=None):
                self._reset_artifact_store()
                stored = docx_artifacts.store_docx_artifact(
                    payload,
                    filename="persisted.docx",
                    docx_hash="hash-persisted",
                    source_kind="notebook",
                    source_path="C:/workspace/demo.ipynb",
                    kernel_id="kernel-1",
                    execution_id="exec-1",
                )
                with patch.object(docx_router_module, "sanitize_docx_bytes_for_delivery", side_effect=AssertionError("should use delivery cache")):
                    response = asyncio.run(
                        docx_router_module.download_docx(
                            artifact_id=stored["artifact_id"],
                            token=None,
                            source_path=None,
                            kernel_id=None,
                        )
                    )

        targets = _docx_relationship_targets_from_bytes(response.body)
        self.assertFalse(any("/api/docx/provenance/open" in target for target in targets))
        self.assertIn("https://example.com/reporte", targets)

    def test_download_route_sanitizes_artifact_docx_without_mutating_store(self):
        payload = _build_docx_with_visible_and_provenance_links()
        with TemporaryDirectory() as tmp_dir:
            root_dir = Path(tmp_dir)
            with self._patch_artifact_store(root_dir, active_workspace=root_dir / "workspace"):
                self._reset_artifact_store()
                stored = docx_artifacts.store_docx_artifact(
                    payload,
                    filename="persisted.docx",
                    docx_hash="hash-persisted",
                    source_kind="notebook",
                    source_path="C:/workspace/demo.ipynb",
                    kernel_id="kernel-1",
                    execution_id="exec-1",
                )
                original_targets = _docx_relationship_targets_from_bytes(Path(stored["path"]).read_bytes())
                self.assertTrue(any("/api/docx/provenance/open" in target for target in original_targets))

                response = asyncio.run(
                    docx_router_module.download_docx(
                        artifact_id=stored["artifact_id"],
                        token=None,
                        source_path=None,
                        kernel_id=None,
                    )
                )

                downloaded_targets = _docx_relationship_targets_from_bytes(response.body)
                self.assertFalse(any("/api/docx/provenance/open" in target for target in downloaded_targets))
                self.assertIn("https://example.com/reporte", downloaded_targets)
                self.assertTrue(any("/api/docx/provenance/open" in target for target in _docx_relationship_targets_from_bytes(Path(stored["path"]).read_bytes())))
                self._assert_no_cache_headers(response)

    def test_download_route_sanitizes_kernel_runtime_fallback_docx(self):
        payload = _build_docx_with_visible_and_provenance_links()
        kernel_id = "kernel-runtime-docx"
        notebook_service.notebook_last_docx_b64[kernel_id] = payload
        try:
            response = asyncio.run(
                docx_router_module.download_docx(
                    artifact_id=None,
                    token=None,
                    source_path=None,
                    kernel_id=kernel_id,
                )
            )
        finally:
            notebook_service.notebook_last_docx_b64.pop(kernel_id, None)

        targets = _docx_relationship_targets_from_bytes(response.body)
        self.assertFalse(any("/api/docx/provenance/open" in target for target in targets))
        self.assertIn("https://example.com/reporte", targets)
        self._assert_no_cache_headers(response)

    def test_download_route_sanitizes_token_docx_without_mutating_cached_file(self):
        payload = _build_docx_with_visible_and_provenance_links()
        with TemporaryDirectory() as tmp_dir:
            root_dir = Path(tmp_dir)
            with self._patch_download_store(root_dir):
                self._reset_download_store()
                stored = docx_downloads.store_docx_base64(payload, filename="token.docx")
                original_targets = _docx_relationship_targets_from_bytes(Path(stored["path"]).read_bytes())
                self.assertTrue(any("/api/docx/provenance/open" in target for target in original_targets))

                response = asyncio.run(
                    docx_router_module.download_docx(
                        artifact_id=None,
                        token=stored["token"],
                        source_path=None,
                        kernel_id=None,
                    )
                )

                downloaded_targets = _docx_relationship_targets_from_bytes(response.body)
                self.assertFalse(any("/api/docx/provenance/open" in target for target in downloaded_targets))
                self.assertIn("https://example.com/reporte", downloaded_targets)
                self.assertTrue(any("/api/docx/provenance/open" in target for target in _docx_relationship_targets_from_bytes(Path(stored["path"]).read_bytes())))
                self._assert_no_cache_headers(response)

    def test_force_reconvert_pdf_uses_original_artifact_docx_with_provenance_links(self):
        payload = _build_docx_with_visible_and_provenance_links()
        captured_docx_b64: list[str] = []
        kernel_id = "kernel-reconvert-docx"
        notebook_service.notebook_last_docx_b64.pop(kernel_id, None)
        notebook_service.notebook_docx_hash.pop(kernel_id, None)
        notebook_service.notebook_docx_source_path.pop(kernel_id, None)
        notebook_service.notebook_docx_source_kind.pop(kernel_id, None)

        def _fake_build_pdf_context(docx_b64, docx_hash, *_args):
            captured_docx_b64.append(docx_b64)
            return (
                {
                    "attempted": True,
                    "error": None,
                    "error_kind": None,
                    "stdout": None,
                    "stderr": None,
                    "duration_ms": 1,
                    "pdf_size_bytes": 3,
                    "converter_used": "mock",
                    "word_error": None,
                },
                base64.b64encode(b"pdf").decode("ascii"),
                "pdf-hash",
                False,
            )

        with TemporaryDirectory() as tmp_dir:
            root_dir = Path(tmp_dir)
            with self._patch_artifact_store(root_dir, active_workspace=root_dir / "workspace"):
                self._reset_artifact_store()
                docx_artifacts.store_docx_artifact(
                    payload,
                    filename="persisted.docx",
                    docx_hash="hash-persisted",
                    source_kind="notebook",
                    source_path="C:/workspace/demo.ipynb",
                    kernel_id=kernel_id,
                    execution_id="exec-1",
                )
                with patch.object(notebook_execution_module, "build_pdf_context", side_effect=_fake_build_pdf_context):
                    with patch.object(notebook_execution_module.manager, "send_personal_message", new=AsyncMock()) as send_mock:
                        asyncio.run(
                            notebook_execution_module.handle_force_reconvert_pdf(
                                {"kernel_id": kernel_id, "request_id": "req-1"},
                                websocket=object(),
                            )
                        )

        self.assertEqual(len(captured_docx_b64), 1)
        self.assertTrue(any("/api/docx/provenance/open" in target for target in _docx_relationship_targets_from_b64(captured_docx_b64[0])))
        sent_payload = send_mock.await_args_list[-1].args[0]
        self.assertEqual(sent_payload["type"], "pdf_reconverted")
        self.assertEqual(sent_payload["status"], "ok")

    def test_cleanup_removes_expired_history_and_blob(self):
        payload = base64.b64encode(b"old-docx").decode("ascii")
        with TemporaryDirectory() as tmp_dir:
            root_dir = Path(tmp_dir)
            with self._patch_artifact_store(root_dir, active_workspace=root_dir / "workspace"):
                self._reset_artifact_store()
                stored = docx_artifacts.store_docx_artifact(
                    payload,
                    filename="old.docx",
                    docx_hash="hash-old",
                    source_kind="code",
                    source_path="C:/workspace/demo.py",
                )

                with docx_artifacts._ARTIFACT_LOCK:
                    docx_artifacts._ensure_index_loaded_locked()
                    docx_artifacts._ARTIFACTS[stored["artifact_id"]]["created_at_ts"] = time.time() - (31 * 24 * 60 * 60)
                    docx_artifacts._save_index_locked()
                    docx_artifacts._cleanup_locked(time.time(), force=True)

                items = docx_artifacts.list_docx_artifacts(source_path="C:/workspace/demo.py", limit=10)
                self.assertEqual(items, [])
                self.assertFalse(Path(stored["path"]).exists())

    def test_run_all_intermediate_cells_do_not_persist_docx_artifacts(self):
        kernel_id = "kernel-run-all"
        notebook_service.notebook_last_docx_b64.pop(kernel_id, None)
        notebook_service.notebook_docx_hash.pop(kernel_id, None)

        async def _run():
            with patch.object(
                notebook_service.jupyter_kernel_manager,
                "execute_cell",
                new=AsyncMock(return_value=([], 1, {}, {"doc_b64": "should_be_ignored"})),
            ):
                with patch.object(notebook_service, "store_docx_artifact") as store_mock:
                    response = await notebook_service._process_notebook_cell_execution(
                        kernel_id=kernel_id,
                        cell_id="cell-1",
                        instrumented_code="print('ok')",
                        source_code="print('ok')",
                        enable_tracing=False,
                        emit_docx=True,
                        skip_pdf=True,
                        on_iopub=AsyncMock(),
                        websocket=object(),
                        execution_id="exec-intermediate",
                    )
            return response, store_mock

        response, store_mock = asyncio.run(_run())
        self.assertFalse(store_mock.called)
        self.assertIsNone(response["docx_ref"])
        self.assertIsNone(response["docx_artifact_id"])
        self.assertNotIn(kernel_id, notebook_service.notebook_last_docx_b64)


if __name__ == "__main__":
    unittest.main()
