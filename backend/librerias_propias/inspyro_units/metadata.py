# -*- coding: utf-8 -*-
"""
Unit metadata catalog for tooltips, graph enrichment and DOCX annotations.
"""

from __future__ import annotations

from typing import Any

from .normalization import get_unit_identity, get_units_catalog

_SI_BASE_CANONICAL = {
    "m",
    "kg",
    "s",
    "K",
    "A",
    "N",
    "Pa",
    "J",
    "W",
    "Hz",
    "rad",
    "ohm",
    "F",
}


def _build_unit_metadata() -> dict[str, dict[str, Any]]:
    metadata: dict[str, dict[str, Any]] = {}
    for entry in get_units_catalog():
        pint_key = str(entry.get("pint") or "").strip()
        if not pint_key:
            continue
        canonical = str(entry.get("canonical") or "").strip()
        meta = {
            "symbol": str(entry.get("display") or canonical),
            "category": str(entry.get("category") or "Otra"),
            "dimension": str(entry.get("dimension") or ""),
            "description": str(entry.get("description") or f"Unidad {canonical}"),
            "si_base": canonical in _SI_BASE_CANONICAL,
            "canonical": canonical,
            "display": str(entry.get("display") or canonical),
            "pint": pint_key,
            "pint_symbol": str(entry.get("pint_symbol") or ""),
            "aliases": list(entry.get("aliases") or []),
        }
        metadata[pint_key] = meta

    # Compatibility aliases requested by engineering workflows.
    if "metric_ton_force" in metadata:
        metadata["metric_ton_force"]["aliases"] = list(
            dict.fromkeys([*(metadata["metric_ton_force"].get("aliases") or []), "tf", "tonf"])
        )

    return metadata


UNIT_METADATA = _build_unit_metadata()

# Symbol / alias indices for fast lookup.
_SYMBOL_INDEX: dict[str, dict[str, Any]] = {}
_ALIAS_INDEX: dict[str, dict[str, Any]] = {}
for _meta in UNIT_METADATA.values():
    _symbol = str(_meta.get("symbol") or "").strip()
    if _symbol:
        _SYMBOL_INDEX[_symbol] = _meta
    _canonical = str(_meta.get("canonical") or "").strip()
    if _canonical:
        _ALIAS_INDEX[_canonical] = _meta
    _display = str(_meta.get("display") or "").strip()
    if _display:
        _ALIAS_INDEX[_display] = _meta
    _pint_symbol = str(_meta.get("pint_symbol") or "").strip()
    if _pint_symbol:
        _ALIAS_INDEX[_pint_symbol] = _meta
    for _alias in _meta.get("aliases") or []:
        _alias_key = str(_alias).strip()
        if _alias_key:
            _ALIAS_INDEX[_alias_key] = _meta


_DIMENSION_DEFAULT_CATEGORY = {
    "[length]": "Longitud",
    "[mass]": "Masa",
    "[time]": "Tiempo",
    "[temperature]": "Temperatura",
    "[current]": "Electricidad",
    "[mass] * [length] / [time] ** 2": "Fuerza",
    "[mass] / [length] / [time] ** 2": "Presión / Esfuerzo",
    "[mass] * [length] ** 2 / [time] ** 2": "Momento / Torque",
    "1 / [time]": "Frecuencia",
}


def _safe_unit_formats(unit: Any) -> list[str]:
    values: list[str] = []
    try:
        values.append(str(unit))
    except Exception:
        pass
    for fmt in ("P", "~P"):
        try:
            values.append(format(unit, fmt))
        except Exception:
            pass
    return [str(v).strip() for v in values if str(v).strip()]


def _enrich_with_identity(meta: dict[str, Any], identity: dict[str, Any]) -> dict[str, Any]:
    enriched = dict(meta)
    canonical = str(identity.get("canonical") or enriched.get("canonical") or "")
    display = str(identity.get("display") or enriched.get("display") or enriched.get("symbol") or canonical)
    pint_expr = str(identity.get("pint") or enriched.get("pint") or canonical)
    aliases = list(dict.fromkeys([*(enriched.get("aliases") or []), *(identity.get("aliases") or [])]))
    if canonical:
        aliases.append(canonical)
    if display:
        aliases.append(display)
    if pint_expr:
        aliases.append(pint_expr)
    aliases = list(dict.fromkeys(a for a in aliases if a))

    enriched["symbol"] = display or enriched.get("symbol")
    enriched["canonical"] = canonical or enriched.get("canonical")
    enriched["display"] = display
    enriched["pint"] = pint_expr
    enriched["pint_symbol"] = str(identity.get("pint_symbol") or enriched.get("pint_symbol") or "")
    enriched["aliases"] = aliases
    if not enriched.get("dimension"):
        enriched["dimension"] = str(identity.get("dimension") or "")
    if not enriched.get("category"):
        enriched["category"] = _DIMENSION_DEFAULT_CATEGORY.get(str(enriched.get("dimension") or ""), "Otra")
    return enriched


def _build_compound_metadata(identity: dict[str, Any]) -> dict[str, Any]:
    dimension = str(identity.get("dimension") or "")
    category = _DIMENSION_DEFAULT_CATEGORY.get(dimension, "Unidad compuesta")
    display = str(identity.get("display") or identity.get("canonical") or "")
    return {
        "symbol": display,
        "category": category,
        "dimension": dimension,
        "description": f"Unidad compuesta: {display}",
        "si_base": False,
        "canonical": str(identity.get("canonical") or ""),
        "display": display,
        "pint": str(identity.get("pint") or ""),
        "pint_symbol": str(identity.get("pint_symbol") or ""),
        "aliases": list(identity.get("aliases") or []),
    }


def get_metadata_for_unit(unit: Any) -> dict[str, Any] | None:
    """
    Resolve metadata for a pint.Unit, pint.Quantity or unit string.
    """
    if unit is None:
        return None
    if hasattr(unit, "units"):
        unit = unit.units

    identity = get_unit_identity(unit)
    candidates = []
    candidates.extend(_safe_unit_formats(unit))
    candidates.append(str(identity.get("pint") or ""))
    candidates.append(str(identity.get("canonical") or ""))
    candidates.append(str(identity.get("display") or ""))
    candidates.append(str(identity.get("pint_symbol") or ""))

    for key in candidates:
        key = str(key or "").strip()
        if not key:
            continue
        if key in UNIT_METADATA:
            return _enrich_with_identity(UNIT_METADATA[key], identity)
        if key in _SYMBOL_INDEX:
            return _enrich_with_identity(_SYMBOL_INDEX[key], identity)
        if key in _ALIAS_INDEX:
            return _enrich_with_identity(_ALIAS_INDEX[key], identity)

    return _build_compound_metadata(identity)


def get_category_for_unit(unit: Any) -> str:
    meta = get_metadata_for_unit(unit)
    if isinstance(meta, dict):
        category = meta.get("category")
        if isinstance(category, str) and category.strip():
            return category.strip()
    return "Otra"

