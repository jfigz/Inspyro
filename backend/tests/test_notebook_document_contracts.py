import asyncio
import base64

import pytest

from app.services import notebook_service


class _FakeManager:
    def __init__(self) -> None:
        self.messages: list[dict] = []

    async def send_personal_message(self, message, _websocket):
        self.messages.append(message)


def _assert_source_fields(payload: dict, source_path: str, source_kind: str) -> None:
    assert payload["source_path"] == source_path
    assert payload["source_kind"] == source_kind


def _document_progress_messages(fake_manager: _FakeManager) -> list[dict]:
    return [
        payload
        for payload in fake_manager.messages
        if payload.get("type") == "notebook_progress_update"
        and payload.get("progress_scope") == "document"
    ]


@pytest.mark.asyncio
async def test_convert_pdf_background_includes_source_fields_on_success(monkeypatch, tmp_path):
    fake_manager = _FakeManager()
    source_path = str(tmp_path / "report.ipynb")
    pdf_b64 = base64.b64encode(b"%PDF-1.4\n%fake\n%%EOF\n").decode("ascii")

    async def _fake_build_pdf_context_async(*_args, **_kwargs):
        return (
            {
                "attempted": True,
                "duration_ms": 12,
                "stage_timings_ms": {"docx_to_pdf_ms": 12},
                "converter_used": "word",
                "word_error": None,
                "pdf_size_bytes": len(base64.b64decode(pdf_b64)),
            },
            pdf_b64,
            "pdf-hash-1",
            False,
        )

    monkeypatch.setattr(notebook_service, "manager", fake_manager)
    monkeypatch.setattr(notebook_service, "build_pdf_context_async", _fake_build_pdf_context_async)
    monkeypatch.setattr(
        notebook_service,
        "store_pdf_base64",
        lambda *_args, **_kwargs: {
            "token": "pdf-token-success",
            "filename": "inspyro_document.pdf",
            "size_bytes": len(base64.b64decode(pdf_b64)),
        },
    )

    await notebook_service._convert_pdf_background(
        kernel_id="kernel-success",
        docx_b64="ZG9jeA==",
        docx_hash="docx-hash-1",
        websocket=object(),
        execution_id="exec-success",
        docx_meta={
            "source_path": source_path,
            "source_kind": "notebook",
        },
    )

    progress_payloads = _document_progress_messages(fake_manager)
    assert [payload["progress_stage"] for payload in progress_payloads] == ["docx_ready", "pdf_convert"]
    assert all(payload["progress_scope"] == "document" for payload in progress_payloads)
    assert progress_payloads[-1]["shared_resource"]["kind"] == "pdf_converter"
    assert progress_payloads[-1]["shared_resource"]["status"] == "running"
    for payload in progress_payloads:
        _assert_source_fields(payload, source_path, "notebook")

    pdf_payload = fake_manager.messages[-1]
    assert pdf_payload["type"] == "notebook_pdf_ready"
    assert pdf_payload["pdf_hash"] == "pdf-hash-1"
    assert pdf_payload["pdf_file_b64"] is None
    assert pdf_payload["pdf_inline"] is False
    assert pdf_payload["pdf_ref"] == "/api/pdf/download?token=pdf-token-success"
    _assert_source_fields(pdf_payload, source_path, "notebook")


@pytest.mark.asyncio
async def test_convert_pdf_background_includes_source_fields_on_error(monkeypatch, tmp_path):
    fake_manager = _FakeManager()
    source_path = str(tmp_path / "report.ipynb")

    async def _failing_build_pdf_context_async(*_args, **_kwargs):
        raise RuntimeError("pdf boom")

    monkeypatch.setattr(notebook_service, "manager", fake_manager)
    monkeypatch.setattr(notebook_service, "build_pdf_context_async", _failing_build_pdf_context_async)

    await notebook_service._convert_pdf_background(
        kernel_id="kernel-failure",
        docx_b64="ZG9jeA==",
        docx_hash="docx-hash-2",
        websocket=object(),
        execution_id="exec-failure",
        docx_meta={
            "source_path": source_path,
            "source_kind": "notebook",
        },
    )

    progress_payloads = _document_progress_messages(fake_manager)
    assert [payload["progress_stage"] for payload in progress_payloads] == ["docx_ready", "pdf_convert", "pdf_convert"]
    assert progress_payloads[-1]["progress_status"] == "failed"
    for payload in progress_payloads:
        _assert_source_fields(payload, source_path, "notebook")

    pdf_payload = fake_manager.messages[-1]
    assert pdf_payload["type"] == "notebook_pdf_ready"
    assert pdf_payload["pdf_conversion_error"] == "pdf boom"
    _assert_source_fields(pdf_payload, source_path, "notebook")


@pytest.mark.asyncio
async def test_convert_pdf_background_reports_converter_queue_wait(monkeypatch, tmp_path):
    fake_manager = _FakeManager()
    source_path = str(tmp_path / "report.ipynb")
    pdf_b64 = base64.b64encode(b"%PDF-1.4\n%queued\n%%EOF\n").decode("ascii")

    async def _fake_build_pdf_context_async(
        *_args,
        on_queue_wait=None,
        **_kwargs,
    ):
        if on_queue_wait is not None:
            await on_queue_wait()
        return (
            {
                "attempted": True,
                "duration_ms": 18,
                "stage_timings_ms": {"pdf_queue_wait_ms": 7, "docx_to_pdf_ms": 18},
                "converter_used": "word",
                "word_error": None,
                "pdf_size_bytes": len(base64.b64decode(pdf_b64)),
            },
            pdf_b64,
            "pdf-hash-queued",
            False,
        )

    monkeypatch.setattr(notebook_service, "manager", fake_manager)
    monkeypatch.setattr(notebook_service, "build_pdf_context_async", _fake_build_pdf_context_async)
    monkeypatch.setattr(
        notebook_service,
        "store_pdf_base64",
        lambda *_args, **_kwargs: {
            "token": "pdf-token-queued",
            "filename": "inspyro_document.pdf",
            "size_bytes": len(base64.b64decode(pdf_b64)),
        },
    )

    await notebook_service._convert_pdf_background(
        kernel_id="kernel-queued",
        docx_b64="ZG9jeA==",
        docx_hash="docx-hash-queued",
        websocket=object(),
        execution_id="exec-queued",
        docx_meta={
            "source_path": source_path,
            "source_kind": "notebook",
        },
    )

    progress_payloads = _document_progress_messages(fake_manager)
    assert [payload["progress_stage"] for payload in progress_payloads] == ["docx_ready", "pdf_convert", "pdf_convert"]
    assert progress_payloads[2]["message"] == "Esperando turno del convertidor PDF..."
    assert progress_payloads[1]["shared_resource"]["status"] == "running"
    assert progress_payloads[2]["shared_resource"]["status"] == "waiting"
    for payload in progress_payloads:
        _assert_source_fields(payload, source_path, "notebook")

    pdf_payload = fake_manager.messages[-1]
    assert pdf_payload["type"] == "notebook_pdf_ready"
    assert pdf_payload["document_timing_ms"]["pdf_queue_wait_ms"] == 7
    _assert_source_fields(pdf_payload, source_path, "notebook")


@pytest.mark.asyncio
async def test_convert_pdf_background_keeps_three_parallel_kernels_independent_while_pdf_converter_serializes(monkeypatch, tmp_path):
    fake_manager = _FakeManager()
    pdf_b64 = base64.b64encode(b"%PDF-1.4\n%parallel\n%%EOF\n").decode("ascii")
    conversion_gate = asyncio.Lock()

    async def _fake_build_pdf_context_async(
        _docx_b64,
        _docx_hash,
        *_args,
        on_queue_wait=None,
        **_kwargs,
    ):
        if conversion_gate.locked() and on_queue_wait is not None:
            await on_queue_wait()
        async with conversion_gate:
            await asyncio.sleep(0.01)
            return (
                {
                    "attempted": True,
                    "duration_ms": 11,
                    "stage_timings_ms": {"docx_to_pdf_ms": 11},
                    "converter_used": "word",
                    "word_error": None,
                    "pdf_size_bytes": len(base64.b64decode(pdf_b64)),
                },
                pdf_b64,
                f"pdf-hash-{_docx_hash}",
                False,
            )

    monkeypatch.setattr(notebook_service, "manager", fake_manager)
    monkeypatch.setattr(notebook_service, "build_pdf_context_async", _fake_build_pdf_context_async)
    monkeypatch.setattr(
        notebook_service,
        "store_pdf_base64",
        lambda *_args, **_kwargs: {
            "token": "pdf-token-parallel",
            "filename": "inspyro_document.pdf",
            "size_bytes": len(base64.b64decode(pdf_b64)),
        },
    )

    async def _run_conversion(idx: int):
        source_path = str(tmp_path / f"parallel-{idx}.ipynb")
        await notebook_service._convert_pdf_background(
            kernel_id=f"kernel-{idx}",
            docx_b64="ZG9jeA==",
            docx_hash=f"docx-hash-{idx}",
            websocket=object(),
            execution_id=f"exec-{idx}",
            docx_meta={
                "source_path": source_path,
                "source_kind": "notebook",
            },
        )
        return source_path

    source_paths = await asyncio.gather(*[_run_conversion(idx) for idx in range(3)])

    pdf_ready_messages = [
        payload
        for payload in fake_manager.messages
        if payload.get("type") == "notebook_pdf_ready"
    ]
    assert len(pdf_ready_messages) == 3
    assert {payload["kernel_id"] for payload in pdf_ready_messages} == {"kernel-0", "kernel-1", "kernel-2"}
    assert {payload["source_path"] for payload in pdf_ready_messages} == set(source_paths)

    waiting_payloads = [
        payload
        for payload in _document_progress_messages(fake_manager)
        if payload.get("shared_resource", {}).get("kind") == "pdf_converter"
        and payload.get("shared_resource", {}).get("status") == "waiting"
    ]
    assert len(waiting_payloads) >= 2


@pytest.mark.asyncio
async def test_recover_docx_and_emit_updates_background_includes_source_fields_on_success(
    monkeypatch,
    tmp_path,
):
    fake_manager = _FakeManager()
    source_path = str(tmp_path / "report.ipynb")

    async def _fake_execute_docx_export(
        kernel_id,
        websocket,
        pdf_timeout_s=None,
        execution_id=None,
        generation=None,
        queued_at_monotonic=None,
    ):
        return {
            "docx_file_b64": None,
            "docx_file_token": "docx-token",
            "docx_download_url": "/api/docx/download?artifact_id=artifact-1",
            "docx_ref": "/api/docx/download?artifact_id=artifact-1",
            "docx_artifact_id": "artifact-1",
            "docx_file_name": "inspyro_document.docx",
            "docx_provenance_available": True,
            "docx_provenance_ref": "/api/docx/provenance?artifact_id=artifact-1",
            "docx_inline": False,
            "docx_store_error": None,
            "docx_size_bytes": 128,
            "docx_hash": "docx-hash",
            "docx_is_empty": False,
            "docx_warnings": None,
            "docx_error": None,
            "source_path": source_path,
            "source_kind": "notebook",
            "pdf_file_b64": None,
            "pdf_hash": "pdf-hash",
            "pdf_ref": "/api/pdf/download?token=pdf-1",
            "pdf_file_token": "pdf-1",
            "pdf_file_name": "inspyro_document.pdf",
            "pdf_inline": False,
            "pdf_store_error": None,
            "pdf_conversion_error": None,
            "pdf_attempted": True,
            "pdf_conversion_stdout": None,
            "pdf_conversion_stderr": None,
            "pdf_conversion_ms": 42,
            "pdf_size_bytes": 256,
            "converter_used": "cached",
            "word_error": None,
        }

    monkeypatch.setattr(notebook_service, "manager", fake_manager)
    monkeypatch.setattr(notebook_service, "_execute_docx_export", _fake_execute_docx_export)

    await notebook_service._recover_docx_and_emit_updates_background(
        kernel_id="kernel-recover-success",
        websocket=object(),
        execution_id="exec-recover-success",
        timeout_s=30,
        source_path=source_path,
        source_kind="notebook",
    )

    progress_payloads = _document_progress_messages(fake_manager)
    assert [payload["progress_stage"] for payload in progress_payloads] == ["docx_export", "docx_ready", "pdf_convert"]
    for payload in progress_payloads:
        _assert_source_fields(payload, source_path, "notebook")

    pdf_payload = next(payload for payload in fake_manager.messages if payload["type"] == "notebook_pdf_ready")
    assert pdf_payload["pdf_ref"] == "/api/pdf/download?token=pdf-1"
    _assert_source_fields(pdf_payload, source_path, "notebook")


@pytest.mark.asyncio
async def test_recover_docx_and_emit_updates_background_includes_source_fields_on_error(
    monkeypatch,
    tmp_path,
):
    fake_manager = _FakeManager()
    source_path = str(tmp_path / "report.ipynb")

    async def _failing_execute_docx_export(
        kernel_id,
        websocket,
        pdf_timeout_s=None,
        execution_id=None,
        generation=None,
        queued_at_monotonic=None,
    ):
        raise RuntimeError("recovery boom")

    monkeypatch.setattr(notebook_service, "manager", fake_manager)
    monkeypatch.setattr(notebook_service, "_execute_docx_export", _failing_execute_docx_export)

    await notebook_service._recover_docx_and_emit_updates_background(
        kernel_id="kernel-recover-error",
        websocket=object(),
        execution_id="exec-recover-error",
        timeout_s=30,
        source_path=source_path,
        source_kind="notebook",
    )

    progress_payloads = _document_progress_messages(fake_manager)
    assert [payload["progress_stage"] for payload in progress_payloads] == ["docx_export", "docx_export"]
    assert progress_payloads[-1]["progress_status"] == "failed"
    for payload in progress_payloads:
        _assert_source_fields(payload, source_path, "notebook")

    pdf_payload = fake_manager.messages[-1]
    assert pdf_payload["type"] == "notebook_pdf_ready"
    assert pdf_payload["pdf_conversion_error"] == "docx_recovery_failed: recovery boom"
    _assert_source_fields(pdf_payload, source_path, "notebook")


@pytest.mark.asyncio
async def test_execute_docx_export_prefers_link_first_payloads_even_for_small_artifacts(monkeypatch):
    fake_manager = _FakeManager()
    pdf_b64 = base64.b64encode(b"%PDF-1.4\n%tiny\n%%EOF\n").decode("ascii")

    async def _fake_export_docx_via_file_handoff(*_args, **_kwargs):
        return {
            "docx_b64": "ZG9jeA==",
            "docx_provenance_manifest": None,
            "transport_error": None,
            "document_timing_ms": {},
        }

    async def _fake_build_pdf_context_async(*_args, **_kwargs):
        return (
            {
                "attempted": True,
                "duration_ms": 12,
                "stage_timings_ms": {"docx_to_pdf_ms": 12},
                "converter_used": "word",
                "word_error": None,
                "pdf_size_bytes": len(base64.b64decode(pdf_b64)),
            },
            pdf_b64,
            "pdf-hash-inline-small",
            False,
        )

    monkeypatch.setattr(notebook_service, "manager", fake_manager)
    monkeypatch.setattr(notebook_service, "_export_docx_via_file_handoff", _fake_export_docx_via_file_handoff)
    monkeypatch.setattr(notebook_service, "sanitize_docx_b64_for_delivery", lambda payload: payload)
    monkeypatch.setattr(notebook_service, "_classify_docx_capture", lambda *_args, **_kwargs: False)
    monkeypatch.setattr(
        notebook_service,
        "compute_docx_semantic_hash",
        lambda *_args, **_kwargs: ("docx-hash-inline-small", None),
    )
    monkeypatch.setattr(
        notebook_service,
        "store_docx_artifact",
        lambda *_args, **_kwargs: {
            "artifact_id": "artifact-inline-small",
            "download_url": "/api/docx/download?artifact_id=artifact-inline-small",
            "filename": "inspyro_document.docx",
            "workspace_path": None,
            "workspace_relpath": None,
            "workspace_warning": None,
            "docx_provenance_available": False,
            "docx_provenance_ref": None,
            "artifact_timing_ms": {},
        },
    )
    monkeypatch.setattr(notebook_service, "build_pdf_context_async", _fake_build_pdf_context_async)
    monkeypatch.setattr(
        notebook_service,
        "store_pdf_base64",
        lambda *_args, **_kwargs: {
            "token": "pdf-token-inline-small",
            "filename": "inspyro_document.pdf",
            "size_bytes": len(base64.b64decode(pdf_b64)),
        },
    )

    result = await notebook_service._execute_docx_export(
        kernel_id="kernel-inline-small",
        websocket=object(),
        execution_id="exec-inline-small",
    )

    assert result["docx_file_b64"] is None
    assert result["docx_inline"] is False
    assert result["docx_ref"] == "/api/docx/download?artifact_id=artifact-inline-small"
    assert result["pdf_file_b64"] is None
    assert result["pdf_inline"] is False
    assert result["pdf_ref"] == "/api/pdf/download?token=pdf-token-inline-small"


@pytest.mark.asyncio
async def test_execute_docx_export_marks_pdf_converter_wait_as_shared_resource_waiting(monkeypatch, tmp_path):
    fake_manager = _FakeManager()
    source_path = str(tmp_path / "export-queue.ipynb")
    pdf_b64 = base64.b64encode(b"%PDF-1.4\n%export-queue\n%%EOF\n").decode("ascii")
    kernel_id = "kernel-export-queue"

    async def _fake_export_docx_via_file_handoff(*_args, **_kwargs):
        return {
            "docx_b64": "ZG9jeA==",
            "docx_provenance_manifest": None,
            "transport_error": None,
            "document_timing_ms": {},
        }

    async def _fake_build_pdf_context_async(
        *_args,
        on_queue_wait=None,
        **_kwargs,
    ):
        if on_queue_wait is not None:
            await on_queue_wait()
        return (
            {
                "attempted": True,
                "duration_ms": 14,
                "stage_timings_ms": {"pdf_queue_wait_ms": 5, "docx_to_pdf_ms": 14},
                "converter_used": "word",
                "word_error": None,
                "pdf_size_bytes": len(base64.b64decode(pdf_b64)),
            },
            pdf_b64,
            "pdf-hash-export-queue",
            False,
        )

    monkeypatch.setattr(notebook_service, "manager", fake_manager)
    monkeypatch.setattr(notebook_service, "_export_docx_via_file_handoff", _fake_export_docx_via_file_handoff)
    monkeypatch.setattr(notebook_service, "sanitize_docx_b64_for_delivery", lambda payload: payload)
    monkeypatch.setattr(notebook_service, "_classify_docx_capture", lambda *_args, **_kwargs: False)
    monkeypatch.setattr(
        notebook_service,
        "compute_docx_semantic_hash",
        lambda *_args, **_kwargs: ("docx-hash-export-queue", None),
    )
    monkeypatch.setattr(
        notebook_service,
        "store_docx_artifact",
        lambda *_args, **_kwargs: {
            "artifact_id": "artifact-export-queue",
            "download_url": "/api/docx/download?artifact_id=artifact-export-queue",
            "filename": "inspyro_document.docx",
            "workspace_path": None,
            "workspace_relpath": None,
            "workspace_warning": None,
            "docx_provenance_available": False,
            "docx_provenance_ref": None,
            "artifact_timing_ms": {},
        },
    )
    monkeypatch.setattr(notebook_service, "build_pdf_context_async", _fake_build_pdf_context_async)
    monkeypatch.setattr(
        notebook_service,
        "store_pdf_base64",
        lambda *_args, **_kwargs: {
            "token": "pdf-token-export-queue",
            "filename": "inspyro_document.pdf",
            "size_bytes": len(base64.b64decode(pdf_b64)),
        },
    )

    notebook_service.set_kernel_docx_source(
        kernel_id,
        source_path=source_path,
        source_kind="notebook",
    )
    try:
        result = await notebook_service._execute_docx_export(
            kernel_id=kernel_id,
            websocket=object(),
            execution_id="exec-export-queue",
        )
    finally:
        notebook_service.clear_kernel_runtime_state(kernel_id)

    progress_payloads = _document_progress_messages(fake_manager)
    waiting_payloads = [
        payload
        for payload in progress_payloads
        if payload.get("shared_resource", {}).get("kind") == "pdf_converter"
        and payload.get("shared_resource", {}).get("status") == "waiting"
    ]

    assert waiting_payloads
    assert waiting_payloads[-1]["message"] == "Esperando turno del convertidor PDF..."
    _assert_source_fields(waiting_payloads[-1], source_path, "notebook")
    assert result["pdf_ref"] == "/api/pdf/download?token=pdf-token-export-queue"
