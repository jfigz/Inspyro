# -*- coding: utf-8 -*-
"""Tests for canonical normalization and advanced engineering helpers."""

import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from librerias_propias.inspyro_units.engineering import (
    assert_dimension,
    assert_dimensionally_compatible,
    quantity_with_uncertainty,
)
from librerias_propias.inspyro_units.normalization import (
    get_compatible_units,
    get_unit_identity,
    normalize_unit_expression,
)


def test_normalize_unit_expression_aliases() -> None:
    assert normalize_unit_expression("tonf") == "metric_ton_force"
    assert normalize_unit_expression("°C") == "degC"
    assert normalize_unit_expression("Ω") == "ohm"
    assert normalize_unit_expression("turn/min") == "revolution / minute"
    assert normalize_unit_expression("m·N") == "newton * meter"


def test_get_unit_identity_torque_alias() -> None:
    identity = get_unit_identity("m·N")
    assert identity["canonical"] == "Nm"
    assert identity["display"] == "N·m"
    assert identity["category"] == "Momento / Torque"


def test_get_compatible_units_by_dimension() -> None:
    payload = get_compatible_units("kN")
    compatible = payload["compatible"]
    canonical = {entry["canonical"] for entry in compatible}
    assert "N" in canonical
    assert "lbf" in canonical
    assert "s" not in canonical
    assert payload["dimension"]


def test_uncertainty_conversion_roundtrip() -> None:
    uq = quantity_with_uncertainty(100.0, 2.0, "kN")
    converted = uq.to("N")
    assert abs(converted.value - 100000.0) < 1e-6
    assert abs(converted.sigma - 2000.0) < 1e-6


def test_dimension_assert_helpers() -> None:
    assert_dimensionally_compatible("kN", "N")
    assert_dimension("kN", "N")
