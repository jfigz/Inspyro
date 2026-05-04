"""Structured MCP activity reporting for Inspyro UI mirroring."""

from __future__ import annotations

import contextvars
import inspect
import logging
import os
import time
import uuid
from datetime import timedelta
from functools import wraps
from typing import Any, Callable

from . import config
from .bridge import InspyroBridge
from .runtime import resolve_session_id
from .session_state import McpSessionState

logger = logging.getLogger("inspyro.mcp.activity")

try:  # pragma: no cover - requires FastMCP runtime
    from fastmcp.server.tasks import TaskConfig
except Exception:  # pragma: no cover - local test env may not have task extras
    TaskConfig = None  # type: ignore[assignment]

_SESSION_STATE = McpSessionState.get()
_CURRENT_RUN_ID: contextvars.ContextVar[str | None] = contextvars.ContextVar(
    "inspyro_mcp_run_id",
    default=None,
)
_CURRENT_TOOL_NAME: contextvars.ContextVar[str | None] = contextvars.ContextVar(
    "inspyro_mcp_tool_name",
    default=None,
)
_CURRENT_TOOL_GROUP: contextvars.ContextVar[str | None] = contextvars.ContextVar(
    "inspyro_mcp_tool_group",
    default=None,
)


class _LazyMcpProxy:
    """Lazy proxy to avoid circular imports while keeping `mcp.tool()` patchable in tests."""

    def tool(self, *args: Any, **kwargs: Any) -> Any:
        from .server import mcp as resolved_mcp

        return resolved_mcp.tool(*args, **kwargs)


mcp = _LazyMcpProxy()

SummaryBuilder = Callable[[str, dict[str, Any]], str]

_FILE_MUTATION_TOOLS = {"write_file", "create_file", "delete_file", "rename_file"}
_NOTEBOOK_MUTATION_TOOLS = {
    "notebook_create",
    "notebook_load",
    "close_session_notebook",
    "notebook_sync_cells",
    "create_kernel",
    "attach_kernel",
    "notebook_save",
    "execute_cell",
    "execute_all_cells",
    "execute_cells",
    "execute_until",
    "add_cell",
    "delete_cell",
    "edit_cell",
    "move_cell",
    "cancel_run",
    "resume_run",
}
_TEMPLATE_MUTATION_TOOLS = {"upload_template", "delete_template", "update_template_style"}
_DOCUMENT_MUTATION_TOOLS = {
    "check_document_quality",
    "run_document_workbench",
    "compare_document_versions",
    "manage_document_review",
    "prepare_document_delivery",
    "get_document_pdf",
    "get_document_docx",
    "export_document_pdf",
    "export_document_docx",
    "export_clean_document_docx",
    "reconvert_pdf",
}
_CORE_TOOL_NAMES = {
    "get_system_info",
    "get_health",
    "list_component_profiles",
    "set_component_profile",
}
_ADMIN_TOOL_NAMES = {
    "get_metrics",
    "get_pdf_status",
}
_READ_ONLY_TOOL_NAMES = {
    "list_files",
    "read_file",
    "get_metrics",
    "get_pdf_status",
    "list_session_notebooks",
    "notebook_load",
    "create_kernel",
    "attach_kernel",
    "list_cells",
    "get_cell",
    "find_in_notebook",
    "kernel_status",
    "execution_status",
    "get_kernel_status",
    "get_run_status",
    "get_variables",
    "get_document_pdf",
    "get_document_docx",
    "get_pdf_status",
    "analyze_dependencies",
    "analyze_impact",
    "run_sensitivity",
    "optimize_design",
    "compare_scenarios",
    "run_code_checks",
    "get_system_info",
    "get_health",
    "get_metrics",
    "get_template_info",
    "convert_units",
    "get_units_catalog",
    "check_units_compatible",
    "list_component_profiles",
}
_DESTRUCTIVE_TOOL_NAMES = {
    "delete_file",
    "delete_cell",
    "delete_template",
    "close_session_notebook",
    "shutdown_kernel",
    "reset_kernel",
    "interrupt_kernel",
}
_IDEMPOTENT_TOOL_NAMES = {
    "list_files",
    "read_file",
    "get_metrics",
    "get_pdf_status",
    "list_session_notebooks",
    "notebook_load",
    "create_kernel",
    "attach_kernel",
    "list_cells",
    "get_cell",
    "find_in_notebook",
    "kernel_status",
    "execution_status",
    "get_kernel_status",
    "get_run_status",
    "get_variables",
    "get_document_pdf",
    "get_document_docx",
    "get_pdf_status",
    "analyze_dependencies",
    "analyze_impact",
    "run_sensitivity",
    "optimize_design",
    "compare_scenarios",
    "run_code_checks",
    "get_system_info",
    "get_health",
    "get_metrics",
    "get_template_info",
    "convert_units",
    "get_units_catalog",
    "check_units_compatible",
    "list_component_profiles",
    "set_component_profile",
}
_TASK_TOOL_NAMES = {
    "execute_cell",
    "execute_all_cells",
    "resume_run",
    "optimize_design",
    "run_code_checks",
    "check_document_quality",
    "run_document_workbench",
    "compare_document_versions",
    "manage_document_review",
    "prepare_document_delivery",
    "get_document_pdf",
    "get_document_docx",
}


def _build_tool_annotations(tool_name: str) -> dict[str, Any]:
    annotations: dict[str, Any] = {
        "readOnlyHint": tool_name in _READ_ONLY_TOOL_NAMES,
        "idempotentHint": tool_name in _IDEMPOTENT_TOOL_NAMES,
        "openWorldHint": False,
    }
    if tool_name in _DESTRUCTIVE_TOOL_NAMES:
        annotations["destructiveHint"] = True
    return annotations


def _build_tool_tags(group: str, tool_name: str) -> set[str]:
    tags = {f"group:{group}"}
    if tool_name in _CORE_TOOL_NAMES:
        tags.add("profile:core")
    elif tool_name in _ADMIN_TOOL_NAMES:
        tags.add("profile:admin")
    elif group == "files":
        tags.add("profile:files")
    elif group == "analysis":
        tags.add("profile:analysis")
    else:
        tags.add("profile:authoring")
    return tags


def _build_task_config(tool_name: str) -> Any:
    if tool_name not in _TASK_TOOL_NAMES:
        return False
    if TaskConfig is None:
        return False
    poll_seconds = 5
    if tool_name in {"check_document_quality", "run_document_workbench", "compare_document_versions", "manage_document_review", "prepare_document_delivery", "get_document_pdf", "get_document_docx"}:
        poll_seconds = 2
    elif tool_name in {"execute_all_cells", "execute_cells", "execute_until"}:
        poll_seconds = 3
    return TaskConfig(mode="optional", poll_interval=timedelta(seconds=poll_seconds))


def _basename(path: str | None) -> str:
    if not path:
        return "unknown"
    normalized = str(path).replace("\\", "/").rstrip("/")
    return normalized.split("/")[-1] or normalized


def _drop_none(data: dict[str, Any]) -> dict[str, Any]:
    return {key: value for key, value in data.items() if value is not None}


def get_current_activity_context() -> dict[str, str | None]:
    return {
        "run_id": _CURRENT_RUN_ID.get(),
        "tool_name": _CURRENT_TOOL_NAME.get(),
        "tool_group": _CURRENT_TOOL_GROUP.get(),
    }


def _payload_from_call(fn: Callable[..., Any], args: tuple[Any, ...], kwargs: dict[str, Any]) -> dict[str, Any]:
    signature = inspect.signature(fn)
    bound = signature.bind_partial(*args, **kwargs)
    bound.apply_defaults()
    payload = dict(bound.arguments)
    nested_kwargs = payload.get("kwargs")
    if isinstance(nested_kwargs, dict):
        payload.pop("kwargs", None)
        for key, value in nested_kwargs.items():
            payload.setdefault(key, value)
    return payload


def _maybe_notebook_path(path: str | None) -> str | None:
    if not path:
        return None
    normalized = os.path.abspath(os.path.expanduser(path))
    if normalized.lower().endswith(".ipynb"):
        return normalized
    return None


def _derive_notebook_create_path(payload: dict[str, Any], result: Any) -> str | None:
    if isinstance(result, dict):
        resolved = result.get("path")
        if isinstance(resolved, str) and resolved:
            return os.path.abspath(os.path.expanduser(resolved))
    base_path = payload.get("path")
    if not isinstance(base_path, str) or not base_path:
        return None
    name = payload.get("name") or "Untitled.ipynb"
    return os.path.abspath(os.path.join(os.path.expanduser(base_path), str(name)))


def _extract_artifact(result: Any) -> dict[str, str]:
    def _coerce_artifact(source: Any) -> dict[str, str]:
        if not isinstance(source, dict):
            return {}

        artifact: dict[str, str] = {}
        pdf_ref = source.get("pdf_ref")
        docx_ref = source.get("docx_ref")
        pdf_token = source.get("pdf_file_token")
        docx_token = source.get("docx_file_token")
        pdf_hash = source.get("pdf_hash")
        docx_hash = source.get("docx_hash")

        if pdf_ref or pdf_token or pdf_hash:
            artifact["kind"] = "pdf"
            if pdf_token:
                artifact["token"] = str(pdf_token)
            if pdf_ref:
                artifact["ref"] = str(pdf_ref)
                artifact["pdf_ref"] = str(pdf_ref)
            if pdf_hash:
                artifact["pdf_hash"] = str(pdf_hash)
            return artifact

        if docx_ref or docx_token or docx_hash:
            artifact["kind"] = "docx"
            if docx_token:
                artifact["token"] = str(docx_token)
            if docx_ref:
                artifact["ref"] = str(docx_ref)
                artifact["docx_ref"] = str(docx_ref)
            if docx_hash:
                artifact["docx_hash"] = str(docx_hash)
            return artifact

        generic_token = source.get("token")
        if generic_token and source.get("kind") in {"pdf", "docx"}:
            artifact["kind"] = str(source["kind"])
            artifact["token"] = str(generic_token)
            ref = source.get("ref")
            if ref:
                artifact["ref"] = str(ref)
            if artifact["kind"] == "pdf" and source.get("pdf_hash"):
                artifact["pdf_hash"] = str(source["pdf_hash"])
            if artifact["kind"] == "docx" and source.get("docx_hash"):
                artifact["docx_hash"] = str(source["docx_hash"])
            return artifact

        return {}

    if not isinstance(result, dict):
        return {}

    sources: list[Any] = [result]
    raw = result.get("raw")
    if isinstance(raw, dict):
        sources.append(raw)
    artifacts = result.get("artifacts")
    if isinstance(artifacts, list):
        sources.extend(artifacts)

    outputs = result.get("outputs")
    if isinstance(outputs, dict):
        for payload in outputs.values():
            if isinstance(payload, dict):
                nested_artifacts = payload.get("artifacts")
                if isinstance(nested_artifacts, list):
                    sources.extend(nested_artifacts)

    for source in sources:
        artifact = _coerce_artifact(source)
        if artifact:
            return artifact

    return {}


def _build_resource(tool_name: str, payload: dict[str, Any], result: Any) -> dict[str, str]:
    resource: dict[str, str] = {}

    for key in ("path", "kernel_id", "cell_id", "execution_id", "run_id"):
        value = payload.get(key)
        if value is not None:
            resource[key] = str(value)
    if "run_id" in resource and "execution_id" not in resource:
        resource["execution_id"] = resource["run_id"]

    if "file_path" in payload and payload["file_path"] is not None:
        resource["path"] = os.path.abspath(os.path.expanduser(str(payload["file_path"])))

    if tool_name == "rename_file":
        new_path = payload.get("new_path")
        if new_path:
            expanded_new = os.path.expanduser(str(new_path))
            if os.path.isabs(expanded_new):
                resource["path"] = os.path.abspath(expanded_new)
            elif payload.get("old_path"):
                expanded_old = os.path.expanduser(str(payload["old_path"]))
                old_dir = os.path.dirname(expanded_old)
                if old_dir:
                    resource["path"] = os.path.normpath(
                        os.path.join(old_dir, os.path.basename(expanded_new))
                    )
                else:
                    resource["path"] = expanded_new
            else:
                resource["path"] = expanded_new
        elif payload.get("old_path"):
            resource["path"] = os.path.abspath(os.path.expanduser(str(payload["old_path"])))

    if tool_name == "notebook_create":
        created_path = _derive_notebook_create_path(payload, result)
        if created_path:
            resource["notebook_path"] = created_path
            resource["path"] = created_path

    notebook_path = payload.get("notebook_path")
    if notebook_path:
        resolved = os.path.abspath(os.path.expanduser(str(notebook_path)))
        resource["notebook_path"] = resolved
        resource.setdefault("path", resolved)

    arg_path = payload.get("path")
    if isinstance(arg_path, str) and arg_path:
        resolved = os.path.abspath(os.path.expanduser(arg_path))
        resource.setdefault("path", resolved)
        notebook_candidate = _maybe_notebook_path(resolved)
        if notebook_candidate:
            resource.setdefault("notebook_path", notebook_candidate)

    kernel_id = resource.get("kernel_id")
    if kernel_id and "notebook_path" not in resource:
        notebook_from_session = _SESSION_STATE.get_notebook_path(kernel_id)
        if notebook_from_session:
            resource["notebook_path"] = notebook_from_session

    if isinstance(result, dict):
        for key in ("path", "kernel_id", "cell_id", "execution_id", "run_id"):
            value = result.get(key)
            if value is not None:
                resource.setdefault(key, str(value))
        if "run_id" in resource and "execution_id" not in resource:
            resource["execution_id"] = resource["run_id"]

        if tool_name == "rename_file":
            rename_result_path = result.get("newPath") or result.get("path")
            if isinstance(rename_result_path, str) and rename_result_path:
                resource["path"] = os.path.abspath(os.path.expanduser(rename_result_path))

        result_path = result.get("path")
        if isinstance(result_path, str) and result_path:
            resolved = os.path.abspath(os.path.expanduser(result_path))
            resource["path"] = resolved
            notebook_candidate = _maybe_notebook_path(resolved)
            if notebook_candidate:
                resource["notebook_path"] = notebook_candidate

        if kernel_id and "notebook_path" not in resource:
            notebook_from_result = _SESSION_STATE.get_notebook_path(kernel_id)
            if notebook_from_result:
                resource["notebook_path"] = notebook_from_result

    return resource


def _build_summary(tool_name: str, payload: dict[str, Any]) -> str:
    if tool_name == "list_files":
        raw_path = str(payload.get("path") or ".").strip()
        if raw_path in {"", "."}:
            return "Listing workspace root"
        return f"Listing workspace {_basename(raw_path)}"
    if tool_name == "read_file":
        return f"Reading {_basename(str(payload.get('path') or 'file'))}"
    if tool_name == "write_file":
        return f"Writing {_basename(str(payload.get('path') or 'file'))}"
    if tool_name == "create_file":
        kind = "folder" if payload.get("is_directory") else "file"
        return f"Creating {kind} {_basename(str(payload.get('path') or kind))}"
    if tool_name == "delete_file":
        return f"Deleting {_basename(str(payload.get('path') or 'file'))}"
    if tool_name == "rename_file":
        return f"Renaming {_basename(str(payload.get('old_path') or 'file'))}"
    if tool_name == "notebook_create":
        return f"Creating notebook {_basename(str(payload.get('name') or 'Untitled.ipynb'))}"
    if tool_name == "notebook_load":
        return f"Loading notebook {_basename(str(payload.get('path') or 'notebook.ipynb'))}"
    if tool_name == "notebook_sync_cells":
        return f"Syncing notebook cells in {_basename(str(payload.get('notebook_path') or 'notebook.ipynb'))}"
    if tool_name == "create_kernel":
        return "Creating notebook kernel"
    if tool_name == "attach_kernel":
        return f"Attaching kernel to {_basename(str(payload.get('notebook_path') or 'notebook.ipynb'))}"
    if tool_name == "notebook_save":
        return "Saving notebook"
    if tool_name == "execute_cell":
        return f"Executing cell {payload.get('cell_id') or 'cell'}"
    if tool_name == "execute_all_cells":
        return f"Executing notebook {_basename(str(payload.get('notebook_path') or 'notebook.ipynb'))}"
    if tool_name == "list_session_notebooks":
        return "Listing MCP session notebooks"
    if tool_name == "execute_cells":
        return f"Executing selected cells in {_basename(str(payload.get('notebook_path') or 'notebook.ipynb'))}"
    if tool_name == "execute_until":
        return f"Executing notebook until {payload.get('cell_id') or 'cell'}"
    if tool_name == "list_cells":
        return f"Listing cells in {_basename(str(payload.get('notebook_path') or 'notebook.ipynb'))}"
    if tool_name == "get_cell":
        return f"Reading cell {payload.get('cell_id') or 'cell'}"
    if tool_name == "find_in_notebook":
        return f"Searching {_basename(str(payload.get('notebook_path') or 'notebook.ipynb'))}"
    if tool_name == "get_kernel_status":
        return "Checking kernel status"
    if tool_name == "get_run_status":
        return "Checking run status"
    if tool_name == "cancel_run":
        return "Cancelling notebook run"
    if tool_name == "resume_run":
        return "Resuming notebook run"
    if tool_name == "add_cell":
        return f"Adding cell to {_basename(str(payload.get('notebook_path') or 'notebook.ipynb'))}"
    if tool_name == "delete_cell":
        return f"Deleting cell {payload.get('cell_id') or 'cell'}"
    if tool_name == "edit_cell":
        return f"Editing cell {payload.get('cell_id') or 'cell'}"
    if tool_name == "move_cell":
        return f"Moving cell {payload.get('cell_id') or 'cell'}"
    if tool_name == "reset_kernel":
        return "Resetting notebook kernel"
    if tool_name == "interrupt_kernel":
        return "Interrupting notebook kernel"
    if tool_name == "shutdown_kernel":
        return "Shutting down notebook kernel"
    if tool_name == "close_session_notebook":
        return "Closing notebook session"
    if tool_name == "kernel_status":
        return "Checking kernel status"
    if tool_name == "execution_status":
        return "Checking execution status"
    if tool_name == "get_variables":
        return f"Collecting variables for cell {payload.get('cell_id') or 'cell'}"
    if tool_name == "get_document_pdf":
        return "Downloading notebook PDF"
    if tool_name == "get_document_docx":
        return "Downloading notebook DOCX"
    if tool_name == "check_document_quality":
        if payload.get("run"):
            return "Running DOCX quality audit"
        return "Reading DOCX quality summary"
    if tool_name == "run_document_workbench":
        return f"Running DOCX Workbench operation {payload.get('operation') or 'audit'}"
    if tool_name == "compare_document_versions":
        return "Comparing DOCX versions"
    if tool_name == "manage_document_review":
        return f"Managing DOCX review {payload.get('action') or 'comments_extract'}"
    if tool_name == "prepare_document_delivery":
        return f"Preparing DOCX delivery {_basename(str(payload.get('path') or 'document.docx'))}"
    if tool_name == "export_document_pdf":
        return f"Exporting notebook PDF to {_basename(str(payload.get('path') or 'document.pdf'))}"
    if tool_name == "export_document_docx":
        return f"Exporting notebook DOCX to {_basename(str(payload.get('path') or 'document.docx'))}"
    if tool_name == "export_clean_document_docx":
        return f"Exporting clean DOCX to {_basename(str(payload.get('path') or 'document.docx'))}"
    if tool_name == "reconvert_pdf":
        return "Regenerating notebook PDF"
    if tool_name == "upload_template":
        return f"Uploading template {_basename(str(payload.get('file_path') or 'template.docx'))}"
    if tool_name == "get_template_info":
        return "Reading template metadata"
    if tool_name == "delete_template":
        return "Deleting active template"
    if tool_name == "update_template_style":
        return f"Updating template style {payload.get('style_name') or 'style'}"
    if tool_name == "convert_units":
        return f"Converting {payload.get('from_unit') or 'unit'} to {payload.get('to_unit') or 'unit'}"
    if tool_name == "get_units_catalog":
        return "Loading units catalog"
    if tool_name == "check_units_compatible":
        return f"Checking units {payload.get('unit_a') or 'A'} vs {payload.get('unit_b') or 'B'}"
    if tool_name == "analyze_dependencies":
        return f"Analyzing dependencies for {payload.get('symbol') or 'symbol'}"
    if tool_name == "analyze_impact":
        return f"Analyzing impact for {payload.get('symbol') or 'symbol'}"
    if tool_name == "run_sensitivity":
        return "Running sensitivity analysis"
    if tool_name == "optimize_design":
        return "Optimizing engineering design"
    if tool_name == "compare_scenarios":
        return "Comparing engineering scenarios"
    if tool_name == "run_code_checks":
        return "Running engineering code checks"
    if tool_name == "get_system_info":
        return "Reading Inspyro system info"
    if tool_name == "get_health":
        return "Checking backend health"
    if tool_name == "get_metrics":
        return "Reading backend metrics"
    if tool_name == "get_pdf_status":
        return "Checking PDF conversion status"
    return tool_name.replace("_", " ").strip().capitalize()


def _build_detail(result: Any) -> str | None:
    if not isinstance(result, dict):
        return None
    status = result.get("status")
    message = result.get("message")
    if isinstance(message, str) and message.strip():
        return message.strip()
    if status is not None:
        return f"status={status}"
    return None


def _build_ui_hints(group: str, tool_name: str, resource: dict[str, str], result: Any) -> dict[str, Any]:
    if group in {"analysis", "units", "system"}:
        return {}

    reload_path = resource.get("path") or resource.get("notebook_path")
    hints: dict[str, Any] = {}

    if tool_name in _FILE_MUTATION_TOOLS:
        hints["refresh_workspace"] = True
        if reload_path:
            hints["reload_path"] = reload_path
        return hints

    if tool_name in _NOTEBOOK_MUTATION_TOOLS:
        hints["show_agent_execution"] = True
        if reload_path:
            hints["reload_path"] = reload_path
        artifact = _extract_artifact(result)
        if artifact:
            hints["refresh_preview"] = True
            hints["artifact"] = artifact
        return hints

    if tool_name in _TEMPLATE_MUTATION_TOOLS:
        hints["refresh_preview"] = True
        if resource.get("notebook_path"):
            hints["reload_path"] = resource["notebook_path"]
        return hints

    if tool_name in _DOCUMENT_MUTATION_TOOLS:
        hints["refresh_preview"] = True
        if resource.get("notebook_path"):
            hints["reload_path"] = resource["notebook_path"]
        artifact = _extract_artifact(result)
        if artifact:
            hints["artifact"] = artifact
        return hints

    return {}


class McpActivityReporter:
    _instance: "McpActivityReporter | None" = None

    @classmethod
    def get(cls) -> "McpActivityReporter":
        if cls._instance is None:
            cls._instance = cls()
        return cls._instance

    async def report(self, event: dict[str, Any]) -> None:
        bridge = InspyroBridge.get()
        try:
            await bridge.rest_post("/api/mcp/activity/events", json_data=event)
        except Exception as exc:  # pragma: no cover - best effort reporting
            logger.debug("MCP activity event dropped: %s", exc)


def mcp_activity_tool(group: str) -> Callable[[Callable[..., Any]], Callable[..., Any]]:
    """Register a FastMCP tool and emit structured UI activity events."""

    def decorator(fn: Callable[..., Any]) -> Callable[..., Any]:
        tool_name = fn.__name__
        annotations = _build_tool_annotations(tool_name)
        tags = _build_tool_tags(group, tool_name)
        task_config = _build_task_config(tool_name)

        @wraps(fn)
        async def wrapped(*args: Any, **kwargs: Any) -> Any:
            payload = _payload_from_call(fn, args, kwargs)
            resource = _build_resource(tool_name, payload, None)
            reporter = McpActivityReporter.get()
            run_id = f"mcp_run_{tool_name}_{uuid.uuid4().hex[:10]}"

            start_event = _drop_none(
                {
                    "run_id": run_id,
                    "phase": "started",
                    "status": "running",
                    "tool_name": tool_name,
                    "tool_group": group,
                    "summary": _build_summary(tool_name, payload),
                    "resource": resource,
                    "ui_hints": _build_ui_hints(group, tool_name, resource, None),
                    "client_id": resolve_session_id(),
                    "transport": config.MCP_RUNTIME_TRANSPORT,
                }
            )
            await reporter.report(start_event)

            started_at = time.perf_counter()
            run_token = _CURRENT_RUN_ID.set(run_id)
            tool_name_token = _CURRENT_TOOL_NAME.set(tool_name)
            tool_group_token = _CURRENT_TOOL_GROUP.set(group)
            try:
                result = await fn(*args, **kwargs)
            except Exception as exc:
                duration_ms = int((time.perf_counter() - started_at) * 1000)
                failed_event = _drop_none(
                    {
                        "run_id": run_id,
                        "phase": "failed",
                        "status": "error",
                        "tool_name": tool_name,
                        "tool_group": group,
                        "summary": _build_summary(tool_name, payload),
                        "detail": exc.__class__.__name__,
                        "duration_ms": duration_ms,
                        "error": str(exc),
                        "resource": resource,
                        "ui_hints": _build_ui_hints(group, tool_name, resource, None),
                        "client_id": resolve_session_id(),
                        "transport": config.MCP_RUNTIME_TRANSPORT,
                    }
                )
                await reporter.report(failed_event)
                raise
            finally:
                _CURRENT_RUN_ID.reset(run_token)
                _CURRENT_TOOL_NAME.reset(tool_name_token)
                _CURRENT_TOOL_GROUP.reset(tool_group_token)

            duration_ms = int((time.perf_counter() - started_at) * 1000)
            completion_resource = _build_resource(tool_name, payload, result)
            completed_event = _drop_none(
                {
                    "run_id": run_id,
                    "phase": "completed",
                    "status": "success",
                    "tool_name": tool_name,
                    "tool_group": group,
                    "summary": _build_summary(tool_name, payload),
                    "detail": _build_detail(result),
                    "duration_ms": duration_ms,
                    "resource": completion_resource,
                    "ui_hints": _build_ui_hints(group, tool_name, completion_resource, result),
                    "client_id": resolve_session_id(),
                    "transport": config.MCP_RUNTIME_TRANSPORT,
                }
            )
            await reporter.report(completed_event)
            return result

        tool_kwargs = {
            "name": tool_name,
            "annotations": annotations,
            "tags": sorted(tags),
            "task": task_config,
            "meta": {
                "inspyro_group": group,
                "inspyro_default_profile": (
                    "core"
                    if tool_name in _CORE_TOOL_NAMES
                    else "admin"
                    if tool_name in _ADMIN_TOOL_NAMES
                    else "files"
                    if group == "files"
                    else "analysis"
                    if group == "analysis"
                    else "authoring"
                ),
                "inspyro_profile_scope": "session",
            },
        }
        try:
            return mcp.tool(**tool_kwargs)(wrapped)
        except TypeError:
            tool_kwargs.pop("meta", None)
            try:
                return mcp.tool(**tool_kwargs)(wrapped)
            except TypeError:
                tool_kwargs.pop("task", None)
                tool_kwargs.pop("tags", None)
                tool_kwargs.pop("annotations", None)
                return mcp.tool(**tool_kwargs)(wrapped)

    return decorator
