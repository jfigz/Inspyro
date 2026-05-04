# -*- coding: utf-8 -*-
"""Tests dedicados de serialización de Quantity."""

import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from librerias_propias.inspyro_units import MPa, kN, m, s
from librerias_propias.inspyro_units.serialization import serialize_quantity


def test_serialize_quantity_includes_full_payload() -> None:
    data = serialize_quantity(14.5 * kN)
    assert data["type"] == "Quantity"
    assert data["is_quantity"] is True
    assert data["unit"] == "kN"
    assert data["unit_full"]
    assert data["unit_latex"]
    assert data["unit_html"]
    assert data["dimensionality"]
    assert data["repr"]
    assert data["category"] == "Fuerza"
    assert isinstance(data.get("metadata"), dict)
    assert data["unit_canonical"] == "kN"
    assert data["unit_display"] == "kN"
    assert data["unit_pint"] in {"kilonewton", "kN"}
    assert isinstance(data.get("aliases"), list)


def test_serialize_quantity_compound_unit_payload() -> None:
    data = serialize_quantity(3.2 * m / s**2)
    assert data["type"] == "Quantity"
    assert data["is_quantity"] is True
    assert "m/s" in data["unit"]
    assert "repr" in data
    assert "category" in data
    assert "unit_canonical" in data
    assert "unit_display" in data


def test_serialize_quantity_preserves_pressure_category() -> None:
    data = serialize_quantity(25 * MPa)
    assert data["unit"] == "MPa"
    assert data["category"] == "Presión / Esfuerzo"
