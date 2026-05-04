# -*- coding: utf-8 -*-
"""Tests adicionales de integración kernel para variables con unidades."""

from __future__ import annotations

import json
import os
import sys

import pytest

# Permite imports desde backend/
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from app.services.jupyter_kernel import _extract_ue_text, jupyter_kernel_manager
from app.services.notebook_service import _build_notebook_instrumented_code


def test_units_preamble_keeps_quantity_serializer_available() -> None:
    code = _build_notebook_instrumented_code(
        source_code="F = 14.5*kN",
        cell_id="cell_units_kernel",
        cell_index=0,
        emit_docx=False,
    )
    assert "from librerias_propias.inspyro_units.serialization import serialize_quantity as __serialize_quantity" in code
    assert "__INSP_UNITS_IMPORTED_NAMES" in code
    assert "__INSP_UNITS_IMPORTED_IDS" in code
    assert "__INSP_UNITS_READY__" in code
    assert "import librerias_propias.inspyro_units as u" in code


def test_extract_ue_text_decodes_quoted_payload_with_backslashes() -> None:
    entry = {
        "status": "ok",
        "data": {
            "text/plain": (
                "'{\"repr\": \"[\\\\\\'\\\\\\']\", "
                "\"path\": \"C:\\\\\\\\CalcPyro\\\\\\\\P1\", "
                "\"ok\": true}'"
            )
        },
    }
    value = _extract_ue_text(entry)
    assert value is not None
    payload = json.loads(value)
    assert payload["repr"] == "['']"
    assert payload["path"] == "C:\\CalcPyro\\P1"


@pytest.mark.integration
@pytest.mark.asyncio
async def test_units_kernel_runtime_flow_captures_quantity_payload() -> None:
    if jupyter_kernel_manager is None:
        pytest.skip("Kernel manager no disponible")

    try:
        kernel_id = await jupyter_kernel_manager.start_kernel("python3")
    except RuntimeError as exc:
        pytest.skip(f"Kernel no disponible para integración: {exc}")

    try:
        source = _build_notebook_instrumented_code(
            source_code="F = 14.5*kN\nsigma = 25*MPa",
            cell_id="cell_units_kernel_runtime",
            cell_index=0,
            emit_docx=False,
        )
        _, _, variables, _ = await jupyter_kernel_manager.execute_cell(
            kernel_id,
            source,
            capture_variables=True,
            capture_docx=False,
        )
        assert "F" in variables
        assert variables["F"].get("type") == "Quantity"
        assert variables["F"].get("unit") == "kN"
        assert variables["F"].get("unit_canonical") == "kN"
        assert "sigma" in variables
        assert variables["sigma"].get("type") == "Quantity"
        assert variables["sigma"].get("unit") == "MPa"
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
async def test_kernel_capture_avoids_repr_traps_and_skips_interop_like_objects() -> None:
    if jupyter_kernel_manager is None:
        pytest.skip("Kernel manager no disponible")

    try:
        kernel_id = await jupyter_kernel_manager.start_kernel("python3")
    except RuntimeError as exc:
        pytest.skip(f"Kernel no disponible para integración: {exc}")

    try:
        source = """
class BombRepr:
    def __repr__(self):
        raise RuntimeError("repr should not run")

class FakeDispatch:
    pass

FakeDispatch.__module__ = "comtypes.client.dynamic"

problem = BombRepr()
problem_list = [problem]
problem_tuple = (problem,)
problem_dict = {"problem": problem}
ret_link = (problem, "L1")
SapModel = FakeDispatch()
stable = 42
"""
        _, _, variables, extras = await jupyter_kernel_manager.execute_cell(
            kernel_id,
            source,
            capture_variables=True,
            capture_docx=False,
        )

        assert variables["stable"]["repr"] == "42"
        assert variables["problem"]["repr"] == "<__main__.BombRepr>"
        assert variables["problem_list"]["repr"] == "[...]"
        assert variables["problem_tuple"]["repr"] == "(...)"
        assert variables["problem_dict"]["repr"] == "{...}"
        assert "ret_link" not in variables
        assert "SapModel" not in variables
        assert extras.get("variables_snapshot_degraded") is not True
    finally:
        await jupyter_kernel_manager.shutdown_kernel(kernel_id)
