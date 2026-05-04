from __future__ import annotations

import base64
import io
import hashlib
import json
import logging
import os
import secrets
import threading
import time
import zipfile
import xml.etree.ElementTree as ET
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Optional
from urllib.parse import urlencode

from app.services.docx_render_cache import get_docx_render_manifest
from app.services.docx_sanitizer import sanitize_docx_bytes_for_delivery
from app.services.workspace_service import get_app_storage_dir, get_workspace_snapshot

DOCX_ARTIFACT_RETENTION_DAYS = max(1, int(os.getenv("INSPYRO_DOCX_HISTORY_RETENTION_DAYS", "30")))
DOCX_ARTIFACT_RETENTION_SECONDS = DOCX_ARTIFACT_RETENTION_DAYS * 24 * 60 * 60
DOCX_ARTIFACT_CLEANUP_INTERVAL_SECONDS = max(
    1,
    int(os.getenv("INSPYRO_DOCX_HISTORY_SCAN_INTERVAL", "300")),
)
DOCX_EMPTY_HISTORY_WARNING = "DOCX vacío detectado; esta versión se mantiene solo para referencia y no se usará como documento actual."

_DOCX_W_NS = "http://schemas.openxmlformats.org/wordprocessingml/2006/main"
_DOCX_BODY_TAG = f"{{{_DOCX_W_NS}}}body"
_DOCX_SECTPR_TAG = f"{{{_DOCX_W_NS}}}sectPr"
_DOCX_TEXT_TAGS = {
    f"{{{_DOCX_W_NS}}}t",
    f"{{{_DOCX_W_NS}}}delText",
    f"{{{_DOCX_W_NS}}}instrText",
}
_DOCX_STRUCTURAL_CONTENT_TAGS = {
    f"{{{_DOCX_W_NS}}}tbl",
    f"{{{_DOCX_W_NS}}}drawing",
    f"{{{_DOCX_W_NS}}}pict",
    f"{{{_DOCX_W_NS}}}object",
    f"{{{_DOCX_W_NS}}}fldSimple",
    f"{{{_DOCX_W_NS}}}sdt",
    f"{{{_DOCX_W_NS}}}altChunk",
}
_DOCX_HEADER_FOOTER_PART_PREFIXES = ("word/header", "word/footer")
_WORKSPACE_DOCX_DIRNAME = "Docx_Documents"
_WORKSPACE_DOCX_FILENAME_PREFIX = "Docx_document"

_logger = logging.getLogger(__name__)


def _elapsed_ms(started_at: float | None) -> int | None:
    if started_at is None:
        return None
    return int((time.perf_counter() - started_at) * 1000)


def _resolve_docx_artifact_root() -> Path:
    override = os.getenv("INSPYRO_DOCX_ARTIFACTS_DIR")
    if override:
        root_dir = Path(override).expanduser().resolve()
    else:
        root_dir = get_app_storage_dir("docx_artifacts")
    root_dir.mkdir(parents=True, exist_ok=True)
    return root_dir


DOCX_ARTIFACT_ROOT = _resolve_docx_artifact_root()
DOCX_ARTIFACT_BLOBS_DIR = DOCX_ARTIFACT_ROOT / "blobs"
DOCX_ARTIFACT_BLOBS_DIR.mkdir(parents=True, exist_ok=True)
DOCX_ARTIFACT_MANIFESTS_DIR = DOCX_ARTIFACT_ROOT / "manifests"
DOCX_ARTIFACT_MANIFESTS_DIR.mkdir(parents=True, exist_ok=True)
DOCX_ARTIFACT_QUALITY_DIR = DOCX_ARTIFACT_ROOT / "quality"
DOCX_ARTIFACT_QUALITY_DIR.mkdir(parents=True, exist_ok=True)
DOCX_ARTIFACT_WORKBENCH_DIR = DOCX_ARTIFACT_ROOT / "workbench"
DOCX_ARTIFACT_WORKBENCH_DIR.mkdir(parents=True, exist_ok=True)
DOCX_ARTIFACT_INDEX_PATH = DOCX_ARTIFACT_ROOT / "index.json"


def _resolve_docx_delivery_cache_dir() -> Path:
    override = os.getenv("INSPYRO_DOCX_DELIVERY_CACHE_DIR")
    if override:
        cache_dir = Path(override).expanduser().resolve()
    else:
        cache_dir = get_app_storage_dir("docx_delivery_cache")
    cache_dir.mkdir(parents=True, exist_ok=True)
    return cache_dir


DOCX_DELIVERY_CACHE_DIR = _resolve_docx_delivery_cache_dir()

_ARTIFACT_LOCK = threading.RLock()
_ARTIFACTS: dict[str, dict[str, Any]] | None = None
_PROVENANCE_INDEX: dict[str, str] | None = None
_LAST_CLEANUP_AT = 0.0


def _normalize_source_path(raw_path: str | None) -> str | None:
    if not raw_path or not str(raw_path).strip():
        return None
    try:
        return str(Path(str(raw_path)).expanduser().resolve())
    except Exception:
        return str(raw_path).strip()


def _part_has_meaningful_inline_content(root: ET.Element) -> bool:
    for node in root.iter():
        if node.tag in _DOCX_TEXT_TAGS and (node.text or "").strip():
            return True
        if node.tag in _DOCX_STRUCTURAL_CONTENT_TAGS:
            return True
        if node.tag == f"{{{_DOCX_W_NS}}}sym":
            if node.get(f"{{{_DOCX_W_NS}}}char") or node.get("char"):
                return True
    return False


def detect_docx_body_is_empty(docx_bytes: bytes) -> Optional[bool]:
    if not docx_bytes:
        return None
    try:
        with zipfile.ZipFile(io.BytesIO(docx_bytes), "r") as archive:
            document_xml = archive.read("word/document.xml")
            root = ET.fromstring(document_xml)
            body = root.find(_DOCX_BODY_TAG)
            if body is None:
                return None
            for child in list(body):
                if child.tag == _DOCX_SECTPR_TAG:
                    continue
                if child.tag in _DOCX_STRUCTURAL_CONTENT_TAGS:
                    return False
                if _part_has_meaningful_inline_content(child):
                    return False

            for name in archive.namelist():
                if not name.endswith(".xml"):
                    continue
                if not any(name.startswith(prefix) for prefix in _DOCX_HEADER_FOOTER_PART_PREFIXES):
                    continue
                try:
                    part_root = ET.fromstring(archive.read(name))
                except Exception:
                    continue
                if _part_has_meaningful_inline_content(part_root):
                    return False
            return True
    except Exception:
        return None


def build_docx_download_url(
    *,
    artifact_id: str | None = None,
    token: str | None = None,
    source_path: str | None = None,
    kernel_id: str | None = None,
) -> str | None:
    params: dict[str, str] = {}
    if artifact_id:
        params["artifact_id"] = str(artifact_id)
    elif token:
        params["token"] = str(token)
    elif source_path:
        params["source_path"] = str(source_path)
    elif kernel_id:
        params["kernel_id"] = str(kernel_id)
    else:
        return None
    return f"/api/docx/download?{urlencode(params)}"


def build_docx_provenance_url(*, artifact_id: str | None = None) -> str | None:
    if not artifact_id:
        return None
    return f"/api/docx/provenance?{urlencode({'artifact_id': str(artifact_id)})}"


def build_docx_provenance_open_url(*, provenance_id: str | None = None) -> str | None:
    if not provenance_id:
        return None
    return f"/api/docx/provenance/open?{urlencode({'provenance_id': str(provenance_id)})}"


def build_docx_workbench_resource_url(*, workbench_id: str | None = None, name: str | None = None) -> str | None:
    if not workbench_id or not name:
        return None
    return f"/api/docx/workbench/resource?{urlencode({'workbench_id': str(workbench_id), 'name': str(name)})}"


def _decorate_entry(entry: dict[str, Any]) -> dict[str, Any]:
    payload = dict(entry)
    payload["path"] = str(DOCX_ARTIFACT_BLOBS_DIR / f"{entry['binary_hash']}.docx")
    workspace_path = str(entry.get("workspace_path") or "").strip() or None
    workspace_relpath = str(entry.get("workspace_relpath") or "").strip() or None
    if workspace_path and not workspace_relpath:
        stored_workspace_root = _normalize_source_path(entry.get("workspace_root"))
        workspace_root = Path(stored_workspace_root) if stored_workspace_root else None
        if workspace_root is None:
            workspace_root, _ = _workspace_root_from_source_path(entry.get("source_path"))
        if workspace_root is not None:
            workspace_relpath = _safe_relpath(Path(workspace_path), workspace_root)
    payload["workspace_path"] = workspace_path
    payload["workspace_relpath"] = workspace_relpath
    payload["workspace_warning"] = str(entry.get("workspace_warning") or "").strip() or None
    payload["delivery_path"] = workspace_path or str(DOCX_DELIVERY_CACHE_DIR / f"{entry['binary_hash']}.docx")
    payload["download_url"] = build_docx_download_url(artifact_id=entry["artifact_id"])
    payload["ref"] = payload["download_url"]
    payload["docx_provenance_ref"] = build_docx_provenance_url(artifact_id=entry["artifact_id"])
    payload["docx_provenance_available"] = bool(entry.get("docx_provenance_available"))
    quality_summary = _read_quality_summary_file(str(entry.get("artifact_id") or ""), str(entry.get("binary_hash") or ""))
    if quality_summary:
        payload["docx_quality"] = quality_summary
        payload["docx_quality_status"] = quality_summary.get("status")
        payload["docx_quality_score"] = quality_summary.get("score")
        payload["docx_quality_counts"] = quality_summary.get("counts")
    else:
        payload["docx_quality"] = None
        payload["docx_quality_status"] = None
        payload["docx_quality_score"] = None
        payload["docx_quality_counts"] = None
    render_manifest = get_docx_render_manifest(
        binary_hash=str(entry.get("binary_hash") or ""),
        artifact_id=str(entry.get("artifact_id") or "") or None,
    )
    payload["docx_render"] = render_manifest
    payload["docx_render_status"] = render_manifest.get("status")
    payload["docx_render_page_count"] = render_manifest.get("page_count")
    payload["docx_render_cached_pages"] = render_manifest.get("cached_pages")
    payload["docx_render_renderer"] = render_manifest.get("converter_used")
    return payload


def _quality_summary_path(artifact_id: str) -> Path:
    return DOCX_ARTIFACT_QUALITY_DIR / f"{artifact_id}.json"


def _safe_store_id(value: str | None) -> str | None:
    normalized = str(value or "").strip()
    if not normalized:
        return None
    if all(char.isascii() and (char.isalnum() or char in "_-") for char in normalized):
        return normalized
    return None


def _workbench_dir(workbench_id: str) -> Path:
    return DOCX_ARTIFACT_WORKBENCH_DIR / str(workbench_id)


def _workbench_summary_path(workbench_id: str) -> Path:
    return _workbench_dir(workbench_id) / "summary.json"


def _read_quality_summary_file(artifact_id: str, binary_hash: str | None = None) -> dict[str, Any] | None:
    if not artifact_id:
        return None
    path = _quality_summary_path(artifact_id)
    if not path.exists():
        return None
    try:
        summary = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return None
    if not isinstance(summary, dict):
        return None
    if binary_hash and summary.get("binary_hash") and str(summary.get("binary_hash")) != str(binary_hash):
        return None
    return summary


def _safe_relpath(path: Path, root: Path) -> str | None:
    try:
        return str(path.resolve().relative_to(root))
    except Exception:
        return None


def _active_workspace_root() -> tuple[Path | None, str | None]:
    try:
        snapshot = get_workspace_snapshot()
    except Exception as exc:
        return None, f"workspace_snapshot_failed:{type(exc).__name__}"

    active_workspace = str((snapshot or {}).get("active_workspace") or "").strip()
    if not active_workspace:
        return None, "active_workspace_missing"

    try:
        workspace_root = Path(active_workspace).expanduser().resolve()
    except Exception as exc:
        return None, f"active_workspace_invalid:{type(exc).__name__}"

    if not workspace_root.exists() or not workspace_root.is_dir():
        return None, "active_workspace_unavailable"

    return workspace_root, None


def _workspace_root_from_source_path(source_path: str | None) -> tuple[Path | None, str | None]:
    normalized_source_path = _normalize_source_path(source_path)
    active_workspace_root, active_warning = _active_workspace_root()

    if normalized_source_path:
        try:
            resolved_source = Path(normalized_source_path)
            resolved_source = resolved_source if resolved_source.is_dir() else resolved_source.parent
            resolved_source = resolved_source.resolve()
        except Exception as exc:
            if active_workspace_root is not None:
                return active_workspace_root, f"source_path_invalid:{type(exc).__name__}"
            return None, f"source_path_invalid:{type(exc).__name__}"

        if resolved_source.exists() and resolved_source.is_dir():
            if active_workspace_root is not None and _safe_relpath(resolved_source, active_workspace_root) is not None:
                return active_workspace_root, None
            return resolved_source, None

    return active_workspace_root, active_warning


def _build_workspace_docx_filename(now_local: datetime, artifact_id: str, directory: Path) -> str:
    stem = f"{_WORKSPACE_DOCX_FILENAME_PREFIX}_{now_local.strftime('%Y-%m-%d_%H-%M-%S-%f')[:-3]}"
    candidate = directory / f"{stem}.docx"
    if not candidate.exists():
        return candidate.name
    return f"{stem}_{artifact_id[:8]}.docx"


def _materialize_workspace_docx_locked(
    delivery_bytes: bytes,
    *,
    artifact_id: str,
    source_path: str | None = None,
) -> tuple[str | None, str | None, str | None, str | None, str | None]:
    workspace_root, warning = _workspace_root_from_source_path(source_path)
    if workspace_root is None:
        return None, None, None, warning, None

    workspace_dir = (workspace_root / _WORKSPACE_DOCX_DIRNAME)
    try:
        workspace_dir.mkdir(parents=True, exist_ok=True)
        resolved_dir = workspace_dir.resolve()
        resolved_dir.relative_to(workspace_root)
    except Exception:
        return None, None, None, "workspace_docx_dir_outside_workspace", str(workspace_root)

    filename = _build_workspace_docx_filename(datetime.now().astimezone(), artifact_id, resolved_dir)
    target_path = resolved_dir / filename

    try:
        target_path.resolve().relative_to(workspace_root)
    except Exception:
        return None, None, None, "workspace_docx_target_outside_workspace", str(workspace_root)

    target_path.write_bytes(delivery_bytes)
    return str(target_path), filename, _safe_relpath(target_path, workspace_root), None, str(workspace_root)


def _find_reusable_workspace_entry_locked(
    *,
    execution_id: str | None,
    source_path: str | None,
    source_kind: str | None,
    docx_hash: str | None,
    binary_hash: str,
) -> dict[str, Any] | None:
    if not execution_id:
        return None
    normalized_source_path = _normalize_source_path(source_path)
    comparable_hash = str(docx_hash or binary_hash)
    candidates = [
        item
        for item in (_ARTIFACTS or {}).values()
        if item.get("execution_id") == execution_id
        and item.get("source_kind") == str(source_kind or "unknown")
        and item.get("source_path") == normalized_source_path
        and str(item.get("docx_hash") or item.get("binary_hash") or "") == comparable_hash
        and str(item.get("workspace_path") or "").strip()
    ]
    candidates.sort(key=lambda item: float(item.get("created_at_ts") or 0.0), reverse=True)
    workspace_root, _ = _workspace_root_from_source_path(source_path)
    for candidate in candidates:
        workspace_path = Path(str(candidate.get("workspace_path") or ""))
        if not workspace_path.exists():
            continue
        if workspace_root is not None and _safe_relpath(workspace_path, workspace_root) is None:
            continue
        if workspace_path.exists():
            return candidate
    return None


def _ensure_delivery_cache_locked(binary_hash: str, delivery_bytes: bytes) -> str:
    delivery_path = DOCX_DELIVERY_CACHE_DIR / f"{binary_hash}.docx"
    if not delivery_path.exists():
        delivery_path.write_bytes(delivery_bytes)
    return str(delivery_path)


def _ensure_index_loaded_locked() -> None:
    global _ARTIFACTS, _PROVENANCE_INDEX
    if _ARTIFACTS is not None and _PROVENANCE_INDEX is not None:
        return
    if not DOCX_ARTIFACT_INDEX_PATH.exists():
        _ARTIFACTS = {}
        _PROVENANCE_INDEX = {}
        return
    try:
        raw = json.loads(DOCX_ARTIFACT_INDEX_PATH.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        _ARTIFACTS = {}
        _PROVENANCE_INDEX = {}
        return

    artifacts: dict[str, dict[str, Any]] = {}
    provenance_index: dict[str, str] = {}
    for item in raw.get("artifacts", []):
        if not isinstance(item, dict):
            continue
        artifact_id = str(item.get("artifact_id") or "").strip()
        binary_hash = str(item.get("binary_hash") or "").strip()
        created_at_ts = item.get("created_at_ts")
        if not artifact_id or not binary_hash:
            continue
        if not isinstance(created_at_ts, (int, float)):
            continue
        artifacts[artifact_id] = {
            "artifact_id": artifact_id,
            "created_at": str(item.get("created_at") or ""),
            "created_at_ts": float(created_at_ts),
            "docx_hash": str(item.get("docx_hash") or binary_hash),
            "binary_hash": binary_hash,
            "source_kind": str(item.get("source_kind") or "unknown"),
            "source_path": _normalize_source_path(item.get("source_path")),
            "kernel_id": str(item.get("kernel_id") or "") or None,
            "execution_id": str(item.get("execution_id") or "") or None,
            "filename": str(item.get("filename") or "inspyro_document.docx"),
            "size_bytes": int(item.get("size_bytes") or 0),
            "workspace_path": str(item.get("workspace_path") or "") or None,
            "workspace_relpath": str(item.get("workspace_relpath") or "") or None,
            "docx_provenance_available": bool(item.get("docx_provenance_available")),
            "provenance_ids": [
                str(pid) for pid in (item.get("provenance_ids") or [])
                if str(pid).strip()
            ],
        }
        if "workspace_warning" in item:
            artifacts[artifact_id]["workspace_warning"] = str(item.get("workspace_warning") or "") or None
        if "docx_is_empty" in item:
            artifacts[artifact_id]["docx_is_empty"] = bool(item.get("docx_is_empty"))
        if "docx_warning" in item:
            artifacts[artifact_id]["docx_warning"] = str(item.get("docx_warning") or "") or None
        for provenance_id in artifacts[artifact_id]["provenance_ids"]:
            provenance_index[provenance_id] = artifact_id
    for provenance_id, artifact_id in (raw.get("provenance_index") or {}).items():
        provenance_key = str(provenance_id or "").strip()
        artifact_key = str(artifact_id or "").strip()
        if provenance_key and artifact_key:
            provenance_index[provenance_key] = artifact_key
    _ARTIFACTS = artifacts
    _PROVENANCE_INDEX = provenance_index


def _save_index_locked() -> None:
    _ensure_index_loaded_locked()
    payload = {
        "artifacts": sorted(
            _ARTIFACTS.values(),
            key=lambda item: (float(item.get("created_at_ts", 0.0)), str(item.get("artifact_id") or "")),
        ),
        "provenance_index": dict(sorted((_PROVENANCE_INDEX or {}).items())),
    }
    DOCX_ARTIFACT_INDEX_PATH.write_text(
        json.dumps(payload, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )


def _cleanup_locked(now: float, *, force: bool = False) -> None:
    global _LAST_CLEANUP_AT
    _ensure_index_loaded_locked()
    if not force and (now - _LAST_CLEANUP_AT) < DOCX_ARTIFACT_CLEANUP_INTERVAL_SECONDS:
        return
    _LAST_CLEANUP_AT = now

    expiry_cutoff = now - DOCX_ARTIFACT_RETENTION_SECONDS
    changed = False
    for artifact_id, item in list(_ARTIFACTS.items()):
        created_at_ts = float(item.get("created_at_ts") or 0.0)
        blob_path = DOCX_ARTIFACT_BLOBS_DIR / f"{item.get('binary_hash')}.docx"
        manifest_path = DOCX_ARTIFACT_MANIFESTS_DIR / f"{artifact_id}.json"
        quality_path = _quality_summary_path(artifact_id)
        if created_at_ts <= expiry_cutoff or not blob_path.exists():
            _ARTIFACTS.pop(artifact_id, None)
            for provenance_id in list((_PROVENANCE_INDEX or {}).keys()):
                if (_PROVENANCE_INDEX or {}).get(provenance_id) == artifact_id:
                    (_PROVENANCE_INDEX or {}).pop(provenance_id, None)
            try:
                manifest_path.unlink(missing_ok=True)
            except OSError:
                pass
            try:
                quality_path.unlink(missing_ok=True)
            except OSError:
                pass
            changed = True

    referenced_hashes = {
        str(item.get("binary_hash"))
        for item in _ARTIFACTS.values()
        if str(item.get("binary_hash") or "").strip()
    }

    try:
        blob_files = [path for path in DOCX_ARTIFACT_BLOBS_DIR.glob("*.docx") if path.is_file()]
    except OSError:
        blob_files = []
    try:
        manifest_files = [path for path in DOCX_ARTIFACT_MANIFESTS_DIR.glob("*.json") if path.is_file()]
    except OSError:
        manifest_files = []
    try:
        quality_files = [path for path in DOCX_ARTIFACT_QUALITY_DIR.glob("*.json") if path.is_file()]
    except OSError:
        quality_files = []
    try:
        delivery_cache_files = [path for path in DOCX_DELIVERY_CACHE_DIR.glob("*.docx") if path.is_file()]
    except OSError:
        delivery_cache_files = []

    for blob_path in blob_files:
        if blob_path.stem in referenced_hashes:
            continue
        try:
            blob_path.unlink(missing_ok=True)
        except OSError:
            pass

    referenced_artifact_ids = set(_ARTIFACTS.keys())
    for manifest_path in manifest_files:
        if manifest_path.stem in referenced_artifact_ids:
            continue
        try:
            manifest_path.unlink(missing_ok=True)
        except OSError:
            pass

    for quality_path in quality_files:
        if quality_path.stem in referenced_artifact_ids:
            continue
        try:
            quality_path.unlink(missing_ok=True)
        except OSError:
            pass

    for delivery_cache_path in delivery_cache_files:
        if delivery_cache_path.stem in referenced_hashes:
            continue
        try:
            delivery_cache_path.unlink(missing_ok=True)
        except OSError:
            pass

    if changed:
        _save_index_locked()


def _classify_entry_locked(entry: dict[str, Any]) -> bool:
    blob_path = DOCX_ARTIFACT_BLOBS_DIR / f"{entry.get('binary_hash')}.docx"
    if not blob_path.exists():
        return False
    try:
        is_empty = detect_docx_body_is_empty(blob_path.read_bytes())
    except OSError:
        return False
    if is_empty is None:
        return False
    resolved_is_empty = bool(is_empty)
    resolved_warning = DOCX_EMPTY_HISTORY_WARNING if resolved_is_empty else None
    if entry.get("docx_is_empty") == resolved_is_empty and entry.get("docx_warning") == resolved_warning:
        return False
    entry["docx_is_empty"] = resolved_is_empty
    entry["docx_warning"] = resolved_warning
    return True


def _write_provenance_manifest_locked(artifact_id: str, manifest: dict[str, Any]) -> tuple[bool, list[str]]:
    manifest_path = DOCX_ARTIFACT_MANIFESTS_DIR / f"{artifact_id}.json"
    items = manifest.get("items") if isinstance(manifest, dict) else None
    normalized_items = [item for item in (items or []) if isinstance(item, dict)]
    if not normalized_items:
        try:
            manifest_path.unlink(missing_ok=True)
        except OSError:
            pass
        return False, []

    payload = {
        "artifact_id": artifact_id,
        "generated_at": manifest.get("generated_at"),
        "items": normalized_items,
    }
    manifest_path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    provenance_ids = [
        str(item.get("provenance_id") or "").strip()
        for item in normalized_items
        if str(item.get("provenance_id") or "").strip()
    ]
    return bool(provenance_ids), provenance_ids


def _read_provenance_manifest_locked(artifact_id: str) -> Optional[dict[str, Any]]:
    manifest_path = DOCX_ARTIFACT_MANIFESTS_DIR / f"{artifact_id}.json"
    if not manifest_path.exists():
        return None
    try:
        raw = json.loads(manifest_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return None
    if not isinstance(raw, dict):
        return None
    items = raw.get("items")
    if not isinstance(items, list):
        raw["items"] = []
    return raw


def _initialize_docx_artifact_store() -> None:
    with _ARTIFACT_LOCK:
        _ensure_index_loaded_locked()
        _cleanup_locked(time.time(), force=True)


def store_docx_artifact(
    docx_b64: str,
    *,
    filename: str = "inspyro_document.docx",
    delivery_docx_b64: str | None = None,
    docx_hash: str | None = None,
    source_kind: str | None = None,
    source_path: str | None = None,
    kernel_id: str | None = None,
    execution_id: str | None = None,
    docx_is_empty: bool | None = None,
    docx_warning: str | None = None,
    provenance_manifest: dict[str, Any] | None = None,
) -> dict[str, Any]:
    if not docx_b64:
        raise ValueError("docx_b64 requerido")

    data = base64.b64decode(docx_b64)
    binary_hash = hashlib.sha256(data).hexdigest()
    artifact_id = secrets.token_urlsafe(18)
    normalized_source_path = _normalize_source_path(source_path)
    blob_path = DOCX_ARTIFACT_BLOBS_DIR / f"{binary_hash}.docx"
    if delivery_docx_b64:
        delivery_bytes = base64.b64decode(delivery_docx_b64)
    else:
        delivery_bytes = sanitize_docx_bytes_for_delivery(data)
    now = time.time()
    created_at = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
    resolved_docx_is_empty = docx_is_empty
    if resolved_docx_is_empty is None:
        resolved_docx_is_empty = detect_docx_body_is_empty(data)

    workspace_path = None
    workspace_relpath = None
    workspace_filename = filename or "inspyro_document.docx"
    workspace_warning = None

    entry = {
        "artifact_id": artifact_id,
        "created_at": created_at,
        "created_at_ts": now,
        "docx_hash": docx_hash or binary_hash,
        "binary_hash": binary_hash,
        "source_kind": str(source_kind or "unknown"),
        "source_path": normalized_source_path,
        "kernel_id": str(kernel_id or "") or None,
        "execution_id": str(execution_id or "") or None,
        "filename": workspace_filename,
        "size_bytes": len(data),
        "docx_is_empty": bool(resolved_docx_is_empty) if resolved_docx_is_empty is not None else False,
        "docx_warning": (
            str(docx_warning).strip()
            if docx_warning and bool(resolved_docx_is_empty)
            else (DOCX_EMPTY_HISTORY_WARNING if resolved_docx_is_empty else None)
        ),
        "docx_provenance_available": False,
        "provenance_ids": [],
    }

    with _ARTIFACT_LOCK:
        _ensure_index_loaded_locked()
        cleanup_started_at = time.perf_counter()
        _cleanup_locked(now)
        artifact_cleanup_ms = _elapsed_ms(cleanup_started_at)
        blob_write_started_at = time.perf_counter()
        if not blob_path.exists():
            blob_path.write_bytes(data)
        blob_write_ms = _elapsed_ms(blob_write_started_at)
        delivery_cache_started_at = time.perf_counter()
        _ensure_delivery_cache_locked(binary_hash, delivery_bytes)
        delivery_cache_ms = _elapsed_ms(delivery_cache_started_at)

        reusable_workspace_entry = _find_reusable_workspace_entry_locked(
            execution_id=execution_id,
            source_path=normalized_source_path,
            source_kind=source_kind,
            docx_hash=docx_hash,
            binary_hash=binary_hash,
        )
        workspace_write_ms = None
        workspace_root = None
        if reusable_workspace_entry:
            workspace_path = reusable_workspace_entry.get("workspace_path")
            workspace_relpath = reusable_workspace_entry.get("workspace_relpath")
            workspace_filename = reusable_workspace_entry.get("filename") or workspace_filename
            workspace_root = reusable_workspace_entry.get("workspace_root")
            workspace_write_ms = 0
        else:
            workspace_write_started_at = time.perf_counter()
            workspace_path, workspace_filename, workspace_relpath, workspace_warning, workspace_root = _materialize_workspace_docx_locked(
                delivery_bytes,
                artifact_id=artifact_id,
                source_path=normalized_source_path,
            )
            workspace_write_ms = _elapsed_ms(workspace_write_started_at)
        if workspace_path:
            entry["workspace_path"] = workspace_path
            entry["workspace_relpath"] = workspace_relpath
            entry["filename"] = workspace_filename or entry["filename"]
        if workspace_root:
            entry["workspace_root"] = workspace_root
        if workspace_warning:
            entry["workspace_warning"] = workspace_warning
            _logger.warning(
                "DOCX artifact %s could not be materialized into workspace: %s",
                artifact_id,
                workspace_warning,
            )
        provenance_manifest_started_at = time.perf_counter()
        provenance_available, provenance_ids = _write_provenance_manifest_locked(
            artifact_id,
            provenance_manifest if isinstance(provenance_manifest, dict) else {},
        )
        provenance_manifest_ms = _elapsed_ms(provenance_manifest_started_at)
        entry["docx_provenance_available"] = provenance_available
        entry["provenance_ids"] = provenance_ids
        for provenance_id in provenance_ids:
            _PROVENANCE_INDEX[provenance_id] = artifact_id
        _ARTIFACTS[artifact_id] = entry
        index_write_started_at = time.perf_counter()
        _save_index_locked()
        index_write_ms = _elapsed_ms(index_write_started_at)

    decorated = _decorate_entry(entry)
    decorated["artifact_timing_ms"] = {
        key: value
        for key, value in {
            "artifact_cleanup_ms": artifact_cleanup_ms,
            "blob_write_ms": blob_write_ms,
            "delivery_cache_ms": delivery_cache_ms,
            "workspace_write_ms": workspace_write_ms,
            "provenance_manifest_ms": provenance_manifest_ms,
            "index_write_ms": index_write_ms,
        }.items()
        if isinstance(value, (int, float))
    }
    return decorated


def get_docx_delivery_file(info: dict[str, Any] | None) -> Optional[dict[str, Any]]:
    if not isinstance(info, dict):
        return None

    workspace_path = str(info.get("workspace_path") or "").strip()
    if workspace_path:
        workspace_file = Path(workspace_path)
        if workspace_file.exists():
            return {
                "path": str(workspace_file),
                "filename": info.get("filename") or workspace_file.name,
                "source": "workspace",
                "sanitized": True,
            }

    binary_hash = str(info.get("binary_hash") or "").strip()
    raw_path = str(info.get("path") or "").strip()
    if not raw_path or not binary_hash:
        return None

    delivery_cache_path = DOCX_DELIVERY_CACHE_DIR / f"{binary_hash}.docx"
    if not delivery_cache_path.exists():
        try:
            raw_bytes = Path(raw_path).read_bytes()
        except OSError:
            return None
        delivery_bytes = sanitize_docx_bytes_for_delivery(raw_bytes)
        with _ARTIFACT_LOCK:
            _ensure_delivery_cache_locked(binary_hash, delivery_bytes)

    if not delivery_cache_path.exists():
        return None

    return {
        "path": str(delivery_cache_path),
        "filename": info.get("filename") or "inspyro_document.docx",
        "source": "delivery_cache",
        "sanitized": True,
    }


def get_docx_artifact(artifact_id: str) -> Optional[dict[str, Any]]:
    if not artifact_id:
        return None
    now = time.time()
    with _ARTIFACT_LOCK:
        _ensure_index_loaded_locked()
        _cleanup_locked(now)
        entry = _ARTIFACTS.get(str(artifact_id))
        if not entry:
            return None
        blob_path = DOCX_ARTIFACT_BLOBS_DIR / f"{entry.get('binary_hash')}.docx"
        if not blob_path.exists():
            _ARTIFACTS.pop(str(artifact_id), None)
            _save_index_locked()
            return None
        if _classify_entry_locked(entry):
            _save_index_locked()
        return _decorate_entry(entry)


def get_docx_provenance(artifact_id: str) -> Optional[dict[str, Any]]:
    if not artifact_id:
        return None
    now = time.time()
    with _ARTIFACT_LOCK:
        _ensure_index_loaded_locked()
        _cleanup_locked(now)
        entry = _ARTIFACTS.get(str(artifact_id))
        if not entry:
            return None
        manifest = _read_provenance_manifest_locked(str(artifact_id))
        if not manifest:
            return None
        manifest["artifact_id"] = str(artifact_id)
        manifest["docx_provenance_ref"] = build_docx_provenance_url(artifact_id=str(artifact_id))
        manifest["docx_provenance_available"] = True
        return manifest


def get_docx_quality_summary(artifact_id: str) -> Optional[dict[str, Any]]:
    if not artifact_id:
        return None
    now = time.time()
    with _ARTIFACT_LOCK:
        _ensure_index_loaded_locked()
        _cleanup_locked(now)
        entry = _ARTIFACTS.get(str(artifact_id))
        if not entry:
            return None
        return _read_quality_summary_file(str(artifact_id), str(entry.get("binary_hash") or ""))


def store_docx_quality_summary(artifact_id: str, summary: dict[str, Any]) -> dict[str, Any]:
    if not artifact_id:
        raise ValueError("artifact_id requerido")
    if not isinstance(summary, dict):
        raise ValueError("summary debe ser un dict")
    now = time.time()
    with _ARTIFACT_LOCK:
        _ensure_index_loaded_locked()
        _cleanup_locked(now)
        entry = _ARTIFACTS.get(str(artifact_id))
        if not entry:
            raise KeyError(str(artifact_id))
        payload = dict(summary)
        payload["artifact_id"] = str(artifact_id)
        payload["binary_hash"] = str(entry.get("binary_hash") or payload.get("binary_hash") or "")
        payload["generated_at"] = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
        _quality_summary_path(str(artifact_id)).write_text(
            json.dumps(payload, ensure_ascii=False, indent=2),
            encoding="utf-8",
        )
        return payload


def store_docx_workbench_result(
    artifact_id: str,
    result: dict[str, Any],
    *,
    resources: dict[str, bytes] | None = None,
) -> dict[str, Any]:
    if not artifact_id:
        raise ValueError("artifact_id requerido")
    if not isinstance(result, dict):
        raise ValueError("result debe ser un dict")

    now = time.time()
    with _ARTIFACT_LOCK:
        _ensure_index_loaded_locked()
        _cleanup_locked(now)
        entry = _ARTIFACTS.get(str(artifact_id))
        if not entry:
            raise KeyError(str(artifact_id))

        workbench_id = f"wb_{str(artifact_id)[:8]}_{int(now * 1000)}_{secrets.token_urlsafe(4)}"
        target_dir = _workbench_dir(workbench_id)
        target_dir.mkdir(parents=True, exist_ok=False)

        resource_items: list[dict[str, Any]] = []
        for name, data in (resources or {}).items():
            safe_name = Path(str(name)).name
            if not safe_name:
                continue
            resource_path = target_dir / safe_name
            resource_path.write_bytes(data)
            resource_items.append(
                {
                    "name": safe_name,
                    "size_bytes": len(data),
                    "hash": hashlib.sha256(data).hexdigest(),
                    "resource_uri": build_docx_workbench_resource_url(workbench_id=workbench_id, name=safe_name),
                }
            )

        payload = dict(result)
        existing_resource_items: list[dict[str, Any]] = []
        for item in result.get("resources") or []:
            if not isinstance(item, dict):
                continue
            resource_uri = str(item.get("resource_uri") or "").strip()
            name = str(item.get("name") or "").strip()
            if not resource_uri or not name:
                continue
            existing_resource_items.append(
                {
                    key: item.get(key)
                    for key in ("name", "size_bytes", "hash", "mime_type", "resource_uri", "page", "cached", "renderer")
                    if item.get(key) not in (None, "")
                }
            )
        payload["workbench_id"] = workbench_id
        payload["artifact_id"] = str(artifact_id)
        payload["parent_artifact_id"] = str(artifact_id)
        payload["binary_hash"] = str(entry.get("binary_hash") or payload.get("binary_hash") or "")
        payload["generated_at"] = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
        resource_by_key: dict[str, dict[str, Any]] = {}
        for item in [*existing_resource_items, *resource_items]:
            key = str(item.get("resource_uri") or item.get("name") or "")
            if key:
                resource_by_key[key] = item
        payload["resources"] = list(resource_by_key.values())
        _workbench_summary_path(workbench_id).write_text(
            json.dumps(payload, ensure_ascii=False, indent=2),
            encoding="utf-8",
        )
        return payload


def get_docx_workbench_result(workbench_id: str) -> Optional[dict[str, Any]]:
    safe_workbench_id = _safe_store_id(workbench_id)
    if not safe_workbench_id:
        return None
    path = _workbench_summary_path(safe_workbench_id)
    if not path.exists():
        return None
    try:
        resolved_store = DOCX_ARTIFACT_WORKBENCH_DIR.resolve()
        resolved_path = path.resolve()
        resolved_path.relative_to(resolved_store)
        raw = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError, ValueError):
        return None
    return raw if isinstance(raw, dict) else None


def get_docx_workbench_resource(workbench_id: str, name: str) -> Optional[dict[str, Any]]:
    safe_workbench_id = _safe_store_id(workbench_id)
    if not safe_workbench_id or not name:
        return None
    safe_name = Path(str(name)).name
    path = _workbench_dir(safe_workbench_id) / safe_name
    try:
        resolved_store = DOCX_ARTIFACT_WORKBENCH_DIR.resolve()
        resolved_dir = _workbench_dir(safe_workbench_id).resolve()
        resolved_path = path.resolve()
        resolved_dir.relative_to(resolved_store)
        resolved_path.relative_to(resolved_dir)
    except Exception:
        return None
    if not resolved_path.exists() or not resolved_path.is_file():
        return None
    data = resolved_path.read_bytes()
    return {
        "name": safe_name,
        "path": str(resolved_path),
        "bytes": data,
        "size_bytes": len(data),
        "hash": hashlib.sha256(data).hexdigest(),
    }


def resolve_docx_provenance(provenance_id: str) -> Optional[dict[str, Any]]:
    if not provenance_id:
        return None
    now = time.time()
    with _ARTIFACT_LOCK:
        _ensure_index_loaded_locked()
        _cleanup_locked(now)
        artifact_id = (_PROVENANCE_INDEX or {}).get(str(provenance_id))
        if not artifact_id:
            return None
        entry = _ARTIFACTS.get(artifact_id)
        if not entry:
            return None
        manifest = _read_provenance_manifest_locked(artifact_id)
        if not manifest:
            return None
        for item in manifest.get("items", []):
            if str(item.get("provenance_id") or "") == str(provenance_id):
                return {
                    "artifact_id": artifact_id,
                    "artifact": _decorate_entry(entry),
                    "item": item,
                    "docx_provenance_open_url": build_docx_provenance_open_url(provenance_id=str(provenance_id)),
                }
        return None


def list_docx_artifacts(
    *,
    source_path: str | None = None,
    kernel_id: str | None = None,
    limit: int = 20,
    include_empty: bool = True,
) -> list[dict[str, Any]]:
    normalized_source_path = _normalize_source_path(source_path)
    bounded_limit = max(1, min(int(limit), 100))
    now = time.time()
    with _ARTIFACT_LOCK:
        _ensure_index_loaded_locked()
        _cleanup_locked(now)
        items = list(_ARTIFACTS.values())
        if normalized_source_path:
            items = [item for item in items if item.get("source_path") == normalized_source_path]
        elif kernel_id:
            items = [item for item in items if item.get("kernel_id") == kernel_id]
        else:
            items = []
        items.sort(key=lambda item: float(item.get("created_at_ts") or 0.0), reverse=True)
        changed = False
        for item in items:
            if _classify_entry_locked(item):
                changed = True
        if changed:
            _save_index_locked()
        if not include_empty:
            items = [item for item in items if not bool(item.get("docx_is_empty"))]
        return [_decorate_entry(item) for item in items[:bounded_limit]]


def list_workspace_docx_artifacts(
    *,
    workspace_root: str | Path | None,
    limit: int = 20,
    include_empty: bool = True,
) -> list[dict[str, Any]]:
    normalized_workspace_root = _normalize_source_path(str(workspace_root or ""))
    if not normalized_workspace_root:
        return []

    bounded_limit = max(1, min(int(limit), 100))
    workspace_path = Path(normalized_workspace_root)
    now = time.time()

    def _belongs_to_workspace(entry: dict[str, Any]) -> bool:
        source_path = _normalize_source_path(entry.get("source_path"))
        if source_path:
            return _safe_relpath(Path(source_path), workspace_path) is not None

        materialized_path = _normalize_source_path(entry.get("workspace_path"))
        if materialized_path and _safe_relpath(Path(materialized_path), workspace_path) is not None:
            return True

        return False

    with _ARTIFACT_LOCK:
        _ensure_index_loaded_locked()
        _cleanup_locked(now)
        items = [item for item in (_ARTIFACTS or {}).values() if _belongs_to_workspace(item)]
        items.sort(key=lambda item: float(item.get("created_at_ts") or 0.0), reverse=True)
        changed = False
        for item in items:
            if _classify_entry_locked(item):
                changed = True
        if changed:
            _save_index_locked()
        if not include_empty:
            items = [item for item in items if not bool(item.get("docx_is_empty"))]
        return [_decorate_entry(item) for item in items[:bounded_limit]]


def get_latest_docx_artifact(
    *,
    source_path: str | None = None,
    kernel_id: str | None = None,
    skip_empty: bool = True,
) -> Optional[dict[str, Any]]:
    items = list_docx_artifacts(
        source_path=source_path,
        kernel_id=kernel_id,
        limit=1,
        include_empty=not skip_empty,
    )
    return items[0] if items else None


def reset_docx_artifacts(
    *,
    source_path: str | None = None,
    kernel_id: str | None = None,
) -> int:
    with _ARTIFACT_LOCK:
        _ensure_index_loaded_locked()
        normalized_source_path = _normalize_source_path(source_path)
        normalized_kernel_id = str(kernel_id or "").strip() or None

        if normalized_source_path:
            target_ids = [
                artifact_id
                for artifact_id, item in (_ARTIFACTS or {}).items()
                if item.get("source_path") == normalized_source_path
            ]
        elif normalized_kernel_id:
            target_ids = [
                artifact_id
                for artifact_id, item in (_ARTIFACTS or {}).items()
                if item.get("kernel_id") == normalized_kernel_id
            ]
        else:
            target_ids = list((_ARTIFACTS or {}).keys())

        if not target_ids:
            return 0

        for artifact_id in target_ids:
            (_ARTIFACTS or {}).pop(artifact_id, None)
            for provenance_id in list((_PROVENANCE_INDEX or {}).keys()):
                if (_PROVENANCE_INDEX or {}).get(provenance_id) == artifact_id:
                    (_PROVENANCE_INDEX or {}).pop(provenance_id, None)

        _cleanup_locked(time.time(), force=True)
        _save_index_locked()
        return len(target_ids)


_initialize_docx_artifact_store()
