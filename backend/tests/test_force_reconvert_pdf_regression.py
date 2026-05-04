import base64
import io
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest.mock import patch

import pytest
from docx import Document

from app.routers import notebook_execution
from app.services import docx_artifacts, notebook_service
from app.services.notebook_service import set_kernel_docx_source


class _FakeManager:
    def __init__(self) -> None:
        self.messages = []

    async def send_personal_message(self, message, _websocket):
        self.messages.append(message)


def _make_docx_b64(*paragraphs: str) -> str:
    doc = Document()
    for paragraph in paragraphs:
        doc.add_paragraph(paragraph)
    buffer = io.BytesIO()
    doc.save(buffer)
    return base64.b64encode(buffer.getvalue()).decode("utf-8")


def _patch_artifact_store(root_dir: Path):
    blobs_dir = root_dir / "blobs"
    blobs_dir.mkdir(parents=True, exist_ok=True)
    manifests_dir = root_dir / "manifests"
    manifests_dir.mkdir(parents=True, exist_ok=True)
    index_path = root_dir / "index.json"
    workspace_dir = root_dir / "workspace"
    workspace_dir.mkdir(parents=True, exist_ok=True)
    return patch.multiple(
        docx_artifacts,
        DOCX_ARTIFACT_ROOT=root_dir,
        DOCX_ARTIFACT_BLOBS_DIR=blobs_dir,
        DOCX_ARTIFACT_MANIFESTS_DIR=manifests_dir,
        DOCX_ARTIFACT_INDEX_PATH=index_path,
        get_workspace_snapshot=lambda: {"active_workspace": str(workspace_dir)},
    )


def _reset_artifact_store() -> None:
    with docx_artifacts._ARTIFACT_LOCK:
        docx_artifacts._ARTIFACTS = None
        docx_artifacts._PROVENANCE_INDEX = None
        docx_artifacts._LAST_CLEANUP_AT = 0.0
        docx_artifacts._initialize_docx_artifact_store()


@pytest.mark.asyncio
async def test_force_reconvert_pdf_uses_latest_non_empty_docx_artifact(monkeypatch):
    fake_manager = _FakeManager()
    observed = {}
    large_pdf_b64 = base64.b64encode(b"%PDF-1.4\n" + (b"x" * (4 * 1024 * 1024))).decode("ascii")
    valid_docx_b64 = _make_docx_b64("Documento valido")
    empty_docx_b64 = _make_docx_b64()

    async def _fake_build_pdf_context_async(*args, **_kwargs):
        observed["docx_b64"] = args[0]
        observed["docx_hash"] = args[1]
        observed["timeout_s"] = args[5]
        return (
            {
                "attempted": True,
                "duration_ms": 15,
                "converter_used": "word",
                "word_error": None,
                "docx_size_bytes": len(base64.b64decode(valid_docx_b64)),
                "pdf_size_bytes": len(base64.b64decode(large_pdf_b64)),
            },
            large_pdf_b64,
            "pdf-hash-large",
            False,
        )

    monkeypatch.setattr(notebook_execution, "manager", fake_manager)
    monkeypatch.setattr(notebook_execution, "build_pdf_context_async", _fake_build_pdf_context_async)
    monkeypatch.setattr(notebook_execution, "_pdf_cache_set", lambda *_args, **_kwargs: None)
    monkeypatch.setattr(notebook_execution, "NOTEBOOK_PDF_TIMEOUT_S", 321)

    with TemporaryDirectory() as tmp_dir:
        root_dir = Path(tmp_dir)
        with _patch_artifact_store(root_dir):
            _reset_artifact_store()
            source_path = "C:/workspace/demo.ipynb"
            kernel_id = "kernel-1"
            set_kernel_docx_source(kernel_id, source_path=source_path, source_kind="notebook")
            try:
                valid = docx_artifacts.store_docx_artifact(
                    valid_docx_b64,
                    filename="valid.docx",
                    docx_hash="hash-valid",
                    source_kind="notebook",
                    source_path=source_path,
                    kernel_id=kernel_id,
                    execution_id="exec-valid",
                )
                docx_artifacts.store_docx_artifact(
                    empty_docx_b64,
                    filename="empty.docx",
                    docx_hash="hash-empty",
                    source_kind="notebook",
                    source_path=source_path,
                    kernel_id=kernel_id,
                    execution_id="exec-empty",
                )

                await notebook_execution.handle_force_reconvert_pdf(
                    {"request_id": "req-reconvert", "kernel_id": kernel_id},
                    object(),
                )

                payload = fake_manager.messages[-1]
                assert observed["timeout_s"] == 321
                assert observed["docx_b64"] == valid_docx_b64
                assert observed["docx_hash"] == valid["docx_hash"]
                assert payload["type"] == "pdf_reconverted"
                assert payload["status"] == "ok"
                assert payload["pdf_file_b64"] is None
                assert payload["pdf_inline"] is False
                assert payload["pdf_file_token"]
                assert payload["pdf_ref"]
            finally:
                notebook_service.notebook_last_docx_b64.pop(kernel_id, None)
                notebook_service.notebook_docx_hash.pop(kernel_id, None)
                notebook_service.notebook_docx_source_path.pop(kernel_id, None)
                notebook_service.notebook_docx_source_kind.pop(kernel_id, None)


@pytest.mark.asyncio
async def test_force_reconvert_pdf_returns_no_docx_when_only_empty_artifacts_exist(monkeypatch):
    fake_manager = _FakeManager()
    observed = {}
    empty_docx_b64 = _make_docx_b64()

    async def _fake_build_pdf_context_async(*args, **_kwargs):
        observed["called"] = True
        return ({"attempted": True}, None, None, False)

    monkeypatch.setattr(notebook_execution, "manager", fake_manager)
    monkeypatch.setattr(notebook_execution, "build_pdf_context_async", _fake_build_pdf_context_async)
    monkeypatch.setattr(notebook_execution, "_pdf_cache_set", lambda *_args, **_kwargs: None)

    with TemporaryDirectory() as tmp_dir:
        root_dir = Path(tmp_dir)
        with _patch_artifact_store(root_dir):
            _reset_artifact_store()
            kernel_id = "kernel-empty"
            source_path = "C:/workspace/demo.ipynb"
            set_kernel_docx_source(kernel_id, source_path=source_path, source_kind="notebook")
            try:
                docx_artifacts.store_docx_artifact(
                    empty_docx_b64,
                    filename="empty.docx",
                    docx_hash="hash-empty",
                    source_kind="notebook",
                    source_path=source_path,
                    kernel_id=kernel_id,
                    execution_id="exec-empty",
                )

                await notebook_execution.handle_force_reconvert_pdf(
                    {"request_id": "req-empty", "kernel_id": kernel_id},
                    object(),
                )

                payload = fake_manager.messages[-1]
                assert payload["type"] == "pdf_reconverted"
                assert payload["status"] == "no_docx"
                assert "called" not in observed
            finally:
                notebook_service.notebook_last_docx_b64.pop(kernel_id, None)
                notebook_service.notebook_docx_hash.pop(kernel_id, None)
                notebook_service.notebook_docx_source_path.pop(kernel_id, None)
                notebook_service.notebook_docx_source_kind.pop(kernel_id, None)
