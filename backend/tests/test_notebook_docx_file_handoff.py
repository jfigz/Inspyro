import base64
import json
import re
from pathlib import Path
import sys

import pytest

BACKEND_ROOT = Path(__file__).resolve().parents[1]
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

from app.services import notebook_service


def _extract_exchange_paths(code: str) -> dict[str, Path]:
    paths: dict[str, Path] = {}
    for key in ("__insp_docx_path", "__insp_provenance_path", "__insp_result_path"):
        match = re.search(rf"{key}\s*=\s*(['\"])(?P<value>.+?)\1", code)
        assert match is not None, f"missing {key}"
        paths[key] = Path(match.group("value"))
    return paths


@pytest.mark.asyncio
async def test_export_docx_via_file_handoff_writes_and_cleans_exchange_dir(monkeypatch):
    observed: dict[str, Path | int | float | None] = {}
    provenance_manifest = {
        "generated_at": "2026-04-18T00:00:00Z",
        "items": [
            {
                "provenance_id": "prov-1",
                "file_path": "C:/workspace/demo.py",
                "line": 12,
            }
        ],
    }

    async def _fake_execute_cell(_kernel_id, code, capture_variables=False, execution_timeout=None):
        observed["capture_variables"] = capture_variables
        observed["execution_timeout"] = execution_timeout
        paths = _extract_exchange_paths(code)
        observed["docx_path"] = paths["__insp_docx_path"]
        observed["provenance_path"] = paths["__insp_provenance_path"]
        observed["result_path"] = paths["__insp_result_path"]
        paths["__insp_docx_path"].write_bytes(b"docx-file-backed")
        paths["__insp_provenance_path"].write_text(
            json.dumps(provenance_manifest),
            encoding="utf-8",
        )
        paths["__insp_result_path"].write_text(
            json.dumps(
                {
                    "docx_bytes": len(b"docx-file-backed"),
                    "provenance_bytes": len(json.dumps(provenance_manifest).encode("utf-8")),
                    "transport": "file",
                    "error": None,
                }
            ),
            encoding="utf-8",
        )
        return [], 1, {}, {}

    monkeypatch.setattr(notebook_service.jupyter_kernel_manager, "execute_cell", _fake_execute_cell)

    result = await notebook_service._export_docx_via_file_handoff(
        "kernel-1",
        execution_timeout_s=321,
    )

    assert result["docx_b64"] == base64.b64encode(b"docx-file-backed").decode("ascii")
    assert result["docx_provenance_manifest"]["items"][0]["provenance_id"] == "prov-1"
    assert result["transport_error"] is None
    assert result["document_timing_ms"]["kernel_export_ms"] >= 0
    assert result["document_timing_ms"]["transport_read_ms"] >= 0
    assert result["document_timing_ms"]["transport_cleanup_ms"] >= 0
    assert result["document_timing_ms"]["docx_transfer_bytes"] == len(b"docx-file-backed")
    assert observed["capture_variables"] is False
    assert observed["execution_timeout"] == 321
    assert not Path(observed["docx_path"]).exists()
    assert not Path(observed["provenance_path"]).exists()
    assert not Path(observed["result_path"]).exists()
    assert not Path(observed["docx_path"]).parent.exists()
