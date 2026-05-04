"""Runtime helpers for FastMCP context-dependent behavior.

These helpers centralize optional FastMCP APIs so the rest of the codebase can
consume session, roots, progress, and visibility features without scattering
version-specific imports everywhere.
"""

from __future__ import annotations

import asyncio
import inspect
import logging
import os
from pathlib import Path
from typing import Any, Iterable
from urllib.parse import unquote, urlparse

logger = logging.getLogger("inspyro.mcp.runtime")

try:  # pragma: no cover - exercised in MCP runtime, not unit tests
    from fastmcp.server.context import Context
    from fastmcp.server.dependencies import get_context
except Exception:  # pragma: no cover - local test env may not have FastMCP
    Context = Any  # type: ignore[assignment]
    get_context = None  # type: ignore[assignment]


DEFAULT_SESSION_ID = "__global__"
ROOTS_REQUEST_TIMEOUT_S = max(0.1, float(os.getenv("INSPYRO_MCP_ROOTS_TIMEOUT", "1.0")))
_TOOL_PROFILE_TAGS = {
    "profile:core",
    "profile:authoring",
    "profile:analysis",
    "profile:files",
    "profile:admin",
}


async def _maybe_await(value: Any) -> Any:
    if inspect.isawaitable(value):
        return await value
    return value


def get_current_context() -> Any | None:
    """Return the active FastMCP request context when available."""
    if get_context is None:
        return None
    try:
        return get_context()
    except Exception:
        return None


def resolve_session_id(session_id: str | None = None) -> str:
    """Resolve the effective MCP session id, falling back to a global bucket."""
    if session_id:
        return str(session_id).strip() or DEFAULT_SESSION_ID

    ctx = get_current_context()
    if ctx is None:
        return DEFAULT_SESSION_ID

    candidate = getattr(ctx, "session_id", None)
    if callable(candidate):
        try:
            candidate = candidate()
        except Exception:
            candidate = None
    if candidate:
        return str(candidate).strip() or DEFAULT_SESSION_ID
    return DEFAULT_SESSION_ID


def _coerce_root_path(value: Any) -> str | None:
    text = str(value or "").strip()
    if not text:
        return None
    if text.startswith("file://"):
        parsed = urlparse(text)
        path = unquote(parsed.path or "")
        if parsed.netloc and parsed.netloc not in {"", "localhost"}:
            path = f"//{parsed.netloc}{path}"
        if os.name == "nt" and path.startswith("/") and len(path) >= 3 and path[2] == ":":
            path = path[1:]
        return os.path.abspath(path)
    return os.path.abspath(os.path.expanduser(text))


async def list_root_paths() -> list[str]:
    """Return normalized filesystem roots declared by the active MCP client."""
    ctx = get_current_context()
    if ctx is None or not hasattr(ctx, "list_roots"):
        return []
    try:
        roots = await asyncio.wait_for(
            _maybe_await(ctx.list_roots()),
            timeout=ROOTS_REQUEST_TIMEOUT_S,
        )
    except asyncio.TimeoutError:
        logger.debug("Timed out listing client roots; continuing without root constraints.")
        return []
    except Exception as exc:  # pragma: no cover - best effort
        logger.debug("Could not list client roots: %s", exc)
        return []

    normalized: list[str] = []
    for root in roots or []:
        candidate = None
        if isinstance(root, dict):
            candidate = root.get("uri") or root.get("path")
        else:
            candidate = getattr(root, "uri", None) or getattr(root, "path", None)
        resolved = _coerce_root_path(candidate)
        if resolved and resolved not in normalized:
            normalized.append(resolved)
    return normalized


def is_within_any_root(path: str, roots: Iterable[str]) -> bool:
    normalized = os.path.normcase(os.path.abspath(path))
    for root in roots:
        normalized_root = os.path.normcase(os.path.abspath(root))
        try:
            common = os.path.commonpath([normalized, normalized_root])
        except ValueError:
            continue
        if common == normalized_root:
            return True
    return False


def select_default_root(workspace_root: str, roots: Iterable[str]) -> str | None:
    """Pick a safe default path when the host exposes narrower roots."""
    normalized_workspace = os.path.abspath(os.path.expanduser(workspace_root))
    normalized_roots = [os.path.abspath(os.path.expanduser(root)) for root in roots]
    if not normalized_roots:
        return normalized_workspace

    if is_within_any_root(normalized_workspace, normalized_roots):
        return normalized_workspace

    candidates = [
        root
        for root in normalized_roots
        if is_within_any_root(root, [normalized_workspace])
    ]
    if candidates:
        return sorted(
            set(candidates),
            key=lambda candidate: (len(Path(candidate).parts), os.path.normcase(candidate)),
        )[0]
    return None


async def report_progress(progress: int | float, total: int | float | None = None, message: str | None = None) -> None:
    """Report progress to the active MCP client when supported."""
    ctx = get_current_context()
    if ctx is None or not hasattr(ctx, "report_progress"):
        return
    try:
        await _maybe_await(ctx.report_progress(progress=progress, total=total, message=message))
    except TypeError:
        # Older signatures may not accept message.
        try:
            await _maybe_await(ctx.report_progress(progress=progress, total=total))
        except Exception as exc:  # pragma: no cover - best effort
            logger.debug("Progress update failed: %s", exc)
    except Exception as exc:  # pragma: no cover - best effort
        logger.debug("Progress update failed: %s", exc)


async def log_info(message: str) -> None:
    ctx = get_current_context()
    if ctx is None or not hasattr(ctx, "info"):
        return
    try:
        await _maybe_await(ctx.info(message))
    except Exception as exc:  # pragma: no cover - best effort
        logger.debug("Client log failed: %s", exc)


async def set_session_profile(profile: str, tags: set[str]) -> bool:
    """Apply tag-based visibility to the active session when supported."""
    ctx = get_current_context()
    if ctx is None or not hasattr(ctx, "enable_components"):
        return False
    try:
        if hasattr(ctx, "disable_components"):
            await _maybe_await(ctx.enable_components(tags=_TOOL_PROFILE_TAGS, components={"tool"}))
            hidden_tags = _TOOL_PROFILE_TAGS.difference(tags)
            if hidden_tags:
                await _maybe_await(ctx.disable_components(tags=hidden_tags, components={"tool"}))
        else:
            await _maybe_await(ctx.enable_components(tags=tags, only=True))
        await _maybe_await(ctx.set_state("component_profile", profile))
        return True
    except Exception as exc:  # pragma: no cover - best effort
        logger.debug("Could not apply session profile '%s': %s", profile, exc)
        return False


async def get_session_profile(default: str = "all") -> str:
    ctx = get_current_context()
    if ctx is None or not hasattr(ctx, "get_state"):
        return default
    try:
        value = await _maybe_await(ctx.get_state("component_profile"))
    except Exception:
        return default
    text = str(value or "").strip()
    return text or default


def build_artifact_resource_uri(kind: str, kernel_id: str, execution_id: str | None = None) -> str:
    safe_kind = str(kind or "artifact").strip().lower()
    safe_kernel = str(kernel_id or "").strip()
    if execution_id:
        return f"inspyro://artifacts/{safe_kernel}/{safe_kind}/{str(execution_id).strip()}"
    return f"inspyro://artifacts/{safe_kernel}/{safe_kind}"


def build_portable_artifact_resource_uri(kind: str, token: str) -> str:
    safe_kind = str(kind or "artifact").strip().lower()
    safe_token = str(token or "").strip()
    return f"inspyro://artifacts/token/{safe_kind}/{safe_token}"


def normalize_template_path(path: str) -> str:
    return str(Path(path).expanduser().resolve())
