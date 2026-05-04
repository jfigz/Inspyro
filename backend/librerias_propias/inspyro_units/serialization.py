# -*- coding: utf-8 -*-
"""
Serialization of pint.Quantity values into WS-friendly JSON payloads.
"""

from __future__ import annotations

from typing import Any

from .metadata import get_category_for_unit, get_metadata_for_unit
from .normalization import format_unit_for_style, get_unit_aliases, get_unit_identity


def _record_quantity_serialization_fallback() -> None:
    try:
        from app.services import runtime_metrics

        runtime_metrics.record_quantity_serialization_fallback()
    except Exception:
        # Serialization must not fail if metrics service is unavailable.
        pass


def _serialize_magnitude(magnitude: Any) -> Any:
    try:
        return float(magnitude)
    except (TypeError, ValueError):
        if hasattr(magnitude, "tolist"):
            try:
                return magnitude.tolist()
            except Exception:
                _record_quantity_serialization_fallback()
        return magnitude


def serialize_quantity(q) -> dict[str, Any]:
    """
    Serialize a ``pint.Quantity`` preserving legacy keys and adding canonical ones.
    """
    magnitude = _serialize_magnitude(q.magnitude)
    identity = get_unit_identity(q.units)

    try:
        unit_compact = f"{q.units:~P}"
    except Exception:
        unit_compact = str(q.units)
        _record_quantity_serialization_fallback()

    try:
        unit_full = f"{q.units:P}"
    except Exception:
        unit_full = str(q.units)
        _record_quantity_serialization_fallback()

    try:
        unit_latex = f"{q.units:~L}"
    except Exception:
        unit_latex = unit_compact
        _record_quantity_serialization_fallback()

    try:
        unit_html = f"{q.units:~H}"
    except Exception:
        unit_html = unit_compact
        _record_quantity_serialization_fallback()

    metadata = get_metadata_for_unit(q)
    aliases = get_unit_aliases(q.units)
    dimension = str(getattr(q, "dimensionality", identity.get("dimension") or ""))

    return {
        # Legacy payload keys (do not remove)
        "type": "Quantity",
        "magnitude": magnitude,
        "unit": unit_compact,
        "unit_full": unit_full,
        "unit_latex": unit_latex,
        "unit_html": unit_html,
        "dimensionality": dimension,
        "is_quantity": True,
        "repr": f"{q:~P}",
        "category": get_category_for_unit(q),
        "metadata": metadata if isinstance(metadata, dict) else None,
        # New canonical/traceability keys
        "unit_canonical": str(identity.get("canonical") or unit_compact),
        "unit_display": str(identity.get("display") or format_unit_for_style(q.units, style="engineering")),
        "unit_pint": str(identity.get("pint") or unit_full),
        "aliases": aliases,
    }


def is_quantity(obj) -> bool:
    return hasattr(obj, "magnitude") and hasattr(obj, "units")

