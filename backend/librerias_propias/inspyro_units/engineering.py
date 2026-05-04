# -*- coding: utf-8 -*-
"""
Advanced engineering helpers for dimensions and uncertainty.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from .normalization import normalize_unit_expression
from .registry import Q_

try:
    from pint.errors import DimensionalityError
except Exception:  # pragma: no cover - defensive fallback
    DimensionalityError = Exception  # type: ignore[assignment]


@dataclass(frozen=True)
class UncertainQuantity:
    value: float
    sigma: float
    unit: str

    def to(self, to_unit: str) -> "UncertainQuantity":
        to_expr = normalize_unit_expression(to_unit)
        if not to_expr:
            raise ValueError("Unidad destino inválida para incertidumbre")
        q_up = Q_(self.value + self.sigma, normalize_unit_expression(self.unit)).to(to_expr)
        q_down = Q_(self.value - self.sigma, normalize_unit_expression(self.unit)).to(to_expr)
        q_nominal = Q_(self.value, normalize_unit_expression(self.unit)).to(to_expr)
        converted_sigma = abs(float(q_up.magnitude) - float(q_down.magnitude)) / 2.0
        return UncertainQuantity(
            value=float(q_nominal.magnitude),
            sigma=converted_sigma,
            unit=to_expr,
        )


def quantity_with_uncertainty(value: float, sigma: float, unit: str) -> UncertainQuantity:
    return UncertainQuantity(value=float(value), sigma=abs(float(sigma)), unit=str(unit))


def assert_dimensionally_compatible(
    lhs: Any,
    rhs: Any,
    *,
    context: str = "",
) -> None:
    """
    Raise ValueError when lhs/rhs are not dimensionally compatible.
    """
    try:
        if hasattr(lhs, "to"):
            _ = lhs.to(rhs.units if hasattr(rhs, "units") else rhs)
            return
        if hasattr(rhs, "to"):
            _ = rhs.to(lhs.units if hasattr(lhs, "units") else lhs)
            return
        _ = Q_(1.0, normalize_unit_expression(str(lhs))).to(normalize_unit_expression(str(rhs)))
    except DimensionalityError as exc:
        prefix = f"{context}: " if context else ""
        raise ValueError(f"{prefix}incompatibilidad dimensional ({exc})") from exc


def assert_dimension(unit_or_quantity: Any, expected_unit: str, *, context: str = "") -> None:
    """
    Validate that `unit_or_quantity` can be converted to `expected_unit`.
    """
    try:
        target = normalize_unit_expression(expected_unit)
        if hasattr(unit_or_quantity, "to"):
            _ = unit_or_quantity.to(target)
        else:
            _ = Q_(1.0, normalize_unit_expression(str(unit_or_quantity))).to(target)
    except Exception as exc:
        prefix = f"{context}: " if context else ""
        raise ValueError(f"{prefix}unidad incompatible con '{expected_unit}' ({exc})") from exc

