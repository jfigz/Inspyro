# -*- coding: utf-8 -*-
"""
Registry singleton para inspyro_units.

Configura un UnitRegistry de Pint compartido por toda la aplicación.
Thread-safe en Pint >= 0.20.
"""

import pint

# ── Singleton para toda la aplicación ──────────────────────────────
_ureg = pint.UnitRegistry()
try:
    # Pint >= 0.24
    _ureg.formatter.default_format = "~P"
except AttributeError:
    # Pint < 0.24 fallback
    _ureg.default_format = "~P"  # formato compacto/pretty por defecto

Q_ = _ureg.Quantity


def get_registry() -> pint.UnitRegistry:
    """Retorna el UnitRegistry singleton de Inspyro."""
    return _ureg
