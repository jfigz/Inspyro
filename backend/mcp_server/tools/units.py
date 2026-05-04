"""MCP tools for engineering units."""

from __future__ import annotations

import logging
from typing import Optional, Union

from ..activity import mcp_activity_tool
from ..bridge import InspyroBridge

logger = logging.getLogger("inspyro.mcp.tools.units")


def _normalize_unit_token(value: object) -> str:
    return str(value or "").strip().casefold()


def _unit_matches(entry: dict, unit: str) -> bool:
    target = _normalize_unit_token(unit)
    aliases = entry.get("aliases", [])
    candidates = [
        entry.get("symbol"),
        entry.get("canonical"),
        entry.get("display"),
        entry.get("pint"),
        entry.get("pint_symbol"),
        *(aliases if isinstance(aliases, list) else []),
    ]
    return any(_normalize_unit_token(candidate) == target for candidate in candidates)


@mcp_activity_tool("units")
async def convert_units(
    magnitude: Union[float, list[float]],
    from_unit: str,
    to_unit: str,
) -> dict:
    """Cuando usar: convertir una magnitud entre dos unidades compatibles.

    Prerrequisitos: `from_unit` y `to_unit` deben ser tokens validos; si hay dudas, consulta antes
    `get_units_catalog` o `check_units_compatible`.
    Resultado: devuelve `converted_magnitude`, `repr`, `category` y `dimension`.
    Siguiente tool tipica: `check_units_compatible` o `get_units_catalog`.
    """
    bridge = InspyroBridge.get()
    result = await bridge.rest_post(
        "/api/units/convert",
        json_data={
            "magnitude": magnitude,
            "from_unit": from_unit,
            "to_unit": to_unit,
        },
    )
    return {
        "status": "ok",
        "converted_magnitude": result.get("converted_magnitude"),
        "repr": result.get("repr", ""),
        "category": result.get("category", ""),
        "dimension": result.get("dimension", ""),
    }


@mcp_activity_tool("units")
async def get_units_catalog(category: Optional[str] = None) -> dict:
    """Cuando usar: descubrir unidades, aliases y categorias soportadas por Inspyro.

    Prerrequisitos: ninguno.
    Resultado: devuelve el catalogo completo o filtrado por `category`.
    Siguiente tool tipica: `check_units_compatible` o `convert_units`.
    """
    bridge = InspyroBridge.get()
    result = await bridge.rest_get("/api/units/catalog")

    if category and isinstance(result, dict):
        units = result.get("units", result)
        if isinstance(units, list):
            units = [u for u in units if u.get("category", "").lower() == category.lower()]
            return {"status": "ok", "units": units, "filter": category}

    return {"status": "ok", "catalog": result}


@mcp_activity_tool("units")
async def check_units_compatible(
    unit_a: str,
    unit_b: str,
) -> dict:
    """Cuando usar: confirmar si dos unidades comparten la misma dimension fisica.

    Prerrequisitos: `unit_a` y `unit_b` deben ser tokens o aliases razonables del catalogo.
    Resultado: devuelve `compatible`, `dimension` y la lista de unidades compatibles con `unit_a`.
    Siguiente tool tipica: `convert_units` o `get_units_catalog`.
    """
    bridge = InspyroBridge.get()
    result = await bridge.rest_post(
        "/api/units/compatible",
        json_data={"unit": unit_a},
    )
    compatible_units = result.get("compatible", [])
    source_unit = result.get("canonical")
    is_compat = False
    if isinstance(source_unit, dict) and _unit_matches(source_unit, unit_b):
        is_compat = True
    elif isinstance(compatible_units, list):
        is_compat = any(_unit_matches(u, unit_b) for u in compatible_units)

    return {
        "status": "ok",
        "unit_a": unit_a,
        "unit_b": unit_b,
        "compatible": is_compat,
        "dimension": result.get("dimension", ""),
        "all_compatible_units": compatible_units,
    }
