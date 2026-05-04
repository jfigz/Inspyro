"""Dynamic MCP completions for prompts and resource templates."""

from __future__ import annotations

import logging
import os
from pathlib import Path
from typing import Any

import mcp.types as mcp_types

from .bridge import InspyroBridge
from .runtime import resolve_session_id
from .session_state import McpSessionState
from .tools import files as file_tools
from .tools import notebook as notebook_tools

logger = logging.getLogger("inspyro.mcp.completions")

_SESSION_STATE = McpSessionState.get()
_SKIP_DIRS = {
    ".git",
    ".hg",
    ".svn",
    ".mypy_cache",
    ".pytest_cache",
    ".ruff_cache",
    ".tox",
    "__pycache__",
    "build",
    "dist",
    "node_modules",
    "venv",
    "venv_inspyro",
}
_MAX_COMPLETION_VALUES = 25
_MAX_SCAN_RESULTS = 64
_MAX_SCAN_DEPTH = 5
_UNIT_TOKENS_CACHE: list[str] | None = None


def _normalize_text(value: Any) -> str:
    return str(value or "").strip()


def _normalize_path_text(value: Any) -> str:
    return _normalize_text(value).replace("\\", "/")


def _dedupe(values: list[str]) -> list[str]:
    result: list[str] = []
    seen: set[str] = set()
    for value in values:
        text = _normalize_text(value)
        if not text or text in seen:
            continue
        seen.add(text)
        result.append(text)
    return result


def _matches_prefix(value: str, prefix: str) -> bool:
    normalized_value = value.casefold()
    normalized_prefix = prefix.casefold()
    if not normalized_prefix:
        return True
    if normalized_value.startswith(normalized_prefix):
        return True
    base_name = normalized_value.rsplit("/", 1)[-1]
    return base_name.startswith(normalized_prefix)


def _format_completion_path(path: str, root: str | None, prefix: str) -> str:
    normalized_path = os.path.abspath(path)
    absolute_mode = os.path.isabs(os.path.expanduser(prefix or ""))
    if absolute_mode or not root:
        return Path(normalized_path).as_posix()
    try:
        relative = os.path.relpath(normalized_path, root)
    except ValueError:
        return Path(normalized_path).as_posix()
    return Path(relative).as_posix()


def _scan_workspace_paths(
    root: str,
    prefix: str,
    *,
    include_files: bool,
    include_dirs: bool,
    suffixes: tuple[str, ...] | None = None,
) -> list[str]:
    if not root or not os.path.isdir(root):
        return []

    normalized_root = os.path.abspath(root)
    normalized_prefix = _normalize_path_text(prefix)
    results: list[str] = []

    for current_dir, dirnames, filenames in os.walk(normalized_root):
        relative_dir = os.path.relpath(current_dir, normalized_root)
        depth = 0 if relative_dir == "." else len(Path(relative_dir).parts)
        dirnames[:] = [
            name
            for name in dirnames
            if name not in _SKIP_DIRS and depth < _MAX_SCAN_DEPTH
        ]

        if include_dirs:
            for dirname in dirnames:
                candidate_path = os.path.join(current_dir, dirname)
                completion_value = _format_completion_path(candidate_path, normalized_root, prefix)
                if _matches_prefix(completion_value, normalized_prefix):
                    results.append(completion_value)
                    if len(results) >= _MAX_SCAN_RESULTS:
                        return _dedupe(sorted(results))

        if not include_files:
            continue

        for filename in filenames:
            if suffixes and not filename.lower().endswith(suffixes):
                continue
            candidate_path = os.path.join(current_dir, filename)
            completion_value = _format_completion_path(candidate_path, normalized_root, prefix)
            if _matches_prefix(completion_value, normalized_prefix):
                results.append(completion_value)
                if len(results) >= _MAX_SCAN_RESULTS:
                    return _dedupe(sorted(results))

    return _dedupe(sorted(results))


def _build_completion(values: list[str]) -> mcp_types.Completion:
    deduped = _dedupe(values)
    limited = deduped[:_MAX_COMPLETION_VALUES]
    has_more = len(deduped) > len(limited)
    return mcp_types.Completion(values=limited, total=len(deduped), hasMore=has_more)


def _context_arguments(context: Any) -> dict[str, str]:
    if isinstance(context, dict):
        arguments = context.get("arguments")
        if isinstance(arguments, dict):
            return {str(key): _normalize_text(value) for key, value in arguments.items()}
        return {
            str(key): _normalize_text(value)
            for key, value in context.items()
            if key not in {"type", "ref"}
        }
    arguments = getattr(context, "arguments", None)
    if isinstance(arguments, dict):
        return {str(key): _normalize_text(value) for key, value in arguments.items()}
    return {}


async def _workspace_root(bridge: InspyroBridge) -> str | None:
    try:
        return await file_tools._get_default_workspace_root(bridge)
    except Exception as exc:
        logger.debug("Could not resolve workspace root for completions: %s", exc)
        return None


async def _notebook_path_candidates(bridge: InspyroBridge, prefix: str, *, session_id: str) -> list[str]:
    root = await _workspace_root(bridge)
    values: list[str] = []
    for notebook_path in _SESSION_STATE.list_notebook_paths(session_id=session_id):
        completion_value = _format_completion_path(notebook_path, root, prefix)
        if _matches_prefix(completion_value, _normalize_path_text(prefix)):
            values.append(completion_value)
    if not values:
        for notebook_path in _SESSION_STATE.list_notebook_paths_any():
            completion_value = _format_completion_path(notebook_path, root, prefix)
            if _matches_prefix(completion_value, _normalize_path_text(prefix)):
                values.append(completion_value)
    if root:
        values.extend(
            _scan_workspace_paths(
                root,
                prefix,
                include_files=True,
                include_dirs=False,
                suffixes=(".ipynb",),
            )
        )
    return _dedupe(values)


async def _workspace_path_candidates(
    bridge: InspyroBridge,
    prefix: str,
    *,
    files_only: bool = False,
    notebooks_only: bool = False,
) -> list[str]:
    root = await _workspace_root(bridge)
    if not root:
        return []
    suffixes = (".ipynb",) if notebooks_only else None
    return _scan_workspace_paths(
        root,
        prefix,
        include_files=True,
        include_dirs=not files_only,
        suffixes=suffixes,
    )


async def _cell_id_candidates(
    bridge: InspyroBridge,
    prefix: str,
    *,
    notebook_path: str | None,
    session_id: str,
) -> list[str]:
    target_path = _normalize_text(notebook_path)
    if not target_path:
        session_paths = _SESSION_STATE.list_notebook_paths(session_id=session_id)
        if len(session_paths) == 1:
            target_path = session_paths[0]
    if not target_path:
        return []

    try:
        resolved_path = await file_tools._resolve_workspace_path(bridge, target_path)
        notebook_payload = await notebook_tools._read_notebook(bridge, resolved_path)
    except Exception as exc:
        logger.debug("Could not resolve notebook cell completions for %s: %s", target_path, exc)
        return []

    values: list[str] = []
    for cell in notebook_payload.get("cells", []) or []:
        cell_id = _normalize_text(cell.get("id"))
        if cell_id and _matches_prefix(cell_id, prefix):
            values.append(cell_id)
    return _dedupe(values)


async def _unit_token_candidates(bridge: InspyroBridge, prefix: str) -> list[str]:
    global _UNIT_TOKENS_CACHE

    if _UNIT_TOKENS_CACHE is None:
        try:
            payload = await bridge.rest_get("/api/units/catalog")
        except Exception as exc:
            logger.debug("Could not read unit catalog for completions: %s", exc)
            return []

        raw_units = payload.get("units", payload) if isinstance(payload, dict) else payload
        tokens: list[str] = []
        if isinstance(raw_units, list):
            for entry in raw_units:
                if not isinstance(entry, dict):
                    continue
                aliases = entry.get("aliases", [])
                candidates = [
                    entry.get("canonical"),
                    entry.get("display"),
                    entry.get("symbol"),
                    entry.get("pint"),
                    entry.get("pint_symbol"),
                ]
                if isinstance(aliases, list):
                    candidates.extend(aliases)
                for candidate in candidates:
                    text = _normalize_text(candidate)
                    if text:
                        tokens.append(text)
        _UNIT_TOKENS_CACHE = _dedupe(tokens)

    return [token for token in (_UNIT_TOKENS_CACHE or []) if _matches_prefix(token, prefix)]


async def _activity_resource_candidates(
    bridge: InspyroBridge,
    prefix: str,
    *,
    resource_key: str,
) -> list[str]:
    try:
        payload = await bridge.rest_get("/api/mcp/activity", params={"limit": 200})
    except Exception as exc:
        logger.debug("Could not read MCP activity for completions: %s", exc)
        return []

    values: list[str] = []

    def _consume(items: Any) -> None:
        if not isinstance(items, list):
            return
        for item in items:
            if not isinstance(item, dict):
                continue
            resource = item.get("resource")
            if not isinstance(resource, dict):
                continue
            candidate = _normalize_text(resource.get(resource_key))
            if candidate and _matches_prefix(candidate, prefix):
                values.append(candidate)

    _consume(payload.get("events"))
    _consume(payload.get("active_runs"))
    return _dedupe(values)


def _extract_template_style_names(template: Any) -> list[str]:
    if not isinstance(template, dict):
        return []
    raw_styles = template.get("styles")
    if not isinstance(raw_styles, list):
        return []
    values: list[str] = []
    for style in raw_styles:
        if isinstance(style, dict):
            candidate = style.get("name") or style.get("style_name") or style.get("id")
        else:
            candidate = style
        text = _normalize_text(candidate)
        if text:
            values.append(text)
    return _dedupe(values)


async def _style_name_candidates(prefix: str, *, kernel_id: str | None, session_id: str) -> list[str]:
    bridge = InspyroBridge.get()
    normalized_kernel_id = _normalize_text(kernel_id) or None
    values = _SESSION_STATE.list_template_styles(
        kernel_id=normalized_kernel_id,
        session_id=session_id,
    )
    if not values:
        values = _SESSION_STATE.list_template_styles_any(kernel_id=normalized_kernel_id)
    if not values and normalized_kernel_id:
        try:
            result = await bridge.ws_request(
                "template_get",
                {"kernel_id": normalized_kernel_id},
                success_types={"template_info"},
                error_types={"template_error"},
                timeout=10,
            )
        except Exception as exc:
            logger.debug("Could not resolve template styles for completions: %s", exc)
        else:
            values = _extract_template_style_names(result.get("template"))
    return [value for value in values if _matches_prefix(value, prefix)]


async def _kernel_id_candidates(prefix: str, *, session_id: str) -> list[str]:
    bridge = InspyroBridge.get()
    values = _SESSION_STATE.list_kernel_ids(session_id=session_id)
    if not values:
        values = _SESSION_STATE.list_kernel_ids_any()
    if not values:
        values = await _activity_resource_candidates(bridge, prefix, resource_key="kernel_id")
    return [kernel_id for kernel_id in values if _matches_prefix(kernel_id, prefix)]


async def _execution_id_candidates(prefix: str, *, session_id: str) -> list[str]:
    bridge = InspyroBridge.get()
    values = _SESSION_STATE.list_execution_ids(session_id=session_id)
    if not values:
        values = _SESSION_STATE.list_execution_ids_any()
    if not values:
        values = await _activity_resource_candidates(bridge, prefix, resource_key="execution_id")
    return [execution_id for execution_id in values if _matches_prefix(execution_id, prefix)]


async def _complete_prompt(
    ref: mcp_types.PromptReference,
    argument: mcp_types.CompletionArgument,
    context_arguments: dict[str, str],
    *,
    session_id: str,
) -> list[str]:
    bridge = InspyroBridge.get()
    argument_name = _normalize_text(argument.name)
    prefix = _normalize_text(argument.value)
    prompt_name = _normalize_text(ref.name)

    if prompt_name in {"review_notebook", "recover_mcp_notebook_session"} and argument_name == "notebook_path":
        return await _notebook_path_candidates(bridge, prefix, session_id=session_id)

    if prompt_name == "recover_mcp_notebook_session" and argument_name == "kernel_id":
        return await _kernel_id_candidates(prefix, session_id=session_id)

    if prompt_name == "recover_mcp_notebook_session" and argument_name == "style_name":
        kernel_id = context_arguments.get("kernel_id")
        return await _style_name_candidates(prefix, kernel_id=kernel_id, session_id=session_id)

    if prompt_name == "unit_conversion_help" and argument_name in {"from_unit", "to_unit"}:
        return await _unit_token_candidates(bridge, prefix)

    return []


async def _complete_resource_template(
    ref: mcp_types.ResourceTemplateReference,
    argument: mcp_types.CompletionArgument,
    context_arguments: dict[str, str],
    *,
    session_id: str,
) -> list[str]:
    bridge = InspyroBridge.get()
    argument_name = _normalize_text(argument.name)
    prefix = _normalize_text(argument.value)
    uri = _normalize_text(ref.uri)

    if uri == "inspyro://workspace/tree/{path*}" and argument_name == "path":
        return await _workspace_path_candidates(bridge, prefix)

    if uri == "inspyro://workspace/file/{path*}" and argument_name == "path":
        return await _workspace_path_candidates(bridge, prefix, files_only=True)

    if uri == "inspyro://notebooks/{path*}/cells/{cell_id}":
        if argument_name == "path":
            return await _workspace_path_candidates(bridge, prefix, notebooks_only=True)
        if argument_name == "cell_id":
            return await _cell_id_candidates(
                bridge,
                prefix,
                notebook_path=context_arguments.get("path") or context_arguments.get("notebook_path"),
                session_id=session_id,
            )

    if uri in {
        "inspyro://artifacts/{kernel_id}/{kind}",
        "inspyro://artifacts/{kernel_id}/{kind}/{execution_id}",
    }:
        if argument_name == "kernel_id":
            return await _kernel_id_candidates(prefix, session_id=session_id)
        if argument_name == "kind":
            return [value for value in ("docx", "pdf") if _matches_prefix(value, prefix)]
        if argument_name == "execution_id":
            return await _execution_id_candidates(prefix, session_id=session_id)

    if uri == "inspyro://artifacts/token/{kind}/{token}":
        if argument_name == "kind":
            return [value for value in ("docx", "pdf") if _matches_prefix(value, prefix)]

    if uri == "inspyro://runs/{run_id}" and argument_name == "run_id":
        return await _execution_id_candidates(prefix, session_id=session_id)

    return []


def register_completion_handler(mcp_server: Any) -> None:
    lowlevel_server = getattr(mcp_server, "_mcp_server", None)
    completion_factory = getattr(lowlevel_server, "completion", None)
    if not callable(completion_factory):
        logger.debug("FastMCP runtime does not expose low-level completion registration.")
        return
    if getattr(mcp_server, "_inspyro_completion_registered", False):
        return

    @completion_factory()
    async def complete(
        ref: mcp_types.PromptReference | mcp_types.ResourceTemplateReference,
        argument: mcp_types.CompletionArgument,
        context: mcp_types.CompletionContext | None,
    ) -> mcp_types.Completion | None:
        session_id = resolve_session_id()
        effective_session_id = _SESSION_STATE.resolve_known_session_id(session_id) or session_id
        context_arguments = _context_arguments(context)

        try:
            if isinstance(ref, mcp_types.PromptReference):
                values = await _complete_prompt(
                    ref,
                    argument,
                    context_arguments,
                    session_id=effective_session_id,
                )
            elif isinstance(ref, mcp_types.ResourceTemplateReference):
                values = await _complete_resource_template(
                    ref,
                    argument,
                    context_arguments,
                    session_id=effective_session_id,
                )
            else:
                values = []
        except Exception as exc:  # pragma: no cover - completion must stay best-effort
            logger.debug("Completion handler failed for %s.%s: %s", ref, argument.name, exc)
            values = []

        return _build_completion(values)

    setattr(mcp_server, "_inspyro_completion_registered", True)
