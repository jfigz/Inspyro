# -*- coding: utf-8 -*-
"""
Canonical unit normalization and alias resolution for Inspyro units.

This module provides a single source of truth for:
- Human-friendly aliases (e.g. "°C", "m·N", "turn/min", "tonf")
- Stable canonical symbols (e.g. "degC", "Nm", "rpm", "tonf")
- Pint-compatible expressions for parsing/conversion
"""

from __future__ import annotations

import re
import unicodedata
from dataclasses import dataclass
from functools import lru_cache
from typing import Any, Literal

from .registry import Q_, get_registry

OutputStyle = Literal["engineering", "pint"]

_SUPERSCRIPT_TO_ASCII = {
    "\u2070": "0",
    "\u00b9": "1",
    "\u00b2": "2",
    "\u00b3": "3",
    "\u2074": "4",
    "\u2075": "5",
    "\u2076": "6",
    "\u2077": "7",
    "\u2078": "8",
    "\u2079": "9",
    "\u207b": "-",
}
_SUPERSCRIPT_RUN_RE = re.compile(r"([A-Za-z)\]])([\u2070\u00b9\u00b2\u00b3\u2074-\u2079\u207b]+)")
_UNIT_TOKEN_RE = re.compile(r"[A-Za-z\u00b0\u00b5\u03a9\u2126_][A-Za-z0-9\u00b0\u00b5\u03a9\u2126_]*")


@dataclass(frozen=True)
class UnitCatalogEntry:
    canonical: str
    display: str
    pint_expression: str
    category: str
    description: str
    aliases: tuple[str, ...] = ()
    pint_symbol: str = ""


def _entry(
    *,
    canonical: str,
    display: str,
    pint_expression: str,
    category: str,
    description: str,
    aliases: tuple[str, ...] = (),
    pint_symbol: str = "",
) -> UnitCatalogEntry:
    return UnitCatalogEntry(
        canonical=canonical,
        display=display,
        pint_expression=pint_expression,
        category=category,
        description=description,
        aliases=aliases,
        pint_symbol=pint_symbol or display,
    )


_CATALOG: tuple[UnitCatalogEntry, ...] = (
    # Length
    _entry(canonical="mm", display="mm", pint_expression="millimeter", category="Longitud", description="Milímetro"),
    _entry(canonical="cm", display="cm", pint_expression="centimeter", category="Longitud", description="Centímetro"),
    _entry(canonical="m", display="m", pint_expression="meter", category="Longitud", description="Metro"),
    _entry(canonical="km", display="km", pint_expression="kilometer", category="Longitud", description="Kilómetro"),
    _entry(canonical="in", display="in", pint_expression="inch", category="Longitud", description="Pulgada", aliases=("inch",)),
    _entry(canonical="ft", display="ft", pint_expression="foot", category="Longitud", description="Pie", aliases=("foot",)),
    # Mass
    _entry(canonical="g", display="g", pint_expression="gram", category="Masa", description="Gramo"),
    _entry(canonical="kg", display="kg", pint_expression="kilogram", category="Masa", description="Kilogramo"),
    _entry(
        canonical="t",
        display="t",
        pint_expression="metric_ton",
        category="Masa",
        description="Tonelada métrica",
        aliases=("ton", "metric_ton"),
    ),
    _entry(canonical="lb", display="lb", pint_expression="pound", category="Masa", description="Libra", aliases=("pound",)),
    # Time
    _entry(canonical="s", display="s", pint_expression="second", category="Tiempo", description="Segundo"),
    _entry(canonical="min", display="min", pint_expression="minute", category="Tiempo", description="Minuto", aliases=("minute",)),
    _entry(canonical="h", display="h", pint_expression="hour", category="Tiempo", description="Hora", aliases=("hr", "hour")),
    # Force
    _entry(canonical="N", display="N", pint_expression="newton", category="Fuerza", description="Newton"),
    _entry(canonical="kN", display="kN", pint_expression="kilonewton", category="Fuerza", description="Kilonewton"),
    _entry(canonical="MN", display="MN", pint_expression="meganewton", category="Fuerza", description="Meganewton"),
    _entry(
        canonical="lbf",
        display="lbf",
        pint_expression="force_pound",
        category="Fuerza",
        description="Libra-fuerza",
        aliases=("force_pound",),
    ),
    _entry(
        canonical="kgf",
        display="kgf",
        pint_expression="kilogram_force",
        category="Fuerza",
        description="Kilogramo-fuerza",
        aliases=("kilogram_force",),
    ),
    _entry(
        canonical="tonf",
        display="tf",
        pint_expression="metric_ton_force",
        category="Fuerza",
        description="Tonelada-fuerza métrica",
        aliases=("tf", "tonf", "metric_ton_force"),
        pint_symbol="tf",
    ),
    # Pressure / stress
    _entry(canonical="Pa", display="Pa", pint_expression="pascal", category="Presión / Esfuerzo", description="Pascal"),
    _entry(canonical="kPa", display="kPa", pint_expression="kilopascal", category="Presión / Esfuerzo", description="Kilopascal"),
    _entry(canonical="MPa", display="MPa", pint_expression="megapascal", category="Presión / Esfuerzo", description="Megapascal"),
    _entry(canonical="GPa", display="GPa", pint_expression="gigapascal", category="Presión / Esfuerzo", description="Gigapascal"),
    _entry(canonical="bar", display="bar", pint_expression="bar", category="Presión / Esfuerzo", description="Bar"),
    _entry(
        canonical="atm",
        display="atm",
        pint_expression="atmosphere",
        category="Presión / Esfuerzo",
        description="Atmósfera",
        aliases=("atmosphere",),
    ),
    _entry(canonical="psi", display="psi", pint_expression="psi", category="Presión / Esfuerzo", description="PSI"),
    # Energy / work
    _entry(canonical="J", display="J", pint_expression="joule", category="Energía / Trabajo", description="Joule"),
    _entry(canonical="kJ", display="kJ", pint_expression="kilojoule", category="Energía / Trabajo", description="Kilojoule"),
    _entry(canonical="MJ", display="MJ", pint_expression="megajoule", category="Energía / Trabajo", description="Megajoule"),
    _entry(canonical="cal", display="cal", pint_expression="calorie", category="Energía / Trabajo", description="Caloría"),
    _entry(canonical="kcal", display="kcal", pint_expression="kilocalorie", category="Energía / Trabajo", description="Kilocaloría"),
    _entry(canonical="Wh", display="Wh", pint_expression="watt_hour", category="Energía / Trabajo", description="Watt-hora"),
    _entry(canonical="kWh", display="kWh", pint_expression="kilowatt_hour", category="Energía / Trabajo", description="Kilowatt-hora"),
    # Power
    _entry(canonical="W", display="W", pint_expression="watt", category="Potencia", description="Watt"),
    _entry(canonical="kW", display="kW", pint_expression="kilowatt", category="Potencia", description="Kilowatt"),
    _entry(canonical="MW", display="MW", pint_expression="megawatt", category="Potencia", description="Megawatt"),
    _entry(canonical="hp", display="hp", pint_expression="horsepower", category="Potencia", description="Horsepower"),
    # Temperature
    _entry(canonical="K", display="K", pint_expression="kelvin", category="Temperatura", description="Kelvin"),
    _entry(
        canonical="degC",
        display="°C",
        pint_expression="degC",
        category="Temperatura",
        description="Grado Celsius",
        aliases=("degree_Celsius", "celsius", "°C"),
        pint_symbol="°C",
    ),
    _entry(
        canonical="degF",
        display="°F",
        pint_expression="degF",
        category="Temperatura",
        description="Grado Fahrenheit",
        aliases=("degree_Fahrenheit", "fahrenheit", "°F"),
        pint_symbol="°F",
    ),
    # Angle
    _entry(canonical="rad", display="rad", pint_expression="radian", category="Ángulo", description="Radián"),
    _entry(canonical="deg", display="°", pint_expression="degree", category="Ángulo", description="Grado", aliases=("degree", "°")),
    # Electricity / frequency
    _entry(canonical="A", display="A", pint_expression="ampere", category="Electricidad", description="Amperio"),
    _entry(canonical="V", display="V", pint_expression="volt", category="Electricidad", description="Voltio"),
    _entry(
        canonical="ohm",
        display="Ω",
        pint_expression="ohm",
        category="Electricidad",
        description="Ohmio",
        aliases=("Ω", "Ω"),
        pint_symbol="Ω",
    ),
    _entry(
        canonical="F",
        display="F",
        pint_expression="farad",
        category="Electricidad",
        description="Faradio",
        aliases=("F_", "farad"),
    ),
    _entry(canonical="Hz", display="Hz", pint_expression="hertz", category="Frecuencia", description="Hertz"),
    # Rotation / torque
    _entry(
        canonical="rpm",
        display="turn/min",
        pint_expression="revolution / minute",
        category="Frecuencia",
        description="Revoluciones por minuto",
        aliases=("rpm", "turn/min", "rev/min", "revolution/minute", "revolution/min"),
        pint_symbol="turn/min",
    ),
    _entry(
        canonical="Nm",
        display="N·m",
        pint_expression="newton * meter",
        category="Momento / Torque",
        description="Newton-metro",
        aliases=("Nm", "N*m", "m*N", "N·m", "m·N", "newton*meter", "meter*newton"),
        pint_symbol="m·N",
    ),
    _entry(
        canonical="kNm",
        display="kN·m",
        pint_expression="kilonewton * meter",
        category="Momento / Torque",
        description="Kilonewton-metro",
        aliases=("kNm", "kN*m", "m*kN", "kN·m", "m·kN", "kilonewton*meter", "meter*kilonewton"),
        pint_symbol="kN·m",
    ),
)


def _replace_superscripts(text: str) -> str:
    def _replace(match: re.Match[str]) -> str:
        base = match.group(1)
        superscript = match.group(2)
        exponent = "".join(_SUPERSCRIPT_TO_ASCII.get(ch, ch) for ch in superscript)
        return f"{base}**{exponent}"

    return _SUPERSCRIPT_RUN_RE.sub(_replace, text)


def _normalize_alias_key(raw_text: Any) -> str:
    # Use NFC to preserve superscript glyphs (², ³) before explicit expansion.
    text = unicodedata.normalize("NFC", str(raw_text or "")).strip()
    if not text:
        return ""

    # Common mojibake fallbacks seen on mixed-encoding payloads.
    text = (
        text.replace("Â°", "°")
        .replace("Â²", "²")
        .replace("Â³", "³")
        .replace("Î©", "Ω")
        .replace("Ã—", "×")
        .replace("âˆ’", "-")
        .replace("Â", "")
    )

    text = text.replace("\u2212", "-")
    text = text.replace("\u00d7", "*")
    text = text.replace("\u00b7", "*")
    text = text.replace("\u22c5", "*")
    text = text.replace("\u2219", "*")
    text = _replace_superscripts(text)
    text = text.replace("^", "**")
    text = re.sub(r"\s+", "", text)
    return text


@lru_cache(maxsize=1)
def _alias_index() -> tuple[dict[str, UnitCatalogEntry], list[tuple[str, str]]]:
    alias_to_entry: dict[str, UnitCatalogEntry] = {}
    expression_aliases: list[tuple[str, str]] = []

    for entry in _CATALOG:
        aliases = {
            entry.canonical,
            entry.display,
            entry.pint_expression,
            entry.pint_symbol,
            *entry.aliases,
        }
        for alias in aliases:
            normalized = _normalize_alias_key(alias)
            if not normalized:
                continue
            alias_to_entry[normalized] = entry
            if any(ch in normalized for ch in ("*", "/", "(", ")")):
                expression_aliases.append((normalized, entry.pint_expression))

    expression_aliases.sort(key=lambda item: len(item[0]), reverse=True)
    return alias_to_entry, expression_aliases


def _apply_expression_aliases(text: str) -> str:
    _, expression_aliases = _alias_index()
    normalized = text
    for alias, replacement in expression_aliases:
        pattern = re.compile(rf"(?<![A-Za-z0-9_]){re.escape(alias)}(?![A-Za-z0-9_])")
        normalized = pattern.sub(replacement, normalized)
    return normalized


def normalize_unit_expression(raw_unit: str) -> str:
    """
    Normalize a unit expression to a Pint-compatible expression.

    Examples:
    - "°C"      -> "degC"
    - "turn/min"-> "revolution / minute"
    - "m·N"     -> "newton * meter"
    - "s²"      -> "s**2"
    """
    normalized = _normalize_alias_key(raw_unit)
    if not normalized:
        return ""

    alias_to_entry, _ = _alias_index()
    direct_entry = alias_to_entry.get(normalized)
    if direct_entry is not None:
        return direct_entry.pint_expression

    normalized = _apply_expression_aliases(normalized)

    _TRAILING_EXP_RE = re.compile(r"^([A-Za-z]+)([234])$")

    def _token_replace(match: re.Match[str]) -> str:
        token = match.group(0)
        entry = alias_to_entry.get(_normalize_alias_key(token))
        if entry is not None:
            return entry.pint_expression
        # Handle engineering exponent notation: cm2 → cm**2, m3 → m**3
        m = _TRAILING_EXP_RE.match(token)
        if m:
            base, exp = m.groups()
            base_entry = alias_to_entry.get(_normalize_alias_key(base))
            if base_entry is not None:
                return f"{base_entry.pint_expression}**{exp}"
        return token

    return _UNIT_TOKEN_RE.sub(_token_replace, normalized)


def _safe_unit_format(unit: Any, fmt: str) -> str:
    if unit is None:
        return ""
    try:
        return format(unit, fmt)
    except Exception:
        return str(unit)


def _normalize_dimension_power(power: Any) -> Any:
    try:
        numeric = float(power)
    except Exception:
        return str(power)
    if numeric.is_integer():
        return int(numeric)
    return numeric


def _resolve_dimensionality(unit: Any, pint_expression: str | None = None) -> Any:
    if hasattr(unit, "dimensionality"):
        try:
            return unit.dimensionality
        except Exception:
            pass

    expr = pint_expression or normalize_unit_expression(str(unit or ""))
    if not expr:
        return None
    try:
        quantity = Q_(1.0, expr)
        return quantity.dimensionality
    except Exception:
        return None


def _dimension_signature(unit: Any, pint_expression: str | None = None) -> tuple[tuple[str, Any], ...]:
    dimensionality = _resolve_dimensionality(unit, pint_expression)
    if dimensionality is None:
        return ()
    try:
        items = dimensionality.items()
    except Exception:
        return ()
    return tuple(
        sorted(
            (str(base), _normalize_dimension_power(power))
            for base, power in items
        )
    )


def _format_dimension_signature(signature: tuple[tuple[str, Any], ...]) -> str:
    if not signature:
        return ""

    numerator: list[str] = []
    denominator: list[str] = []
    for base, power in signature:
        if power == 0:
            continue
        target = numerator if power > 0 else denominator
        abs_power = abs(power)
        if abs_power == 1:
            target.append(base)
        else:
            target.append(f"{base} ** {abs_power}")

    if not numerator and not denominator:
        return ""
    if not denominator:
        return " * ".join(numerator)
    if not numerator:
        return f"1 / {' * '.join(denominator)}"
    return f"{' * '.join(numerator)} / {' * '.join(denominator)}"


def _resolve_dimension(unit: Any, pint_expression: str | None = None) -> str:
    return _format_dimension_signature(_dimension_signature(unit, pint_expression))


def _generic_display(text: str) -> str:
    if not text:
        return ""
    normalized = text.replace("*", "·")
    normalized = normalized.replace("degC", "°C").replace("degF", "°F").replace("ohm", "Ω")
    normalized = normalized.replace("**2", "²").replace("**3", "³")
    return normalized


def _entry_from_unit(unit: Any) -> UnitCatalogEntry | None:
    alias_to_entry, _ = _alias_index()
    candidates: list[str] = []
    compact = _safe_unit_format(unit, "~P")
    full = _safe_unit_format(unit, "P")
    if compact:
        candidates.append(compact)
    if full:
        candidates.append(full)
    if isinstance(unit, str):
        candidates.append(unit)

    for candidate in candidates:
        entry = alias_to_entry.get(_normalize_alias_key(candidate))
        if entry is not None:
            return entry

    for candidate in candidates:
        normalized_expr = normalize_unit_expression(candidate)
        entry = alias_to_entry.get(_normalize_alias_key(normalized_expr))
        if entry is not None:
            return entry
    return None


def get_unit_identity(unit: Any) -> dict[str, Any]:
    """
    Resolve canonical/unit-display identity for a unit-like value.

    Accepts:
    - pint.Quantity
    - pint.Unit
    - string expressions
    """
    if hasattr(unit, "units"):
        unit = unit.units

    entry = _entry_from_unit(unit)
    compact = _safe_unit_format(unit, "~P")
    full = _safe_unit_format(unit, "P")

    if entry is not None:
        aliases = list(dict.fromkeys((entry.canonical, entry.display, entry.pint_symbol, *entry.aliases)))
        return {
            "canonical": entry.canonical,
            "display": entry.display,
            "pint": entry.pint_expression,
            "pint_symbol": entry.pint_symbol,
            "aliases": aliases,
            "category": entry.category,
            "description": entry.description,
            "dimension": _resolve_dimension(unit, entry.pint_expression),
        }

    pint_expr = normalize_unit_expression(full or compact or str(unit or ""))
    default_symbol = compact or str(unit or "")
    canonical = default_symbol or pint_expr
    display = _generic_display(default_symbol or canonical)
    aliases = list(dict.fromkeys(filter(None, (canonical, display, pint_expr))))

    return {
        "canonical": canonical,
        "display": display,
        "pint": pint_expr or canonical,
        "pint_symbol": default_symbol or display,
        "aliases": aliases,
        "category": "Unidad compuesta",
        "description": f"Unidad compuesta: {display or canonical}",
        "dimension": _resolve_dimension(unit, pint_expr),
    }


def format_unit_for_style(unit: Any, style: OutputStyle = "engineering") -> str:
    identity = get_unit_identity(unit)
    if style == "pint":
        return str(identity.get("canonical") or identity.get("pint") or "")
    return str(identity.get("display") or identity.get("canonical") or "")


def get_unit_aliases(unit: Any) -> list[str]:
    identity = get_unit_identity(unit)
    aliases = identity.get("aliases")
    if isinstance(aliases, list):
        return aliases
    return []


@lru_cache(maxsize=1)
def get_units_catalog() -> list[dict[str, Any]]:
    catalog: list[dict[str, Any]] = []
    for entry in _CATALOG:
        identity = get_unit_identity(entry.pint_expression)
        aliases = list(dict.fromkeys((entry.canonical, entry.display, entry.pint_symbol, *entry.aliases)))
        catalog.append(
            {
                "canonical": entry.canonical,
                "display": entry.display,
                "pint": entry.pint_expression,
                "pint_symbol": entry.pint_symbol,
                "category": entry.category,
                "description": entry.description,
                "aliases": aliases,
                "dimension": identity.get("dimension") or "",
            }
        )
    return catalog


def get_compatible_units(unit: Any) -> dict[str, Any]:
    identity = get_unit_identity(unit)
    source_dimension = str(identity.get("dimension") or "")
    source_signature = _dimension_signature(unit, str(identity.get("pint") or ""))
    source_canonical = str(identity.get("canonical") or "")

    compatible: list[dict[str, Any]] = []
    for entry in get_units_catalog():
        entry_signature = _dimension_signature(str(entry.get("pint") or ""), str(entry.get("pint") or ""))
        if entry_signature != source_signature:
            continue
        compatible.append(entry)

    compatible.sort(key=lambda item: (0 if item.get("canonical") == source_canonical else 1, str(item.get("canonical"))))
    return {
        "dimension": source_dimension,
        "source": identity,
        "compatible": compatible,
    }


def validate_unit_expression(raw_unit: str) -> tuple[bool, str]:
    normalized = normalize_unit_expression(raw_unit)
    if not normalized:
        return False, ""
    try:
        _ = get_registry().Unit(normalized)
        return True, normalized
    except Exception:
        return False, normalized
