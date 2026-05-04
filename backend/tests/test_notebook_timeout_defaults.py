from __future__ import annotations

from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.routers import notebook_execution
from app.services import jupyter_kernel, notebook_service, pdf_converter
from mcp_server.config import CELL_EXECUTION_TIMEOUT
from mcp_server.tools import analysis as mcp_analysis, documents as mcp_documents, notebook as mcp_notebook


def test_notebook_timeout_defaults_are_600_seconds():
    assert notebook_execution.NOTEBOOK_EXECUTION_TIMEOUT_S == 600.0
    assert notebook_execution.NOTEBOOK_DOCUMENT_MUTATION_TIMEOUT_S == 600.0
    assert jupyter_kernel.KERNEL_EXECUTION_TIMEOUT == 600.0
    assert pdf_converter.PDF_CONVERT_TIMEOUT_S == 600
    assert notebook_service.NOTEBOOK_PDF_TIMEOUT_S == 600
    assert CELL_EXECUTION_TIMEOUT == 600
    assert mcp_analysis._LONG_RUNNING_ANALYSIS_TIMEOUT_S == 600
    assert mcp_documents._LONG_DOCUMENT_TIMEOUT_S == 600
    assert mcp_documents._ARTIFACT_WAIT_TIMEOUT_S == 600.0
    assert mcp_notebook._BATCH_ARTIFACT_WAIT_TIMEOUT_S == 600.0


def test_notebook_execution_timeout_resolution_uses_backend_default_when_missing_or_invalid():
    assert notebook_execution._resolve_execution_timeout_s({}) == 600.0
    assert notebook_execution._resolve_execution_timeout_s({"execution_timeout_s": 42.5}) == 42.5
    assert notebook_execution._resolve_execution_timeout_s({"execution_timeout_s": 0}) == 600.0
    assert notebook_execution._resolve_execution_timeout_s({"execution_timeout_s": "oops"}) == 600.0
