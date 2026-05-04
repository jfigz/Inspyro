"""Tools MCP - Analysis: dependencias, impacto y calculos de ingenieria."""

from __future__ import annotations

from typing import Any, Optional

from .. import config
from ..activity import mcp_activity_tool
from ..bridge import BridgeError, InspyroBridge


_LONG_RUNNING_ANALYSIS_TIMEOUT_S = max(
    600,
    int(config.CELL_EXECUTION_TIMEOUT),
    int(config.WS_TIMEOUT),
)


def _drop_none(data: dict[str, Any]) -> dict[str, Any]:
    return {key: value for key, value in data.items() if value is not None}


def _normalize_graph_response(result: dict[str, Any]) -> dict[str, Any]:
    graph = result.get("graph")
    if not isinstance(graph, dict):
        graph = {}
    return {
        "status": "ok",
        "symbol": result.get("symbol"),
        "graph": graph,
        "nodes": graph.get("nodes", []),
        "edges": graph.get("edges", []),
        "meta": {
            "analysis_mode": graph.get("analysis_mode"),
            "runtime_enriched": graph.get("runtime_enriched"),
            "parse_errors": graph.get("parse_errors", []),
        },
        "raw": result,
    }


def _raise_if_unsuccessful(result: dict[str, Any], *, default_message: str) -> None:
    if result.get("success", True) is False:
        raise BridgeError(
            str(result.get("error") or default_message),
            payload=result,
        )


@mcp_activity_tool("analysis")
async def analyze_dependencies(
    symbol: str,
    source_code: Optional[str] = None,
    notebook_context: Optional[list[str]] = None,
    line: Optional[int] = None,
    column: Optional[int] = None,
    file_path: Optional[str] = None,
    max_depth: Optional[int] = None,
    kernel_id: Optional[str] = None,
    context_cell_ids: Optional[list[str]] = None,
    cell_id: Optional[str] = None,
) -> dict:
    """Analyze dependency graph for a symbol."""
    bridge = InspyroBridge.get()
    result = await bridge.ws_request(
        "analyze_dependencies",
        _drop_none(
            {
                "symbol": symbol,
                "source_code": source_code,
                "notebook_context": notebook_context,
                "line": line,
                "column": column,
                "file_path": file_path,
                "max_depth": max_depth,
                "kernel_id": kernel_id,
                "context_cell_ids": context_cell_ids,
                "cell_id": cell_id,
            }
        ),
        success_types={"dependency_analysis_result"},
        error_types={"dependency_analysis_error"},
        timeout=_LONG_RUNNING_ANALYSIS_TIMEOUT_S,
    )
    return _normalize_graph_response(result)


@mcp_activity_tool("analysis")
async def analyze_impact(
    symbol: str,
    source_code: Optional[str] = None,
    notebook_context: Optional[list[str]] = None,
    line: Optional[int] = None,
    column: Optional[int] = None,
    file_path: Optional[str] = None,
    max_depth: Optional[int] = None,
    kernel_id: Optional[str] = None,
    context_cell_ids: Optional[list[str]] = None,
    cell_id: Optional[str] = None,
) -> dict:
    """Analyze impact graph for a symbol."""
    bridge = InspyroBridge.get()
    result = await bridge.ws_request(
        "analyze_impact",
        _drop_none(
            {
                "symbol": symbol,
                "source_code": source_code,
                "notebook_context": notebook_context,
                "line": line,
                "column": column,
                "file_path": file_path,
                "max_depth": max_depth,
                "kernel_id": kernel_id,
                "context_cell_ids": context_cell_ids,
                "cell_id": cell_id,
            }
        ),
        success_types={"impact_analysis_result"},
        error_types={"impact_analysis_error"},
        timeout=_LONG_RUNNING_ANALYSIS_TIMEOUT_S,
    )
    return _normalize_graph_response(result)


@mcp_activity_tool("analysis")
async def run_sensitivity(
    modified_variables: dict[str, Any],
    output_variables: list[str],
    formulas: dict[str, Any],
    current_values: dict[str, Any],
) -> dict:
    """Run the backend sensitivity analyzer."""
    bridge = InspyroBridge.get()
    result = await bridge.ws_request(
        "sensitivity_analyze",
        {
            "modified_variables": modified_variables,
            "output_variables": output_variables,
            "formulas": formulas,
            "current_values": current_values,
        },
        success_types={"sensitivity_result"},
        timeout=_LONG_RUNNING_ANALYSIS_TIMEOUT_S,
    )
    _raise_if_unsuccessful(result, default_message="Sensitivity analysis failed")
    return {
        "status": "ok",
        "results": result.get("results", {}),
        "raw": result,
    }


@mcp_activity_tool("analysis")
async def optimize_design(
    objective: dict[str, Any],
    variables: list[dict[str, Any]],
    constraints: list[dict[str, Any]],
    formulas: dict[str, Any],
    current_values: dict[str, Any],
    iterations: int = 100,
    seed: Optional[int] = None,
    kernel_id: Optional[str] = None,
) -> dict:
    """Run engineering design optimization."""
    bridge = InspyroBridge.get()
    result = await bridge.ws_request(
        "optimize_design",
        _drop_none(
            {
                "objective": objective,
                "variables": variables,
                "constraints": constraints,
                "formulas": formulas,
                "current_values": current_values,
                "iterations": iterations,
                "seed": seed,
                "kernel_id": kernel_id,
            }
        ),
        success_types={"optimization_result"},
        error_types={"optimization_error"},
        timeout=_LONG_RUNNING_ANALYSIS_TIMEOUT_S,
    )
    if result.get("error"):
        raise BridgeError(
            str(result.get("error")),
            payload=result,
        )
    return {
        "status": "ok",
        "recommended_design": result.get("recommended_design"),
        "pareto_front": result.get("pareto_front", []),
        "evaluated_candidates": result.get("evaluated_candidates"),
        "feasible_candidates": result.get("feasible_candidates"),
        "objective_targets": result.get("objective_targets", []),
        "raw": result,
    }


@mcp_activity_tool("analysis")
async def compare_scenarios(
    baseline: dict[str, Any],
    candidates: list[dict[str, Any]],
    outputs: list[str],
    formulas: dict[str, Any],
    current_values: dict[str, Any],
) -> dict:
    """Compare engineering scenarios against a baseline."""
    bridge = InspyroBridge.get()
    result = await bridge.ws_request(
        "compare_scenarios",
        {
            "baseline": baseline,
            "candidates": candidates,
            "outputs": outputs,
            "formulas": formulas,
            "current_values": current_values,
        },
        success_types={"scenario_comparison_result"},
        error_types={"scenario_comparison_error"},
        timeout=_LONG_RUNNING_ANALYSIS_TIMEOUT_S,
    )
    return {
        "status": "ok",
        "baseline": result.get("baseline"),
        "comparisons": result.get("comparisons", []),
        "outputs": result.get("outputs", outputs),
        "raw": result,
    }


@mcp_activity_tool("analysis")
async def run_code_checks(
    checks: list[dict[str, Any]],
    formulas: dict[str, Any],
    current_values: dict[str, Any],
    code_profile: Optional[str] = None,
) -> dict:
    """Run engineering code checks against formulas/current values."""
    bridge = InspyroBridge.get()
    result = await bridge.ws_request(
        "run_code_checks",
        _drop_none(
            {
                "checks": checks,
                "formulas": formulas,
                "current_values": current_values,
                "code_profile": code_profile,
            }
        ),
        success_types={"code_checks_result"},
        error_types={"code_checks_error"},
        timeout=_LONG_RUNNING_ANALYSIS_TIMEOUT_S,
    )
    summary = result.get("summary")
    return {
        "status": "ok",
        "summary": summary,
        "checks": result.get("checks", []),
        "active_constraints": result.get("active_constraints", []),
        "profile": result.get("profile"),
        "raw": result,
    }
