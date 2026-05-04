"""Manual Windows COM diagnostic for caption SEQ/REF fields through the PDF pipeline."""

from __future__ import annotations

import base64
import io
import os

import pytest

try:
    from pypdf import PdfReader
except Exception:  # pragma: no cover - manual diagnostic only
    PdfReader = None

from app.services.pdf_converter import convert_docx_with_diagnostics
from librerias_propias.docx_builder.api import build_doc
from librerias_propias.docx_builder.session import get_session, reset_session_cache


pytestmark = [pytest.mark.manual, pytest.mark.windows_com]


def _build_caption_docx_b64() -> str:
    namespace = {}
    with build_doc(order=1, namespace=namespace, block_id="caption-figure") as builder:
        builder.caption("Primera figura", label="fig:uno", number=True, caption_label="Figura")
    with build_doc(order=2, namespace=namespace, block_id="caption-reference") as builder:
        builder.reference("fig:uno")
    with build_doc(order=3, namespace=namespace, block_id="caption-table") as builder:
        builder.table([[1, 2]], headers=["A", "B"], caption="Tabla de prueba", label="tbl:uno")

    session = get_session(namespace)
    return session.export_docx_base64()


def test_word_caption_fields_manual() -> None:
    if os.getenv("INSPYRO_RUN_MANUAL_WORD_TESTS") != "1":
        pytest.skip("Manual diagnostic. Set INSPYRO_RUN_MANUAL_WORD_TESTS=1 to run.")
    if os.name != "nt":
        pytest.skip("Windows-only manual COM diagnostic.")
    if PdfReader is None:
        pytest.skip("pypdf no disponible para validar el texto del PDF.")

    reset_session_cache()
    try:
        result = convert_docx_with_diagnostics(_build_caption_docx_b64(), timeout_s=25)
    finally:
        reset_session_cache()

    assert result.get("pdf_b64"), result

    pdf_bytes = base64.b64decode(result["pdf_b64"])
    pdf_text = "\n".join(page.extract_text() or "" for page in PdfReader(io.BytesIO(pdf_bytes)).pages)

    assert "Figura 1. Primera figura" in pdf_text
    assert "\n1 \n" in pdf_text or "\n1\n" in pdf_text
    assert "Tabla 1. Tabla de prueba" in pdf_text
