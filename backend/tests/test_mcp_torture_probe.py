from __future__ import annotations

from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from dev import mcp_torture_assets as assets


def test_torture_coverage_matrix_matches_public_catalog():
    assert set(assets.TOOL_COVERAGE_MATRIX) == set(assets.PROFILE_TOOLSETS["all"])
    assert set(assets.RESOURCE_COVERAGE_MATRIX) == set(assets.PUBLIC_RESOURCE_URIS)
    assert set(assets.RESOURCE_TEMPLATE_COVERAGE_MATRIX) == set(assets.PUBLIC_RESOURCE_TEMPLATE_URIS)
    assert set(assets.PROMPT_COVERAGE_MATRIX) == set(assets.PUBLIC_PROMPT_NAMES)


def test_torture_notebook_spec_has_stable_unique_cell_ids():
    cell_ids = [cell["cell_id"] for cell in assets.PRIMARY_NOTEBOOK_SPEC]
    assert len(cell_ids) == len(set(cell_ids))
    assert cell_ids == [
        "m00_overview",
        assets.PRIMARY_NOTEBOOK_BOOTSTRAP_CELL_ID,
        "c02_engineering_units",
        "c03_structural_model",
        "c04_runtime_results",
        assets.PRIMARY_NOTEBOOK_ANALYSIS_CELL_ID,
        "m06_doc_report",
        "c06_doc_report_cover",
        "c07_doc_report_tables",
        "c08_doc_report_figures",
        assets.PRIMARY_NOTEBOOK_LONG_CELL_ID,
    ]


def test_torture_notebook_spec_covers_docx_units_and_analysis_features():
    joined_source = "\n".join(cell["source"] for cell in assets.PRIMARY_NOTEBOOK_SPEC if cell["cell_type"] == "code")
    expected_markers = [
        "kg / m**3",
        "Q_(23.5, degC)",
        "class BeamScenario",
        "def design_moment_kNm",
        "analysis_formulas = {",
        "doc_reset(hard=True)",
        "build_doc(block_id=",
        "builder.table_of_contents(",
        "builder.math_latex(",
        "builder.create_math_latex_element(",
        "builder.table(",
        "builder.dataframe(",
        "builder.figure(",
        "builder.image(",
        "builder.caption(",
        "builder.reference(",
        "interruptible_tick=",
    ]
    for marker in expected_markers:
        assert marker in joined_source


def test_torture_secondary_notebook_spec_supports_output_preservation_checks():
    assert [cell["cell_id"] for cell in assets.SECONDARY_NOTEBOOK_SPEC] == [
        "sm00_overview",
        assets.SECONDARY_NOTEBOOK_CODE_CELL_ID,
    ]
    assert "quick_total" in assets.SECONDARY_NOTEBOOK_SPEC[-1]["source"]


def test_torture_template_fixture_can_be_materialized(tmp_path: Path):
    fixture_path = assets.ensure_template_fixture(tmp_path / "mcp_torture_template.docx")
    assert fixture_path.exists()
    assert fixture_path.suffix.lower() == ".docx"

