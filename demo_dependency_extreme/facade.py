"""Public facade with deliberate reexports and aliases for analyzer stress."""

from __future__ import annotations

from .chain import *  # noqa: F401,F403
from .checks import EXPECTED_DEPENDENCY_TARGETS, EXPECTED_IMPACT_TARGETS, final_utilization, run_all_checks
from .geometry import GEOMETRY_INPUTS, base_width, build_geometry_inputs
from .loads import BASE_LOAD_CASE, LoadCase, build_load_case
from .materials import MATERIAL_LIBRARY, PRIMARY_MATERIAL, Material, build_material_library, steel_fy
from .model import BeamModel, build_beam_model
from .reporting import audit_rows, check_rows, markdown_summary, target_rows
from .sections import CompositeSection, Section, build_composite_section, build_section


def build_demo_model() -> BeamModel:
    library = build_material_library()
    material = library.get("primary")
    section = build_section(material)
    composite = build_composite_section(material)
    load_case = build_load_case()
    model = build_beam_model(section, composite, load_case, material)
    return model


def run_demo_scenario() -> dict[str, object]:
    model = build_demo_model()
    checks = run_all_checks(model)
    utilization = final_utilization(model)
    return {
        "model": model,
        "checks": checks,
        "utilization": utilization,
        "audit_rows": audit_rows(model),
        "check_rows": check_rows(checks),
        "target_rows": target_rows(),
        "summary": markdown_summary(model, checks),
    }


__all__ = [
    "BASE_LOAD_CASE",
    "BeamModel",
    "CompositeSection",
    "EXPECTED_DEPENDENCY_TARGETS",
    "EXPECTED_IMPACT_TARGETS",
    "GEOMETRY_INPUTS",
    "LoadCase",
    "MATERIAL_LIBRARY",
    "Material",
    "PRIMARY_MATERIAL",
    "Section",
    "audit_rows",
    "base_width",
    "build_beam_model",
    "build_composite_section",
    "build_demo_model",
    "build_geometry_inputs",
    "build_load_case",
    "build_material_library",
    "build_section",
    "check_rows",
    "final_utilization",
    "markdown_summary",
    "run_all_checks",
    "run_demo_scenario",
    "stage_00",
    "stage_45",
    "steel_fy",
    "target_rows",
]

