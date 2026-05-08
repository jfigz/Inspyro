"""Canonical notebook cell-kind helpers.

Inspyro exposes a logical ``docx`` cell kind, but persisted ``.ipynb`` files
must remain valid Jupyter notebooks. The persisted representation is therefore
``cell_type="code"`` plus ``metadata.inspyro.cell_kind="docx"``.
"""

from __future__ import annotations

import copy
from typing import Any, Callable

LOGICAL_CELL_TYPES = {"code", "markdown", "docx", "raw"}
PERSISTED_CELL_TYPES = {"code", "markdown", "raw"}
RUNNABLE_LOGICAL_CELL_TYPES = {"code", "docx"}
DOCX_CELL_KIND = "docx"
INSPYRO_METADATA_KEY = "inspyro"
CELL_KIND_METADATA_KEY = "cell_kind"


def _normalize_kind(value: Any, *, allowed: set[str], default: str = "code") -> str:
    text = str(value or default).strip().lower() or default
    return text if text in allowed else default


def _copy_metadata(value: Any) -> dict[str, Any]:
    return copy.deepcopy(value) if isinstance(value, dict) else {}


def _metadata_cell_kind(metadata: dict[str, Any]) -> str | None:
    inspyro_meta = metadata.get(INSPYRO_METADATA_KEY)
    if isinstance(inspyro_meta, dict):
        kind = _normalize_kind(inspyro_meta.get(CELL_KIND_METADATA_KEY), allowed=LOGICAL_CELL_TYPES, default="")
        if kind:
            return kind

    # Transitional compatibility for early experiments and hand-edited files.
    for key in ("inspyro_cell_kind", "cell_kind"):
        kind = _normalize_kind(metadata.get(key), allowed=LOGICAL_CELL_TYPES, default="")
        if kind:
            return kind
    return None


def logical_cell_kind(
    cell: dict[str, Any] | None,
    *,
    source_detector: Callable[[Any], bool] | None = None,
) -> str:
    """Return the Inspyro logical kind for a notebook cell."""
    if not isinstance(cell, dict):
        return "code"

    raw_type = _normalize_kind(cell.get("cell_type"), allowed=LOGICAL_CELL_TYPES, default="code")
    if raw_type == DOCX_CELL_KIND:
        return DOCX_CELL_KIND
    if raw_type in {"markdown", "raw"}:
        return raw_type

    metadata = cell.get("metadata") if isinstance(cell.get("metadata"), dict) else {}
    metadata_kind = _metadata_cell_kind(metadata)
    if metadata_kind == DOCX_CELL_KIND:
        return DOCX_CELL_KIND
    if metadata_kind in {"markdown", "raw"}:
        return metadata_kind

    if source_detector is not None:
        try:
            if source_detector(cell.get("source", "")):
                return DOCX_CELL_KIND
        except Exception:
            pass
    return "code"


def mark_logical_cell_kind(
    cell: dict[str, Any],
    logical_kind: str,
    *,
    persistable: bool,
) -> dict[str, Any]:
    """Set a cell's logical kind using either virtual or persisted shape."""
    kind = _normalize_kind(logical_kind, allowed=LOGICAL_CELL_TYPES, default="code")
    metadata = _copy_metadata(cell.get("metadata"))
    inspyro_meta = _copy_metadata(metadata.get(INSPYRO_METADATA_KEY))

    if kind == DOCX_CELL_KIND:
        inspyro_meta[CELL_KIND_METADATA_KEY] = DOCX_CELL_KIND
        metadata[INSPYRO_METADATA_KEY] = inspyro_meta
        cell["cell_type"] = "code" if persistable else DOCX_CELL_KIND
    else:
        if CELL_KIND_METADATA_KEY in inspyro_meta:
            inspyro_meta.pop(CELL_KIND_METADATA_KEY, None)
        if inspyro_meta:
            metadata[INSPYRO_METADATA_KEY] = inspyro_meta
        else:
            metadata.pop(INSPYRO_METADATA_KEY, None)
        cell["cell_type"] = kind if kind in PERSISTED_CELL_TYPES else "code"

    cell["metadata"] = metadata
    return cell


def normalize_cell_for_runtime(
    cell: dict[str, Any],
    *,
    source_detector: Callable[[Any], bool] | None = None,
) -> dict[str, Any]:
    """Return a copy that exposes Inspyro logical cell types to runtime/UI/MCP."""
    normalized = copy.deepcopy(cell)
    kind = logical_cell_kind(normalized, source_detector=source_detector)
    return mark_logical_cell_kind(normalized, kind, persistable=False)


def canonicalize_cell_for_persistence(
    cell: dict[str, Any],
    *,
    source_detector: Callable[[Any], bool] | None = None,
) -> dict[str, Any]:
    """Return a nbformat-safe persisted cell copy."""
    canonical = copy.deepcopy(cell)
    kind = logical_cell_kind(canonical, source_detector=source_detector)
    mark_logical_cell_kind(canonical, kind, persistable=True)

    cell_type = canonical.get("cell_type")
    canonical.setdefault("source", "")
    if cell_type == "code":
        if not isinstance(canonical.get("outputs"), list):
            canonical["outputs"] = []
        execution_count = canonical.get("execution_count")
        canonical["execution_count"] = execution_count if isinstance(execution_count, int) else None
    else:
        canonical.pop("outputs", None)
        canonical.pop("execution_count", None)
    return canonical


def normalize_notebook_for_runtime(
    notebook_payload: dict[str, Any],
    *,
    source_detector: Callable[[Any], bool] | None = None,
) -> dict[str, Any]:
    payload = copy.deepcopy(notebook_payload)
    cells = payload.get("cells")
    if isinstance(cells, list):
        payload["cells"] = [
            normalize_cell_for_runtime(cell, source_detector=source_detector)
            if isinstance(cell, dict)
            else cell
            for cell in cells
        ]
    return payload


def canonicalize_notebook_for_persistence(
    notebook_payload: dict[str, Any],
    *,
    source_detector: Callable[[Any], bool] | None = None,
) -> dict[str, Any]:
    payload = copy.deepcopy(notebook_payload)
    cells = payload.get("cells")
    if isinstance(cells, list):
        payload["cells"] = [
            canonicalize_cell_for_persistence(cell, source_detector=source_detector)
            if isinstance(cell, dict)
            else cell
            for cell in cells
        ]
    return payload


def validate_persisted_notebook(notebook_payload: dict[str, Any]) -> None:
    """Validate a persisted notebook payload with nbformat when available."""
    try:
        import nbformat  # type: ignore
    except Exception:
        return
    nbformat.validate(nbformat.from_dict(notebook_payload))
