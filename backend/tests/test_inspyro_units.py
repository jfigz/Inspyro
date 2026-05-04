# -*- coding: utf-8 -*-
"""
Tests unitarios para la librería inspyro_units (Fase 1).

Cubre: aritmética dimensional, conversiones, errores, serialización,
metadata, formateo y temperaturas.
"""

import sys
import os
import pytest

# Asegurar que backend/ está en el path para imports de librerias_propias
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import pint
from librerias_propias.inspyro_units import *
from librerias_propias.inspyro_units.serialization import serialize_quantity
from librerias_propias.inspyro_units.metadata import UNIT_METADATA, get_metadata_for_unit, get_category_for_unit
from librerias_propias.inspyro_units.formatting import (
    format_quantity_latex,
    format_quantity_unicode,
    format_quantity_html,
    format_quantity_docx,
)
from librerias_propias.inspyro_units.compat import is_quantity as compat_is_quantity


# ═══════════════════════════════════════════════════════════════
# ARITMÉTICA BÁSICA
# ═══════════════════════════════════════════════════════════════

class TestBasicQuantity:
    def test_basic_quantity_creation(self):
        """Crear una Quantity multiplicando un número por una unidad."""
        F = 14.5 * kN
        assert abs(F.magnitude - 14.5) < 1e-10
        assert "kilonewton" in f"{F.units:P}" or str(F.units) == "kN"

    def test_unit_arithmetic_sum(self):
        """Suma compatible: kN + N → resultado en kN."""
        F1 = 10 * kN
        F2 = 5000 * N
        R = F1 + F2
        assert abs(R.to(kN).magnitude - 15.0) < 1e-10

    def test_incompatible_units_error(self):
        """Suma incompatible lanza DimensionalityError."""
        with pytest.raises(pint.DimensionalityError):
            _ = 10 * kN + 5 * kg

    def test_unit_multiplication(self):
        """Multiplicación de unidades produce unidad compuesta."""
        area = 2 * m * 3 * m
        assert abs(area.magnitude - 6.0) < 1e-10
        assert area.check("[length] ** 2")

    def test_unit_division(self):
        """División produce unidad derivada."""
        v = 100 * m / (10 * s)
        assert abs(v.magnitude - 10.0) < 1e-10


# ═══════════════════════════════════════════════════════════════
# CONVERSIONES
# ═══════════════════════════════════════════════════════════════

class TestConversions:
    def test_mpa_to_psi(self):
        """Conversión de MPa a psi."""
        p = 1 * MPa
        p_psi = p.to(psi)
        assert abs(p_psi.magnitude - 145.038) < 0.01

    def test_kn_to_n(self):
        """Conversión de kN a N."""
        F = 5 * kN
        F_n = F.to(N)
        assert abs(F_n.magnitude - 5000.0) < 1e-10

    def test_km_to_m(self):
        """Conversión de km a m."""
        d = 2.5 * km
        d_m = d.to(m)
        assert abs(d_m.magnitude - 2500.0) < 1e-10

    def test_kg_to_lb(self):
        """Conversión de kg a libras."""
        mass = 1 * kg
        mass_lb = mass.to(lb)
        assert abs(mass_lb.magnitude - 2.2046) < 0.001

    def test_hp_to_kw(self):
        """Conversión de HP a kW."""
        power = 1 * hp
        power_kw = power.to(kW)
        assert abs(power_kw.magnitude - 0.7457) < 0.001


# ═══════════════════════════════════════════════════════════════
# UNIDADES COMPUESTAS
# ═══════════════════════════════════════════════════════════════

class TestCompoundUnits:
    def test_velocity(self):
        """Velocidad se forma naturalmente con m/s."""
        v = 120 * km / hr
        assert v.check("[length] / [time]")

    def test_density(self):
        """Densidad se forma con kg/m³."""
        rho = 2500 * kg / m**3
        assert rho.check("[mass] / [length] ** 3")

    def test_moment_of_inertia(self):
        """Momento de inercia se forma con cm⁴."""
        I = 1500 * cm**4
        assert I.check("[length] ** 4")

    def test_stress_from_force_and_area(self):
        """Esfuerzo = Fuerza / Área → produce unidad de presión."""
        F = 100 * kN
        A_val = 0.01 * m**2
        sigma = F / A_val
        sigma_mpa = sigma.to(MPa)
        assert abs(sigma_mpa.magnitude - 10.0) < 1e-6

    def test_torque_constant(self):
        """Constante de torque Nm funciona correctamente."""
        torque = 50 * Nm
        assert torque.check("[length] ** 2 * [mass] / [time] ** 2")

    def test_rpm_unit(self):
        """RPM se forma correctamente."""
        speed = 1500 * rpm
        assert speed.check("1 / [time]")


# ═══════════════════════════════════════════════════════════════
# TEMPERATURA
# ═══════════════════════════════════════════════════════════════

class TestTemperature:
    def test_celsius_to_kelvin(self):
        """Temperaturas con offset se manejan correctamente."""
        T = Q_(25, degC)
        T_K = T.to(K)
        assert abs(T_K.magnitude - 298.15) < 0.01

    def test_fahrenheit_to_celsius(self):
        """Conversión Fahrenheit a Celsius."""
        T = Q_(212, degF)
        T_C = T.to(degC)
        assert abs(T_C.magnitude - 100.0) < 0.01

    def test_kelvin_to_celsius(self):
        """Conversión Kelvin a Celsius."""
        T = Q_(0, K)
        T_C = T.to(degC)
        assert abs(T_C.magnitude - (-273.15)) < 0.01


# ═══════════════════════════════════════════════════════════════
# SERIALIZACIÓN
# ═══════════════════════════════════════════════════════════════

class TestSerialization:
    def test_serialize_basic(self):
        """Serialización básica de una Quantity."""
        F = 14.5 * kN
        data = serialize_quantity(F)
        assert data["type"] == "Quantity"
        assert data["is_quantity"] is True
        assert abs(data["magnitude"] - 14.5) < 1e-10
        assert data["unit"] == "kN"
        assert data["category"] == "Fuerza"

    def test_serialize_has_all_fields(self):
        """Serialización incluye todos los campos requeridos."""
        p = 25 * MPa
        data = serialize_quantity(p)
        required_fields = [
            "type", "magnitude", "unit", "unit_full",
            "unit_latex", "unit_html", "dimensionality",
            "is_quantity", "repr", "category", "metadata",
        ]
        for field in required_fields:
            assert field in data, f"Missing field: {field}"

    def test_serialize_repr(self):
        """El repr es legible."""
        F = 14.5 * kN
        data = serialize_quantity(F)
        assert "14.5" in data["repr"]
        assert "kN" in data["repr"]

    def test_serialize_compound_unit(self):
        """Serialización de unidad compuesta."""
        v = 5 * m / s
        data = serialize_quantity(v)
        assert data["type"] == "Quantity"
        assert data["is_quantity"] is True


# ═══════════════════════════════════════════════════════════════
# METADATA
# ═══════════════════════════════════════════════════════════════

class TestMetadata:
    def test_metadata_catalog_has_entries(self):
        """El catálogo tiene entradas para unidades principales."""
        assert "kilonewton" in UNIT_METADATA
        assert "megapascal" in UNIT_METADATA
        assert "meter" in UNIT_METADATA
        assert "kilogram" in UNIT_METADATA

    def test_metadata_structure(self):
        """Cada entrada tiene los campos mínimos requeridos."""
        required_keys = {"symbol", "category", "dimension", "description", "si_base"}
        for name, meta in UNIT_METADATA.items():
            for key in required_keys:
                assert key in meta, f"Unit '{name}' missing key '{key}'"

    def test_get_metadata_by_quantity(self):
        """get_metadata_for_unit funciona con una Quantity."""
        F = 14.5 * kN
        meta = get_metadata_for_unit(F)
        assert meta is not None
        assert meta["category"] == "Fuerza"

    def test_get_category(self):
        """get_category_for_unit retorna la categoría correcta."""
        assert get_category_for_unit(kN) == "Fuerza"
        assert get_category_for_unit(MPa) == "Presión / Esfuerzo"
        assert get_category_for_unit(m) == "Longitud"
        assert get_category_for_unit(kg) == "Masa"


# ═══════════════════════════════════════════════════════════════
# FORMATEO
# ═══════════════════════════════════════════════════════════════

class TestFormatting:
    def test_format_latex(self):
        """Formato LaTeX contiene la magnitud y la unidad."""
        F = 14.5 * kN
        latex = format_quantity_latex(F)
        assert "14.5" in latex
        assert "kN" in latex

    def test_format_unicode(self):
        """Formato Unicode es legible."""
        F = 14.5 * kN
        text = format_quantity_unicode(F)
        assert "14.5" in text
        assert "kN" in text

    def test_format_html(self):
        """Formato HTML contiene magnitud y unidad."""
        F = 14.5 * kN
        html = format_quantity_html(F)
        assert "14.5" in html

    def test_format_docx_structure(self):
        """Formato DOCX retorna estructura correcta."""
        F = 14.5 * kN
        result = format_quantity_docx(F)
        assert "magnitude" in result
        assert "unit_runs" in result
        assert abs(result["magnitude"] - 14.5) < 1e-10
        assert len(result["unit_runs"]) > 0

    def test_format_docx_italic(self):
        """Runs DOCX son cursiva."""
        F = 14.5 * kN
        result = format_quantity_docx(F)
        for run in result["unit_runs"]:
            assert run.get("italic") is True

    def test_format_docx_superscript(self):
        """Exponentes se convierten a superíndice en DOCX."""
        area = 5 * m**2
        result = format_quantity_docx(area)
        has_superscript = any(r.get("superscript") for r in result["unit_runs"])
        assert has_superscript, "Should have superscript run for m²"


# ═══════════════════════════════════════════════════════════════
# COMPAT HELPERS
# ═══════════════════════════════════════════════════════════════

class TestCompat:
    def test_is_quantity_true(self):
        """is_quantity retorna True para Quantity."""
        F = 14.5 * kN
        assert compat_is_quantity(F) is True

    def test_is_quantity_false(self):
        """is_quantity retorna False para tipos normales."""
        assert compat_is_quantity(42) is False
        assert compat_is_quantity("hello") is False
        assert compat_is_quantity([1, 2, 3]) is False

    def test_numpy_wrapping(self):
        """Wrap y unwrap de numpy arrays con unidades."""
        try:
            import numpy as np
            from librerias_propias.inspyro_units.compat import wrap_numpy_array, quantity_to_numpy
            arr = np.array([10, 20, 30])
            q = wrap_numpy_array(arr, kN)
            assert compat_is_quantity(q)
            result = quantity_to_numpy(q)
            assert list(result) == [10, 20, 30]
        except ImportError:
            pytest.skip("NumPy not available")
