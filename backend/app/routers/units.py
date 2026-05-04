"""REST router for engineering units conversion and catalog/compatibility lookup."""

from __future__ import annotations

import math
from typing import Any, Literal

from fastapi import APIRouter, Body
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field, ValidationError

from app.services import runtime_metrics

try:
    from librerias_propias.inspyro_units import Q_
    from librerias_propias.inspyro_units.metadata import get_category_for_unit, get_metadata_for_unit
    from librerias_propias.inspyro_units.normalization import (
        get_compatible_units,
        get_unit_identity,
        get_units_catalog,
        normalize_unit_expression,
        validate_unit_expression,
    )
    _UNITS_AVAILABLE = True
except Exception:  # pragma: no cover - pint not installed
    _UNITS_AVAILABLE = False

try:
    from pint.errors import DimensionalityError, UndefinedUnitError
except Exception:  # pragma: no cover - defensive fallback
    DimensionalityError = Exception  # type: ignore[assignment]
    UndefinedUnitError = Exception  # type: ignore[assignment]


router = APIRouter(prefix="/api/units", tags=["units"])
_DEFAULT_UNCERTAINTY_SIG_FIGURES = 12


def _units_unavailable_response() -> JSONResponse:
    return JSONResponse(
        status_code=503,
        content={"error_code": "units_unavailable", "message": "El subsistema de unidades no está disponible (pint no instalado)"},
    )


class UnitConvertOptions(BaseModel):
    significant_figures: int | None = Field(default=None, ge=1, le=12)
    output_style: Literal["engineering", "pint"] = "engineering"
    strict_temperature: bool = False


class UnitConvertRequest(BaseModel):
    magnitude: Any
    from_unit: str
    to_unit: str
    options: UnitConvertOptions | None = None
    uncertainty: Any | None = None


class UnitCompatibleRequest(BaseModel):
    unit: str | None = None
    from_unit: str | None = None
    output_style: Literal["engineering", "pint"] = "engineering"


def _error_payload(
    *,
    status_code: int,
    error_code: str,
    message: str,
    details: Any = None,
) -> JSONResponse:
    runtime_metrics.record_unit_conversion_failure(error_code)
    payload: dict[str, Any] = {
        "error_code": error_code,
        "message": message,
    }
    if details is not None:
        payload["details"] = details
    return JSONResponse(status_code=status_code, content=payload)


def _model_validate(model_cls, raw_payload: Any):
    try:
        return model_cls.model_validate(raw_payload)
    except AttributeError:
        return model_cls.parse_obj(raw_payload)  # type: ignore[attr-defined]


def _validate_payload(raw_payload: Any) -> UnitConvertRequest | None:
    if not isinstance(raw_payload, dict):
        return None
    return _model_validate(UnitConvertRequest, raw_payload)


def _validate_compatible_payload(raw_payload: Any) -> UnitCompatibleRequest | None:
    if not isinstance(raw_payload, dict):
        return None
    return _model_validate(UnitCompatibleRequest, raw_payload)


def _is_number(value: Any) -> bool:
    return isinstance(value, (int, float)) and not isinstance(value, bool)


def _ensure_finite(value: float, *, field_name: str) -> float:
    numeric = float(value)
    if not math.isfinite(numeric):
        raise ValueError(f"{field_name} contiene números no finitos")
    return numeric


def _normalize_magnitude_structure(value: Any, *, field_name: str = "magnitude") -> tuple[Any, str]:
    if _is_number(value):
        return _ensure_finite(float(value), field_name=field_name), "scalar"

    if isinstance(value, (list, tuple)):
        seq = list(value)
        if not seq:
            return [], "vector"
        if all(_is_number(item) for item in seq):
            return [_ensure_finite(float(item), field_name=field_name) for item in seq], "vector"
        if all(isinstance(item, (list, tuple)) for item in seq):
            matrix: list[list[float]] = []
            expected_len: int | None = None
            for row_idx, row in enumerate(seq):
                row_list = list(row)
                if expected_len is None:
                    expected_len = len(row_list)
                if expected_len != len(row_list):
                    raise ValueError(f"{field_name} matrix must be rectangular (row {row_idx})")
                if not all(_is_number(cell) for cell in row_list):
                    raise ValueError(f"{field_name} matrix contains non-numeric values")
                matrix.append(
                    [_ensure_finite(float(cell), field_name=f"{field_name}[{row_idx}]") for cell in row_list]
                )
            return matrix, "matrix"
        raise ValueError(f"{field_name} must be number | number[] | number[][]")

    raise ValueError(f"{field_name} must be number | number[] | number[][]")


def _same_shape(lhs: Any, rhs: Any) -> bool:
    if isinstance(lhs, list) and isinstance(rhs, list):
        if len(lhs) != len(rhs):
            return False
        return all(_same_shape(l_item, r_item) for l_item, r_item in zip(lhs, rhs))
    return not isinstance(lhs, list) and not isinstance(rhs, list)


def _normalize_uncertainty(
    uncertainty: Any | None,
    *,
    magnitude: Any,
    magnitude_kind: str,
) -> Any | None:
    if uncertainty is None:
        return None
    normalized, kind = _normalize_magnitude_structure(uncertainty, field_name="uncertainty")
    if kind != magnitude_kind:
        raise ValueError("uncertainty debe tener la misma estructura que magnitude")
    if not _same_shape(normalized, magnitude):
        raise ValueError("uncertainty debe tener exactamente la misma forma que magnitude")

    def _non_negative(node: Any) -> Any:
        if isinstance(node, list):
            return [_non_negative(item) for item in node]
        sigma = float(node)
        if sigma < 0:
            raise ValueError("uncertainty no puede ser negativa")
        return sigma

    return _non_negative(normalized)


def _format_scalar(value: float, significant_figures: int | None) -> str:
    if significant_figures is None:
        return f"{value:g}"
    return format(value, f".{significant_figures}g")


def _format_magnitude(value: Any, significant_figures: int | None) -> str:
    if isinstance(value, list):
        return "[" + ", ".join(_format_magnitude(item, significant_figures) for item in value) + "]"
    return _format_scalar(float(value), significant_figures)


def _convert_scalar(value: float, from_expr: str, to_expr: str) -> float:
    quantity = Q_(value, from_expr)
    converted = quantity.to(to_expr)
    return float(converted.magnitude)


def _convert_structure(value: Any, from_expr: str, to_expr: str) -> Any:
    if isinstance(value, list):
        return [_convert_structure(item, from_expr, to_expr) for item in value]
    return _convert_scalar(float(value), from_expr, to_expr)


def _convert_uncertainty_structure(value: Any, sigma: Any, from_expr: str, to_expr: str) -> Any:
    if isinstance(value, list) and isinstance(sigma, list):
        return [
            _convert_uncertainty_structure(v_item, s_item, from_expr, to_expr)
            for v_item, s_item in zip(value, sigma)
        ]
    value_f = float(value)
    sigma_f = abs(float(sigma))
    q_up = Q_(value_f + sigma_f, from_expr).to(to_expr)
    q_down = Q_(value_f - sigma_f, from_expr).to(to_expr)
    return abs(float(q_up.magnitude) - float(q_down.magnitude)) / 2.0


def _round_to_significant_figures(value: float, significant_figures: int) -> float:
    numeric = float(value)
    if not math.isfinite(numeric):
        return numeric
    if numeric == 0.0:
        return 0.0
    try:
        rounded = float(format(numeric, f".{significant_figures}g"))
    except Exception:
        # Defensive fallback for rare formatter edge cases.
        magnitude_order = math.floor(math.log10(abs(numeric)))
        decimals = significant_figures - magnitude_order - 1
        rounded = round(numeric, decimals)
    if rounded == 0.0:
        return 0.0
    return rounded


def _normalize_numeric_structure(value: Any, significant_figures: int) -> Any:
    if isinstance(value, list):
        return [_normalize_numeric_structure(item, significant_figures) for item in value]
    if isinstance(value, tuple):
        return [_normalize_numeric_structure(item, significant_figures) for item in value]
    return _round_to_significant_figures(float(value), significant_figures)


def _is_offset_temperature(unit_expr: str) -> bool:
    canonical = str(get_unit_identity(unit_expr).get("canonical") or "")
    return canonical in {"degC", "degF"}


def _normalize_style_unit(unit_obj: Any, style: Literal["engineering", "pint"]) -> str:
    identity = get_unit_identity(unit_obj)
    if style == "pint":
        return str(identity.get("canonical") or identity.get("pint") or identity.get("display") or "")
    return str(identity.get("display") or identity.get("canonical") or "")


@router.post("/convert")
async def convert_units(raw_payload: Any = Body(...)):
    if not _UNITS_AVAILABLE:
        return _units_unavailable_response()
    try:
        payload = _validate_payload(raw_payload)
    except ValidationError as exc:
        return _error_payload(
            status_code=422,
            error_code="invalid_payload",
            message="Payload inválido para conversión de unidades",
            details=exc.errors(),
        )
    except Exception as exc:
        return _error_payload(
            status_code=422,
            error_code="invalid_payload",
            message="Payload inválido para conversión de unidades",
            details={"reason": str(exc)},
        )

    if payload is None:
        return _error_payload(
            status_code=422,
            error_code="invalid_payload",
            message="Payload inválido para conversión de unidades",
            details={
                "expected": {
                    "magnitude": "number | number[] | number[][]",
                    "from_unit": "string",
                    "to_unit": "string",
                    "options": {
                        "significant_figures": "number?",
                        "output_style": "engineering|pint",
                        "strict_temperature": "boolean?",
                    },
                }
            },
        )

    options = payload.options or UnitConvertOptions()

    try:
        magnitude, magnitude_kind = _normalize_magnitude_structure(payload.magnitude)
        uncertainty = _normalize_uncertainty(
            payload.uncertainty,
            magnitude=magnitude,
            magnitude_kind=magnitude_kind,
        )
    except ValueError as exc:
        return _error_payload(
            status_code=422,
            error_code="invalid_magnitude",
            message=str(exc),
        )

    from_input = str(payload.from_unit or "").strip()
    to_input = str(payload.to_unit or "").strip()
    if not from_input or not to_input:
        return _error_payload(
            status_code=422,
            error_code="invalid_unit",
            message="from_unit y to_unit son requeridos",
            details={"from_unit": payload.from_unit, "to_unit": payload.to_unit},
        )

    from_expr = normalize_unit_expression(from_input)
    to_expr = normalize_unit_expression(to_input)
    if not from_expr or not to_expr:
        runtime_metrics.record_unit_normalization_failure()
        return _error_payload(
            status_code=400,
            error_code="unknown_unit",
            message="Unidad no reconocida",
            details={"from_unit": from_input, "to_unit": to_input},
        )

    valid_from, _ = validate_unit_expression(from_expr)
    valid_to, _ = validate_unit_expression(to_expr)
    if not valid_from or not valid_to:
        runtime_metrics.record_unit_normalization_failure()
        return _error_payload(
            status_code=400,
            error_code="unknown_unit",
            message="Unidad no reconocida",
            details={"from_unit": from_input, "to_unit": to_input},
        )

    if options.strict_temperature and magnitude_kind != "scalar" and (
        _is_offset_temperature(from_expr) or _is_offset_temperature(to_expr)
    ):
        return _error_payload(
            status_code=422,
            error_code="invalid_temperature_mode",
            message="strict_temperature requiere magnitud escalar para unidades con offset",
            details={"from_unit": from_input, "to_unit": to_input},
        )

    try:
        converted_magnitude = _convert_structure(magnitude, from_expr, to_expr)
        if uncertainty is not None:
            converted_uncertainty = _convert_uncertainty_structure(magnitude, uncertainty, from_expr, to_expr)
            uncertainty_sig_figures = options.significant_figures or _DEFAULT_UNCERTAINTY_SIG_FIGURES
            converted_uncertainty = _normalize_numeric_structure(converted_uncertainty, uncertainty_sig_figures)
        else:
            converted_uncertainty = None
        converted_unit_quantity = Q_(1.0, from_expr).to(to_expr)
    except UndefinedUnitError as exc:
        return _error_payload(
            status_code=400,
            error_code="unknown_unit",
            message=f"Unidad no reconocida: {exc}",
            details={"from_unit": from_input, "to_unit": to_input},
        )
    except DimensionalityError as exc:
        return _error_payload(
            status_code=400,
            error_code="incompatible_units",
            message="Las unidades no son dimensionalmente compatibles",
            details={"from_unit": from_input, "to_unit": to_input, "reason": str(exc)},
        )
    except Exception as exc:
        return _error_payload(
            status_code=400,
            error_code="conversion_failed",
            message="No se pudo convertir la unidad",
            details={"from_unit": from_input, "to_unit": to_input, "reason": str(exc)},
        )

    unit_identity_from = get_unit_identity(from_expr)
    unit_identity_to = get_unit_identity(converted_unit_quantity.units)
    unit_text = _normalize_style_unit(converted_unit_quantity.units, options.output_style)
    repr_text = f"{_format_magnitude(converted_magnitude, options.significant_figures)} {unit_text}".strip()
    metadata = get_metadata_for_unit(converted_unit_quantity)
    dimension = str(unit_identity_to.get("dimension") or getattr(converted_unit_quantity, "dimensionality", ""))

    response: dict[str, Any] = {
        # Legacy keys
        "magnitude": magnitude,
        "from_unit": from_input,
        "to_unit": to_input,
        "converted_magnitude": converted_magnitude,
        "repr": repr_text,
        "category": get_category_for_unit(converted_unit_quantity),
        "metadata": metadata if isinstance(metadata, dict) else None,
        # New keys
        "dimension": dimension,
        "canonical": {
            "from_unit": str(unit_identity_from.get("canonical") or from_expr),
            "to_unit": str(unit_identity_to.get("canonical") or to_expr),
            "input_from": from_input,
            "input_to": to_input,
        },
    }
    if converted_uncertainty is not None:
        response["converted_uncertainty"] = converted_uncertainty
    return response


@router.get("/catalog")
async def get_units_catalog_endpoint():
    if not _UNITS_AVAILABLE:
        return _units_unavailable_response()
    catalog = get_units_catalog()
    by_dimension: dict[str, list[str]] = {}
    for entry in catalog:
        dimension = str(entry.get("dimension") or "")
        by_dimension.setdefault(dimension, []).append(str(entry.get("canonical") or ""))

    for dimension in by_dimension:
        by_dimension[dimension] = sorted(set(by_dimension[dimension]))

    return {
        "count": len(catalog),
        "units": catalog,
        "by_dimension": by_dimension,
    }


@router.post("/compatible")
async def get_compatible_units_endpoint(raw_payload: Any = Body(...)):
    if not _UNITS_AVAILABLE:
        return _units_unavailable_response()
    try:
        payload = _validate_compatible_payload(raw_payload)
    except ValidationError as exc:
        return _error_payload(
            status_code=422,
            error_code="invalid_payload",
            message="Payload inválido para compatibilidad de unidades",
            details=exc.errors(),
        )
    except Exception as exc:
        return _error_payload(
            status_code=422,
            error_code="invalid_payload",
            message="Payload inválido para compatibilidad de unidades",
            details={"reason": str(exc)},
        )

    if payload is None:
        return _error_payload(
            status_code=422,
            error_code="invalid_payload",
            message="Payload inválido para compatibilidad de unidades",
            details={"expected": {"unit": "string", "output_style": "engineering|pint"}},
        )

    raw_unit = str(payload.unit or payload.from_unit or "").strip()
    if not raw_unit:
        return _error_payload(
            status_code=422,
            error_code="invalid_unit",
            message="unit o from_unit es requerido",
        )

    normalized = normalize_unit_expression(raw_unit)

    # Validate directly with pint (avoid double-normalization bug)
    if normalized:
        valid, _ = validate_unit_expression(raw_unit)
    else:
        valid = False

    if not valid:
        # Fallback: try pint directly with the normalized expression
        try:
            from librerias_propias.inspyro_units.registry import get_registry
            get_registry().Unit(normalized or raw_unit)
            valid = True
        except Exception:
            pass

    if not valid:
        import logging
        logging.getLogger(__name__).warning(
            "[units/compatible] Unidad no reconocida: raw=%r normalized=%r",
            raw_unit, normalized,
        )
        runtime_metrics.record_unit_normalization_failure()
        return _error_payload(
            status_code=400,
            error_code="unknown_unit",
            message="Unidad no reconocida",
            details={"unit": raw_unit, "normalized": normalized},
        )

    compat_payload = get_compatible_units(normalized)
    source = compat_payload.get("source") or {}
    source_canonical = str(source.get("canonical") or "")
    compatible_entries = [
        item
        for item in (compat_payload.get("compatible") or [])
        if str(item.get("canonical") or "") != source_canonical
    ]

    compatible_units: list[str] = []
    for item in compatible_entries:
        if payload.output_style == "pint":
            compatible_units.append(str(item.get("canonical") or item.get("pint") or ""))
        else:
            compatible_units.append(str(item.get("display") or item.get("canonical") or ""))

    return {
        "unit": raw_unit,
        "dimension": str(compat_payload.get("dimension") or ""),
        "canonical": source,
        "compatible_units": compatible_units,
        "compatible": compatible_entries,
    }
