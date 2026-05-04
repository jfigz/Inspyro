# -*- coding: utf-8 -*-
"""
Compatibilidad de ``inspyro_units`` con NumPy y Pandas.

Pint ya tiene integración nativa con NumPy (ufuncs) y Pandas
(``pint-pandas``), pero este módulo expone helpers de alto nivel
para verificar disponibilidad y wrapping.
"""

import importlib

from .registry import _ureg, Q_


def is_quantity(obj) -> bool:
    """
    Verifica si un objeto es una Quantity de Pint (duck-typing).

    Más rápido que ``isinstance`` porque no requiere importar ``pint``.
    """
    return hasattr(obj, "magnitude") and hasattr(obj, "units")


def numpy_available() -> bool:
    """Retorna True si NumPy está instalado."""
    try:
        importlib.import_module("numpy")
        return True
    except ImportError:
        return False


def pandas_available() -> bool:
    """Retorna True si Pandas está instalado."""
    try:
        importlib.import_module("pandas")
        return True
    except ImportError:
        return False


def wrap_numpy_array(array, unit):
    """
    Envuelve un numpy array con una unidad Pint.

    Ejemplo::

        import numpy as np
        from inspyro_units.compat import wrap_numpy_array
        from inspyro_units import kN

        forces = wrap_numpy_array(np.array([10, 20, 30]), kN)
        # → array([10, 20, 30]) kN
    """
    return Q_(array, unit)


def quantity_to_numpy(q):
    """
    Extrae la magnitud de una Quantity como numpy array o escalar.

    Útil cuando se necesita pasar datos "desnudos" a funciones
    que no soportan Quantity.
    """
    return q.magnitude
