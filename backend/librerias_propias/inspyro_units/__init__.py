# -*- coding: utf-8 -*-
"""
inspyro_units — Sistema de unidades de ingeniería para Inspyro.

Envuelve `Pint <https://pint.readthedocs.io/>`_ con una API ergonómica
que permite escribir expresiones naturales de ingeniería::

    F = 14.5*kN
    sigma = 25*MPa
    v = 3.2*m/s**2
    rho = 7850*kg/m**3
"""

__version__ = "0.1.0"

# ── Registry y constructor de Quantity ────────────────────────
from .registry import Q_, get_registry  # noqa: F401

# ── Todas las constantes de unidades ──────────────────────────
from .constants import (  # noqa: F401
    # Longitud
    mm, cm, m, km, inch, ft,
    # Masa
    g, kg, ton, lb,
    # Tiempo
    s, minute, hr,
    # Fuerza
    N, kN, MN, lbf, kgf, tonf,
    # Presión / Esfuerzo
    Pa, kPa, MPa, GPa, bar, atm, psi,
    # Energía / Trabajo
    J, kJ, MJ, cal, kcal, Wh, kWh,
    # Potencia
    W, kW, MW, hp,
    # Temperatura
    K, degC, degF,
    # Ángulo
    rad, deg,
    # Momento / Torque
    Nm, kNm,
    # Electricidad
    A, V, ohm, F_, Hz,
    # Frecuencia
    rpm,
)

# ── Serialización ─────────────────────────────────────────────
from .serialization import serialize_quantity  # noqa: F401

from .normalization import (  # noqa: F401
    format_unit_for_style,
    get_compatible_units,
    get_unit_aliases,
    get_unit_identity,
    get_units_catalog,
    normalize_unit_expression,
    validate_unit_expression,
)

# ── Formateo ──────────────────────────────────────────────────
from .formatting import (  # noqa: F401
    format_quantity_latex,
    format_quantity_unicode,
    format_quantity_html,
    format_quantity_docx,
)

# ── Metadata ──────────────────────────────────────────────────
from .metadata import (  # noqa: F401
    UNIT_METADATA,
    get_metadata_for_unit,
    get_category_for_unit,
)

# ── Compat helpers ────────────────────────────────────────────
from .compat import is_quantity  # noqa: F401

from .engineering import (  # noqa: F401
    UncertainQuantity,
    assert_dimension,
    assert_dimensionally_compatible,
    quantity_with_uncertainty,
)
