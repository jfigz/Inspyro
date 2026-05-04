# -*- coding: utf-8 -*-
"""Tests DOCX para renderizado de unidades de ingeniería."""

import os
import sys

import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from librerias_propias.docx_builder.api import build_doc
import librerias_propias.docx_builder.builder as builder_module
from librerias_propias.inspyro_units import MPa, kN, kg, m, s
from librerias_propias.inspyro_units.formatting import build_docx_unit_runs, format_quantity_docx


@pytest.mark.parametrize(
    ("unit_text", "expected_superscript_digit"),
    [
        ("m/s²", "2"),
        ("kg/m³", "3"),
        ("m/s^2", "2"),
        ("m/s**2", "2"),
    ],
)
def test_build_docx_unit_runs_supports_superscripts(unit_text: str, expected_superscript_digit: str) -> None:
    runs = build_docx_unit_runs(unit_text)
    assert runs
    assert any(run.get("italic") is True for run in runs)
    assert any(run.get("superscript") is True and run.get("text") == expected_superscript_digit for run in runs)


@pytest.mark.parametrize(
    "quantity",
    [
        14.5 * kN,
        25 * MPa,
        3.2 * m / s**2,
        7850 * kg / m**3,
    ],
)
def test_format_quantity_docx_includes_unit_runs(quantity) -> None:
    payload = format_quantity_docx(quantity)
    assert "magnitude" in payload
    assert "unit_runs" in payload
    assert payload["unit_runs"]
    assert any(run.get("italic") is True for run in payload["unit_runs"])


def test_docbuilder_text_applies_mixed_runs_for_quantities() -> None:
    with build_doc(order=1, namespace={}) as doc:
        doc.text("Aceleracion 3.2 m/s², densidad 7850 kg/m³ y esfuerzo 25 MPa.")
        paragraph = doc.document.paragraphs[-1]

    assert paragraph.runs
    assert any(run.text == "\u2009" for run in paragraph.runs), "Debe insertar thin-space entre magnitud y unidad"
    assert any((run.text or "").startswith("m/s") and run.italic for run in paragraph.runs)
    assert any((run.text or "").startswith("kg/m") and run.italic for run in paragraph.runs)
    assert any((run.text or "").startswith("MPa") and run.italic for run in paragraph.runs)
    assert any((run.text or "") in {"2", "3"} and bool(run.font.superscript) for run in paragraph.runs)


def test_docbuilder_text_fallback_to_plain_text_when_unit_parser_fails(monkeypatch: pytest.MonkeyPatch) -> None:
    def _raise(_: str):
        raise RuntimeError("boom")

    monkeypatch.setattr(builder_module, "build_docx_unit_runs", _raise)
    input_text = "La fuerza es 14.5 kN y el esfuerzo es 25 MPa."

    with build_doc(order=2, namespace={}) as doc:
        doc.text(input_text)
        paragraph = doc.document.paragraphs[-1]

    assert paragraph.text == input_text


def test_docbuilder_text_avoids_false_positive_unit_tokens() -> None:
    input_text = "Revision 2026 informe final y codigo 404 estado."
    with build_doc(order=3, namespace={}) as doc:
        doc.text(input_text)
        paragraph = doc.document.paragraphs[-1]

    assert paragraph.text == input_text
    assert not any(run.text == "\u2009" for run in paragraph.runs)
