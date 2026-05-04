# -*- coding: utf-8 -*-
"""Tests de Fase 2 para integración de unidades en kernel notebook."""

import os
import sys

import pytest


# Permite imports desde backend/
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from app.services.jupyter_kernel import jupyter_kernel_manager
from app.services.notebook_service import _build_notebook_instrumented_code


def test_units_preamble_injected_without_docx() -> None:
    code = _build_notebook_instrumented_code(
        source_code="F = 14.5*kN",
        cell_id="cell_units",
        cell_index=0,
        emit_docx=False,
    )
    assert "# --- UNITS PREAMBULO ---" in code
    assert "if not globals().get('__INSP_UNITS_READY__', False)" in code
    assert "from librerias_propias.inspyro_units import *" in code
    assert "import librerias_propias.inspyro_units as u" in code
    assert "__INSP_UNITS_IMPORTED_NAMES" in code
    assert "__INSP_UNITS_IMPORTED_IDS" in code
    assert "__INSP_UNITS_READY__" in code
    assert "# --- DOCX PREAMBULO NOTEBOOK ---" not in code


def test_units_preamble_precedes_docx_preamble() -> None:
    code = _build_notebook_instrumented_code(
        source_code="F = 14.5*kN",
        cell_id="cell_units_docx",
        cell_index=0,
        emit_docx=True,
    )
    assert "# --- UNITS PREAMBULO ---" in code
    assert "# --- DOCX PREAMBULO NOTEBOOK ---" in code
    assert code.index("# --- UNITS PREAMBULO ---") < code.index("# --- DOCX PREAMBULO NOTEBOOK ---")


@pytest.mark.integration
@pytest.mark.asyncio
async def test_quantity_variables_are_serialized_in_kernel() -> None:
    if jupyter_kernel_manager is None:
        pytest.skip("Kernel manager no disponible")

    try:
        kernel_id = await jupyter_kernel_manager.start_kernel("python3")
    except RuntimeError as exc:
        pytest.skip(f"Kernel no disponible para integración: {exc}")
    try:
        code = _build_notebook_instrumented_code(
            source_code="F = 14.5*kN\nsigma = F / (0.05*m**2)",
            cell_id="cell_units_runtime",
            cell_index=0,
            emit_docx=False,
        )
        _, _, variables, _ = await jupyter_kernel_manager.execute_cell(
            kernel_id,
            code,
            capture_variables=True,
            capture_docx=False,
        )

        assert "F" in variables
        assert isinstance(variables["F"], dict)
        assert variables["F"].get("type") == "Quantity"
        assert variables["F"].get("is_quantity") is True
        assert variables["F"].get("unit") == "kN"
        assert variables["F"].get("unit_canonical") == "kN"
        assert variables["F"].get("unit_display") in {"kN", "kN"}

        # Las constantes autoimportadas no deben contaminar el panel de variables.
        assert "kN" not in variables
        assert "MPa" not in variables
        assert "__serialize_quantity" not in variables
        assert "_ih" not in variables
        assert "_i" not in variables
        assert "_ip" not in variables
        assert "_np_to_native" not in variables
        assert "__INSP_NOTEBOOK_DOCX" not in variables
        assert "exit" not in variables
        assert "quit" not in variables
    finally:
        await jupyter_kernel_manager.shutdown_kernel(kernel_id)


@pytest.mark.integration
@pytest.mark.asyncio
async def test_user_override_of_imported_unit_name_is_not_filtered() -> None:
    if jupyter_kernel_manager is None:
        pytest.skip("Kernel manager no disponible")

    try:
        kernel_id = await jupyter_kernel_manager.start_kernel("python3")
    except RuntimeError as exc:
        pytest.skip(f"Kernel no disponible para integraciÃ³n: {exc}")
    try:
        code = _build_notebook_instrumented_code(
            source_code="kN = 1*kg\nF = 14.5*kN",
            cell_id="cell_units_override_runtime",
            cell_index=0,
            emit_docx=False,
        )
        _, _, variables, _ = await jupyter_kernel_manager.execute_cell(
            kernel_id,
            code,
            capture_variables=True,
            capture_docx=False,
        )

        assert "kN" in variables
        assert variables["kN"].get("type") == "Quantity"
        assert variables["kN"].get("is_quantity") is True
        assert variables["kN"].get("unit") == "kg"
        assert variables["kN"].get("unit_canonical") == "kg"
        assert "F" in variables
        assert variables["F"].get("type") == "Quantity"
        assert "_i" not in variables
        assert "_ip" not in variables
        assert "__INSP_NOTEBOOK_DOCX" not in variables
    finally:
        await jupyter_kernel_manager.shutdown_kernel(kernel_id)
