"""Engineering checks and expected analyzer targets."""

from __future__ import annotations

from dataclasses import dataclass

from .chain import stage_00, stage_45
from .geometry import base_width
from .materials import steel_fy
from .model import BeamModel


@dataclass(frozen=True)
class CheckResult:
    name: str
    ratio: float
    limit: float
    passed: bool
    source_symbol: str


def flexure_check(model: BeamModel) -> CheckResult:
    ratio = model.capacity_ratio()
    return CheckResult(
        name="Flexure envelope",
        ratio=ratio,
        limit=1.0,
        passed=ratio <= 1.0,
        source_symbol="BeamModel.capacity_ratio",
    )


def chain_depth_check() -> CheckResult:
    shallow = stage_00()
    deep = stage_45()
    ratio = deep / max(shallow, 1.0e-9)
    return CheckResult(
        name="Static chain depth",
        ratio=ratio,
        limit=1.75,
        passed=ratio <= 1.75,
        source_symbol="stage_45",
    )


def geometry_material_check(model: BeamModel) -> CheckResult:
    ratio = (base_width * steel_fy) / max(model.section.area * 4_500.0, 1.0e-9)
    return CheckResult(
        name="Geometry/material coupling",
        ratio=ratio,
        limit=1.0,
        passed=ratio <= 1.0,
        source_symbol="base_width -> steel_fy -> Section.area",
    )


def run_all_checks(model: BeamModel) -> list[CheckResult]:
    return [flexure_check(model), chain_depth_check(), geometry_material_check(model)]


def final_utilization(model: BeamModel) -> float:
    checks = run_all_checks(model)
    governing = max(check.ratio / check.limit for check in checks)
    return governing


EXPECTED_DEPENDENCY_TARGETS = [
    "final_utilization",
    "BeamModel.capacity_ratio",
    "Section.area",
    "stage_45",
]

EXPECTED_IMPACT_TARGETS = [
    "base_width",
    "steel_fy",
    "LoadCase.dead",
    "stage_00",
]
