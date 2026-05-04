"""Presentation helpers kept outside the notebook for a thin orchestration layer."""

from __future__ import annotations

from typing import Iterable

from .checks import CheckResult
from .model import BeamModel


def audit_rows(model: BeamModel) -> list[list[object]]:
    audit = model.dependency_audit()
    return [
        ["Carga lineal equivalente", round(audit["line_load"], 4), "kN/m"],
        ["Momento de servicio", round(audit["moment"], 4), "kN m"],
        ["Momento amplificado", round(audit["combined_moment"], 4), "kN m"],
        ["Razon demanda/capacidad", round(audit["capacity_ratio"], 6), "-"],
        ["Cadena etapa 25", round(audit["chain_stage_25"], 6), "-"],
        ["Cadena etapa 45", round(audit["chain_stage_45"], 6), "-"],
    ]


def check_rows(checks: Iterable[CheckResult]) -> list[list[object]]:
    rows = []
    for check in checks:
        rows.append([
            check.name,
            round(check.ratio, 6),
            round(check.limit, 6),
            "OK" if check.passed else "NO CUMPLE",
            check.source_symbol,
        ])
    return rows


def target_rows() -> list[list[str]]:
    return [
        ["Dependencias", "final_utilization", "Notebook/checks/model/sections/materials/loads/chain"],
        ["Dependencias", "BeamModel.capacity_ratio", "model -> loads -> sections -> materials -> chain"],
        ["Dependencias", "Section.area", "sections -> geometry"],
        ["Dependencias", "stage_45", "chain stage_45 ... stage_00 -> geometry/materials"],
        ["Impacto", "base_width", "geometry -> sections -> model -> checks -> notebook"],
        ["Impacto", "steel_fy", "materials -> chain/sections/checks -> notebook"],
        ["Impacto", "LoadCase.dead", "loads -> model -> checks -> notebook"],
        ["Impacto", "stage_00", "chain -> stage_45 -> model/checks -> notebook"],
    ]


def markdown_summary(model: BeamModel, checks: Iterable[CheckResult]) -> str:
    utilization = max(check.ratio / check.limit for check in checks)
    audit = model.dependency_audit()
    return (
        f"Utilizacion gobernante: {utilization:.4f}\n"
        f"Momento amplificado: {audit['combined_moment']:.4f} kN m\n"
        f"Cadena profunda stage_45: {audit['chain_stage_45']:.6f}"
    )

