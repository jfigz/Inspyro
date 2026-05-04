"""
Analysis Handlers - Handlers para análisis de dependencias e impacto

Este módulo contiene los handlers WebSocket para:
- Análisis de dependencias de un símbolo
- Análisis de impacto (qué depende de un símbolo)

Estos handlers son llamados desde el websocket_endpoint principal.
"""

import traceback
import asyncio
import logging
from fastapi import WebSocket
from typing import Optional, Any

from app.services.engineering_optimization_service import engineering_optimization_service

_logger = logging.getLogger(__name__)

# Importaciones que se inyectan desde main.py
_manager = None
_dependency_service = None
_dependency_analyzer_available = False
_jupyter_kernel_manager = None


def _runtime_quantity_description(runtime_value: dict) -> Optional[str]:
    metadata = runtime_value.get("metadata")
    if isinstance(metadata, dict):
        desc = metadata.get("description")
        if isinstance(desc, str) and desc.strip():
            return desc.strip()
    desc = runtime_value.get("description")
    if isinstance(desc, str) and desc.strip():
        return desc.strip()
    return None


def _enrich_node_from_runtime_quantity(node: dict, runtime_value: dict) -> None:
    if not isinstance(node, dict) or not isinstance(runtime_value, dict):
        return
    is_quantity = runtime_value.get("type") == "Quantity" or runtime_value.get("is_quantity") is True
    if not is_quantity:
        return

    runtime_unit = runtime_value.get("unit_display") or runtime_value.get("unit") or runtime_value.get("unit_canonical")
    runtime_category = runtime_value.get("category")
    runtime_description = _runtime_quantity_description(runtime_value)

    if (not node.get("unit")) and isinstance(runtime_unit, str) and runtime_unit.strip():
        node["unit"] = runtime_unit.strip()
    if (not node.get("category")) and isinstance(runtime_category, str) and runtime_category.strip():
        node["category"] = runtime_category.strip()
    if (not node.get("description")) and isinstance(runtime_description, str) and runtime_description.strip():
        node["description"] = runtime_description.strip()


async def _enrich_graph_with_runtime_if_available(result: dict, kernel_id: Optional[str]) -> bool:
    if not kernel_id or not _jupyter_kernel_manager:
        return False
    try:
        runtime_vars = await _jupyter_kernel_manager.capture_variables_now(kernel_id, timeout=2.0)
    except Exception as exc:
        _logger.debug("Runtime enrichment failed for kernel %s: %s", kernel_id, exc)
        return False

    if not isinstance(runtime_vars, dict):
        return False

    nodes = result.get("nodes", [])
    name_counts = {}
    for node in nodes:
        node_name = node.get("name")
        if isinstance(node_name, str) and node_name:
            name_counts[node_name] = name_counts.get(node_name, 0) + 1

    enriched = False
    consumed_runtime_keys = set()
    pending_name_fallback = []
    for node in nodes:
        scope_path = node.get("scope_path")
        if isinstance(scope_path, str):
            scope_key = scope_path.strip()
            if scope_key and scope_key in runtime_vars and scope_key not in consumed_runtime_keys:
                runtime_value = runtime_vars[scope_key]
                node["runtime_value"] = runtime_value
                _enrich_node_from_runtime_quantity(node, runtime_value)
                consumed_runtime_keys.add(scope_key)
                enriched = True
                continue
        pending_name_fallback.append(node)

    nodes_by_name = {}
    for node in pending_name_fallback:
        var_name = node.get("name")
        if not isinstance(var_name, str) or not var_name:
            continue
        nodes_by_name.setdefault(var_name, []).append(node)

    for var_name, nodes in nodes_by_name.items():
        # Fallback legacy sólo para nombres no ambiguos.
        if len(nodes) != 1 or name_counts.get(var_name, 0) != 1:
            continue
        if var_name not in runtime_vars or var_name in consumed_runtime_keys:
            continue
        runtime_value = runtime_vars[var_name]
        for node in nodes:
            node["runtime_value"] = runtime_value
            _enrich_node_from_runtime_quantity(node, runtime_value)
        consumed_runtime_keys.add(var_name)
        enriched = True

    return enriched


def init_analysis_handlers(
    manager: Any,
    dependency_service: Any,
    dependency_analyzer_available: bool,
    jupyter_kernel_manager: Any = None
):
    """
    Inicializa las dependencias del módulo.
    Llamar desde main.py después de la inicialización de servicios.
    """
    global _manager, _dependency_service, _dependency_analyzer_available, _jupyter_kernel_manager
    _manager = manager
    _dependency_service = dependency_service
    _dependency_analyzer_available = dependency_analyzer_available
    _jupyter_kernel_manager = jupyter_kernel_manager


async def handle_analyze_dependencies(message: dict, websocket: WebSocket):
    """
    Maneja solicitudes de análisis de dependencias para un símbolo.
    
    Mensaje esperado:
    {
        "type": "analyze_dependencies",
        "symbol": "variable_name",
        "source_code": "...",
        "line": 5,
        "column": 10,
        "notebook_context": ["cell1_code", "cell2_code"],  # opcional
        "file_path": "/path/to/file",  # opcional
        "max_depth": 10  # opcional
    }
    """
    request_id = message.get("request_id")

    if not _dependency_analyzer_available or not _dependency_service:
        await _manager.send_personal_message({
            "type": "dependency_analysis_error",
            "error": "Analizador de dependencias no disponible",
            "request_id": request_id,
        }, websocket)
        return
    
    try:
        symbol = message.get("symbol", "")
        source_code = message.get("source_code", "")
        line = message.get("line")
        column = message.get("column")
        notebook_context = message.get("notebook_context")
        file_path = message.get("file_path", "")
        max_depth = message.get("max_depth", 10)
        kernel_id = message.get("kernel_id")
        context_cell_ids = message.get("context_cell_ids") 
        cell_id = message.get("cell_id")

        if not symbol:
            await _manager.send_personal_message({
                "type": "dependency_analysis_error",
                "error": "Se requiere un símbolo para analizar",
                "request_id": request_id,
            }, websocket)
            return
        
        loop = asyncio.get_running_loop()
        result = await loop.run_in_executor(
            None,
            lambda: _dependency_service.analyze_symbol(
                symbol=symbol,
                source_code=source_code,
                line=line,
                column=column,
                notebook_context=notebook_context,
                cell_id=cell_id,
                context_cell_ids=context_cell_ids,
                file_path=file_path,
                max_depth=max_depth
            ),
        )

        runtime_enriched = await _enrich_graph_with_runtime_if_available(result, kernel_id)
        if not isinstance(result.get("parse_errors"), list):
            result["parse_errors"] = []
        result["analysis_mode"] = "dependencies"
        result["runtime_enriched"] = bool(runtime_enriched)

        await _manager.send_personal_message({
            "type": "dependency_analysis_result",
            "symbol": symbol,
            "graph": result,
            "request_id": request_id,
        }, websocket)
        
    except Exception as e:
        await _manager.send_personal_message({
            "type": "dependency_analysis_error",
            "error": str(e),
            "traceback": traceback.format_exc(),
            "request_id": request_id,
        }, websocket)


async def handle_analyze_impact(message: dict, websocket: WebSocket):
    """
    Maneja solicitudes de análisis de impacto (¿qué depende de este símbolo?).
    
    Mensaje esperado:
    {
        "type": "analyze_impact",
        "symbol": "variable_name",
        "source_code": "...",
        "notebook_context": ["cell1_code", "cell2_code"],  # opcional
        "file_path": "/path/to/file"  # opcional
    }
    """
    request_id = message.get("request_id")

    if not _dependency_analyzer_available or not _dependency_service:
        await _manager.send_personal_message({
            "type": "impact_analysis_error",
            "error": "Analizador de dependencias no disponible",
            "request_id": request_id,
        }, websocket)
        return
    
    try:
        symbol = message.get("symbol", "")
        source_code = message.get("source_code", "")
        line = message.get("line")
        column = message.get("column")
        notebook_context = message.get("notebook_context")
        file_path = message.get("file_path", "")
        kernel_id = message.get("kernel_id")
        context_cell_ids = message.get("context_cell_ids") 
        cell_id = message.get("cell_id")
        max_depth = message.get("max_depth", 10)
        
        if not symbol:
            await _manager.send_personal_message({
                "type": "impact_analysis_error",
                "error": "Se requiere un símbolo para analizar",
                "request_id": request_id,
            }, websocket)
            return
            
        loop = asyncio.get_running_loop()
        result = await loop.run_in_executor(
            None,
            lambda: _dependency_service.analyze_impact(
                symbol=symbol,
                source_code=source_code,
                line=line,
                column=column,
                notebook_context=notebook_context,
                cell_id=cell_id,
                context_cell_ids=context_cell_ids,
                file_path=file_path,
                max_depth=max_depth,
            ),
        )

        runtime_enriched = await _enrich_graph_with_runtime_if_available(result, kernel_id)
        if not isinstance(result.get("parse_errors"), list):
            result["parse_errors"] = []
        result["analysis_mode"] = "impact"
        result["runtime_enriched"] = bool(runtime_enriched)
        
        await _manager.send_personal_message({
            "type": "impact_analysis_result",
            "symbol": symbol,
            "graph": result,
            "request_id": request_id,
        }, websocket)
        
    except Exception as e:
        await _manager.send_personal_message({
            "type": "impact_analysis_error",
            "error": str(e),
            "traceback": traceback.format_exc(),
            "request_id": request_id,
        }, websocket)


async def handle_sensitivity_analyze(message: dict, websocket: WebSocket):
    """
    Ejecuta análisis de sensibilidad evaluando las fórmulas matemáticas directamente.
    
    Mensaje esperado:
    {
        "type": "sensitivity_analyze",
        "kernel_id": "...",
        "modified_variables": { "E": 210, "bf": 250 },
        "output_variables": ["sigma_total", "FS", "DCR"],
        "formulas": { ... },
        "current_values": { ... }
    }
    """
    request_id = message.get("request_id")

    # Importación perezosa pero estandarizada
    try:
        from app.services.sensitivity_service import SensitivityAnalyzer
    except ImportError as e:
        await _manager.send_personal_message({
            "type": "sensitivity_result",
            "success": False,
            "results": {},
            "error": f"Error al cargar SensitivityAnalyzer: {e}",
            "request_id": request_id,
        }, websocket)
        return

    try:
        modified_variables = message.get("modified_variables", {})
        output_variables = message.get("output_variables", [])
        formulas = message.get("formulas", {})
        current_values = message.get("current_values", {})
        
        analyzer = SensitivityAnalyzer()
        loop = asyncio.get_running_loop()
        results = await loop.run_in_executor(
            None,
            lambda: analyzer.analyze(
                modified_variables=modified_variables,
                formulas=formulas,
                current_values=current_values,
                output_variables=output_variables
            ),
        )
        
        await _manager.send_personal_message({
            "type": "sensitivity_result",
            "success": True,
            "results": results,
            "error": None,
            "request_id": request_id,
        }, websocket)
        
    except Exception as e:
        await _manager.send_personal_message({
            "type": "sensitivity_result",
            "success": False,
            "results": {},
            "error": f"{type(e).__name__}: {str(e)}",
            "request_id": request_id,
        }, websocket)


async def handle_optimize_design(message: dict, websocket: WebSocket):
    request_id = message.get("request_id")
    try:
        objective = message.get("objective", {}) or {}
        variables = message.get("variables", []) or []
        constraints = message.get("constraints", []) or []
        formulas = message.get("formulas", {}) or {}
        current_values = message.get("current_values", {}) or {}
        iterations = message.get("iterations", 80)
        seed = message.get("seed", 42)

        await _manager.send_personal_message(
            {
                "type": "optimization_progress",
                "request_id": request_id,
                "iteration": 0,
                "status": "starting",
                "message": "Iniciando búsqueda de diseño óptimo",
            },
            websocket,
        )

        loop = asyncio.get_running_loop()
        result = await loop.run_in_executor(
            None,
            lambda: engineering_optimization_service.optimize_design(
                objective=objective,
                variables=variables,
                constraints=constraints,
                formulas=formulas,
                current_values=current_values,
                iterations=iterations,
                seed=seed,
            ),
        )

        if isinstance(result, dict) and result.get("error"):
            await _manager.send_personal_message(
                {
                    "type": "optimization_error",
                    "request_id": request_id,
                    "error": str(result.get("error")),
                    "details": result,
                },
                websocket,
            )
            return

        recommended = result.get("recommended_design") if isinstance(result, dict) else None
        await _manager.send_personal_message(
            {
                "type": "optimization_progress",
                "request_id": request_id,
                "iteration": int(iterations) if isinstance(iterations, int) else 0,
                "status": "completed",
                "best": recommended,
            },
            websocket,
        )
        await _manager.send_personal_message(
            {
                "type": "optimization_result",
                "request_id": request_id,
                **(result if isinstance(result, dict) else {"result": result}),
            },
            websocket,
        )
    except Exception as exc:
        await _manager.send_personal_message(
            {
                "type": "optimization_error",
                "request_id": request_id,
                "error": str(exc),
                "traceback": traceback.format_exc(),
            },
            websocket,
        )


async def handle_analyze_load_envelope(message: dict, websocket: WebSocket):
    request_id = message.get("request_id")
    try:
        combinations = message.get("combinations", []) or []
        outputs = message.get("outputs", []) or []
        formulas = message.get("formulas", {}) or {}
        current_values = message.get("current_values", {}) or {}
        loop = asyncio.get_running_loop()
        result = await loop.run_in_executor(
            None,
            lambda: engineering_optimization_service.analyze_load_envelope(
                combinations=combinations,
                outputs=outputs,
                formulas=formulas,
                current_values=current_values,
            ),
        )
        await _manager.send_personal_message(
            {
                "type": "load_envelope_result",
                "request_id": request_id,
                **(result if isinstance(result, dict) else {"result": result}),
            },
            websocket,
        )
    except Exception as exc:
        await _manager.send_personal_message(
            {
                "type": "load_envelope_error",
                "request_id": request_id,
                "error": str(exc),
                "traceback": traceback.format_exc(),
            },
            websocket,
        )


async def handle_run_code_checks(message: dict, websocket: WebSocket):
    request_id = message.get("request_id")
    try:
        checks = message.get("checks", []) or []
        formulas = message.get("formulas", {}) or {}
        current_values = message.get("current_values", {}) or {}
        code_profile = message.get("code_profile")
        loop = asyncio.get_running_loop()
        result = await loop.run_in_executor(
            None,
            lambda: engineering_optimization_service.run_code_checks(
                checks=checks,
                formulas=formulas,
                current_values=current_values,
                code_profile=code_profile,
            ),
        )
        await _manager.send_personal_message(
            {
                "type": "code_checks_result",
                "request_id": request_id,
                **(result if isinstance(result, dict) else {"result": result}),
            },
            websocket,
        )
    except Exception as exc:
        await _manager.send_personal_message(
            {
                "type": "code_checks_error",
                "request_id": request_id,
                "error": str(exc),
                "traceback": traceback.format_exc(),
            },
            websocket,
        )


async def handle_compare_scenarios(message: dict, websocket: WebSocket):
    request_id = message.get("request_id")
    try:
        baseline = message.get("baseline", {}) or {}
        candidates = message.get("candidates", []) or []
        outputs = message.get("outputs", []) or []
        formulas = message.get("formulas", {}) or {}
        current_values = message.get("current_values", {}) or {}
        loop = asyncio.get_running_loop()
        result = await loop.run_in_executor(
            None,
            lambda: engineering_optimization_service.compare_scenarios(
                baseline=baseline,
                candidates=candidates,
                outputs=outputs,
                formulas=formulas,
                current_values=current_values,
            ),
        )
        await _manager.send_personal_message(
            {
                "type": "scenario_comparison_result",
                "request_id": request_id,
                **(result if isinstance(result, dict) else {"result": result}),
            },
            websocket,
        )
    except Exception as exc:
        await _manager.send_personal_message(
            {
                "type": "scenario_comparison_error",
                "request_id": request_id,
                "error": str(exc),
                "traceback": traceback.format_exc(),
            },
            websocket,
        )

