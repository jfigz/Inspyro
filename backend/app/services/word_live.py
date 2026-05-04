"""Bridge state and DOCX helpers for the Word live-edit companion."""

from __future__ import annotations

import base64
import hashlib
import io
import json
import os
import re
import secrets
import shutil
import subprocess
import sys
import threading
import time
import zipfile
import xml.etree.ElementTree as ET
from copy import deepcopy
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from app.core.security import is_path_safe
from app.services.workspace_service import get_app_storage_dir
from librerias_propias.docx_builder.utils import validate_docx_package_bytes

WORD_W_NS = "http://schemas.openxmlformats.org/wordprocessingml/2006/main"
WORD_M_NS = "http://schemas.openxmlformats.org/officeDocument/2006/math"
WORD_NS = {"w": WORD_W_NS, "m": WORD_M_NS}
SUPPORTED_REGION_KINDS = {"text", "table", "math", "image", "section-block"}
TRACK_CHANGE_TAGS = {
    f"{{{WORD_W_NS}}}ins",
    f"{{{WORD_W_NS}}}del",
    f"{{{WORD_W_NS}}}moveFrom",
    f"{{{WORD_W_NS}}}moveTo",
}
WORD_LIVE_TEMP_DOC_PREFIX = "Word add-in "
WD_WINDOW_STATE_NORMAL = 0
WD_WINDOW_STATE_MINIMIZE = 2

_CACHE_LOCK = threading.RLock()
_SESSIONS: dict[str, dict[str, Any]] | None = None


def _qn(prefix: str, tag: str) -> str:
    return f"{{{WORD_NS[prefix]}}}{tag}"


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def _root_dir() -> Path:
    root = get_app_storage_dir("word_live") / "sessions"
    root.mkdir(parents=True, exist_ok=True)
    return root


def _session_path(session_id: str) -> Path:
    return _root_dir() / f"{session_id}.json"


def _project_root() -> Path:
    return Path(__file__).resolve().parents[3]


def _manifest_path() -> Path:
    return (_project_root() / "word-addin" / "manifest.xml").resolve()


def _frontend_dir() -> Path:
    return (_project_root() / "frontend").resolve()


def _word_live_addin_id() -> str:
    manifest_root = ET.parse(_manifest_path()).getroot()
    addin_id = (manifest_root.findtext(".//{*}Id") or "").strip()
    if not addin_id:
        raise RuntimeError("No se pudo resolver el Id del manifest de Word Live")
    return addin_id


def _npx_executable() -> str:
    if os.name == "nt":
        return shutil.which("npx.cmd") or shutil.which("npx") or "npx.cmd"
    return shutil.which("npx") or "npx"


def _subprocess_creation_flags() -> int:
    return getattr(subprocess, "CREATE_NO_WINDOW", 0) if os.name == "nt" else 0


def _normalize_document_path(raw_path: str | None) -> str | None:
    if raw_path is None:
        return None
    text = str(raw_path).strip()
    if not text:
        return None
    resolved = Path(text).expanduser().resolve()
    if not is_path_safe(str(resolved)):
        raise ValueError("Acceso denegado a document_path")
    return str(resolved)


def _load_docx_bytes(document_path: str | None, docx_b64: str | None) -> bytes | None:
    if docx_b64:
        return base64.b64decode(docx_b64, validate=True)
    normalized_path = _normalize_document_path(document_path)
    if not normalized_path:
        return None
    path = Path(normalized_path)
    if not path.exists():
        raise FileNotFoundError(normalized_path)
    return path.read_bytes()


def _load_cache_locked() -> None:
    global _SESSIONS
    if _SESSIONS is not None:
        return
    sessions: dict[str, dict[str, Any]] = {}
    for path in _root_dir().glob("*.json"):
        try:
            payload = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            continue
        session_id = str(payload.get("session_id") or "").strip()
        if session_id:
            sessions[session_id] = payload
    _SESSIONS = sessions


def _save_session_locked(session: dict[str, Any]) -> None:
    _load_cache_locked()
    session_id = str(session["session_id"])
    _SESSIONS[session_id] = deepcopy(session)
    _session_path(session_id).write_text(
        json.dumps(session, indent=2, ensure_ascii=False),
        encoding="utf-8",
    )


def _text_preview(node: ET.Element, max_chars: int = 160) -> str | None:
    parts = [text.strip() for text in node.itertext() if (text or "").strip()]
    if not parts:
        return None
    preview = re.sub(r"\s+", " ", " ".join(parts)).strip()
    if len(preview) > max_chars:
        return preview[: max_chars - 3].rstrip() + "..."
    return preview


def _kind_for_sdt(sdt_node: ET.Element) -> str:
    content = sdt_node.find("w:sdtContent", WORD_NS)
    if content is None:
        return "section-block"
    if content.find(".//w:tbl", WORD_NS) is not None:
        return "table"
    if content.find(".//m:oMath", WORD_NS) is not None or content.find(".//m:oMathPara", WORD_NS) is not None:
        return "math"
    if content.find(".//w:drawing", WORD_NS) is not None or content.find(".//w:pict", WORD_NS) is not None:
        return "image"
    blocks = [child for child in list(content) if child.tag in {_qn("w", "p"), _qn("w", "tbl")}]
    return "section-block" if len(blocks) > 1 else "text"


def _ops_for_kind(kind: str) -> tuple[list[str], bool]:
    if kind == "text":
        return ["update_text"], False
    return ["replace_fragment"], True


def _make_region_id(seed: str, seen: set[str]) -> str:
    base = re.sub(r"[^A-Za-z0-9_.:-]+", "-", seed).strip("-") or "region"
    if base not in seen:
        seen.add(base)
        return base
    index = 2
    while f"{base}-{index}" in seen:
        index += 1
    final = f"{base}-{index}"
    seen.add(final)
    return final


def _normalize_region(raw_region: dict[str, Any], *, default_kind: str | None = None) -> dict[str, Any]:
    region_id = str(raw_region.get("region_id") or "").strip()
    if not region_id:
        raise ValueError("region_id requerido")
    kind = str(raw_region.get("kind") or default_kind or "text").strip()
    if kind not in SUPPORTED_REGION_KINDS:
        raise ValueError(f"kind no soportado: {kind}")
    allowed_ops, supports_replace = _ops_for_kind(kind)
    return {
        "region_id": region_id,
        "kind": kind,
        "content_control_tag": str(raw_region.get("content_control_tag") or region_id),
        "title": str(raw_region.get("title") or region_id),
        "allowed_ops": list(raw_region.get("allowed_ops") or allowed_ops),
        "supports_ooxml_replace": bool(raw_region.get("supports_ooxml_replace", supports_replace)),
        "locked": bool(raw_region.get("locked")),
        "text_preview": str(raw_region.get("text_preview") or "").strip() or None,
        "word_control_id": raw_region.get("word_control_id"),
        "source": str(raw_region.get("source") or "word"),
    }


def _merge_regions(existing: list[dict[str, Any]], incoming: list[dict[str, Any]]) -> list[dict[str, Any]]:
    merged = {item["region_id"]: deepcopy(item) for item in existing}
    for item in incoming:
        current = merged.get(item["region_id"], {})
        merged[item["region_id"]] = {
            **current,
            **deepcopy(item),
            "allowed_ops": list(item.get("allowed_ops") or current.get("allowed_ops") or []),
        }
    return sorted(merged.values(), key=lambda item: item["region_id"])


def extract_regions_from_docx_bytes(docx_bytes: bytes) -> list[dict[str, Any]]:
    with zipfile.ZipFile(io.BytesIO(docx_bytes), "r") as archive:
        root = ET.fromstring(archive.read("word/document.xml"))

    seen: set[str] = set()
    regions: list[dict[str, Any]] = []
    for index, sdt_node in enumerate(root.findall(".//w:sdt", WORD_NS), start=1):
        props = sdt_node.find("w:sdtPr", WORD_NS)
        tag_node = props.find("w:tag", WORD_NS) if props is not None else None
        alias_node = props.find("w:alias", WORD_NS) if props is not None else None
        locked = props.find("w:lock", WORD_NS) is not None if props is not None else False
        region_id = _make_region_id(
            str(
                (tag_node.get(_qn("w", "val")) if tag_node is not None else None)
                or (alias_node.get(_qn("w", "val")) if alias_node is not None else None)
                or f"region-{index}"
            ),
            seen,
        )
        kind = _kind_for_sdt(sdt_node)
        allowed_ops, supports_replace = _ops_for_kind(kind)
        content = sdt_node.find("w:sdtContent", WORD_NS)
        regions.append(
            {
                "region_id": region_id,
                "kind": kind,
                "content_control_tag": str((tag_node.get(_qn("w", "val")) if tag_node is not None else None) or region_id),
                "title": str((alias_node.get(_qn("w", "val")) if alias_node is not None else None) or region_id),
                "allowed_ops": allowed_ops,
                "supports_ooxml_replace": supports_replace,
                "locked": locked,
                "text_preview": _text_preview(content if content is not None else sdt_node),
                "word_control_id": None,
                "source": "docx",
            }
        )
    return regions


def analyze_docx_capabilities(docx_bytes: bytes) -> tuple[list[str], list[str]]:
    warnings: set[str] = set()
    unsupported: set[str] = set()
    with zipfile.ZipFile(io.BytesIO(docx_bytes), "r") as archive:
        names = set(archive.namelist())
        document_root = ET.fromstring(archive.read("word/document.xml"))
        if any(node.tag in TRACK_CHANGE_TAGS for node in document_root.iter()):
            unsupported.add("track_changes")
        if "word/comments.xml" in names:
            unsupported.add("comments")
        if "word/footnotes.xml" in names or "word/endnotes.xml" in names:
            unsupported.add("footnotes")
        if any(name.startswith("word/header") for name in names):
            warnings.add("headers_present_outside_v1_scope")
        if any(name.startswith("word/footer") for name in names):
            warnings.add("footers_present_outside_v1_scope")
    return sorted(warnings), sorted(unsupported)


def _validate_docx(docx_bytes: bytes | None) -> tuple[str, list[str], str | None]:
    if not docx_bytes:
        return "skipped", [], None
    is_valid, errors = validate_docx_package_bytes(docx_bytes)
    return ("ok" if is_valid else "error"), errors, hashlib.sha256(docx_bytes).hexdigest()


def _refresh_session_document(
    session: dict[str, Any],
    *,
    document_path: str | None,
    docx_b64: str | None,
    regions: list[dict[str, Any]] | None = None,
) -> tuple[list[dict[str, Any]], list[str], list[str], str, list[str], str | None, str | None]:
    normalized_path = _normalize_document_path(document_path or session.get("document_path"))
    docx_bytes = _load_docx_bytes(normalized_path, docx_b64)
    validation_status, validation_errors, document_hash = _validate_docx(docx_bytes)
    extracted_regions = extract_regions_from_docx_bytes(docx_bytes) if docx_bytes else list(session.get("regions") or [])
    warnings, unsupported = analyze_docx_capabilities(docx_bytes) if docx_bytes else (
        list(session.get("warnings") or []),
        list(session.get("unsupported_features") or []),
    )
    merged_regions = _merge_regions(extracted_regions, [_normalize_region(item) for item in (regions or [])])
    return merged_regions, warnings, unsupported, validation_status, validation_errors, document_hash, normalized_path


def _build_session(
    *,
    session_id: str,
    document_path: str | None,
    addin_version: str | None,
    host: str,
    validation_status: str,
    validation_errors: list[str],
    warnings: list[str],
    unsupported_features: list[str],
    regions: list[dict[str, Any]],
    document_hash: str | None,
) -> dict[str, Any]:
    timestamp = _now_iso()
    return {
        "session_id": session_id,
        "document_path": document_path,
        "document_version": 1,
        "host": host,
        "addin_version": addin_version,
        "schema_version": "1.0",
        "created_at": timestamp,
        "updated_at": timestamp,
        "validation_status": validation_status,
        "validation_errors": validation_errors,
        "warnings": warnings,
        "unsupported_features": unsupported_features,
        "regions": regions,
        "document_hash": document_hash,
        "last_action": "session_opened",
    }


def open_word_live_session(
    *,
    document_path: str | None,
    docx_b64: str | None = None,
    addin_version: str | None = None,
    host: str = "word-desktop",
    regions: list[dict[str, Any]] | None = None,
) -> dict[str, Any]:
    normalized_path = _normalize_document_path(document_path)
    docx_bytes = _load_docx_bytes(normalized_path, docx_b64)
    validation_status, validation_errors, document_hash = _validate_docx(docx_bytes)
    extracted_regions = extract_regions_from_docx_bytes(docx_bytes) if docx_bytes else []
    warnings, unsupported = analyze_docx_capabilities(docx_bytes) if docx_bytes else ([], [])
    merged_regions = _merge_regions(extracted_regions, [_normalize_region(item) for item in (regions or [])])
    session = _build_session(
        session_id=secrets.token_urlsafe(18),
        document_path=normalized_path,
        addin_version=(str(addin_version).strip() or None) if addin_version else None,
        host=str(host or "word-desktop"),
        validation_status=validation_status,
        validation_errors=validation_errors,
        warnings=warnings,
        unsupported_features=unsupported,
        regions=merged_regions,
        document_hash=document_hash,
    )
    with _CACHE_LOCK:
        _save_session_locked(session)
    return deepcopy(session)


def reset_word_live_cache() -> None:
    global _SESSIONS
    with _CACHE_LOCK:
        _SESSIONS = None


def get_word_live_session(session_id: str) -> dict[str, Any] | None:
    key = str(session_id or "").strip()
    if not key:
        return None
    with _CACHE_LOCK:
        _load_cache_locked()
        session = _SESSIONS.get(key)
        return deepcopy(session) if session else None


def list_word_live_regions(session_id: str) -> list[dict[str, Any]]:
    session = get_word_live_session(session_id)
    if not session:
        raise KeyError("Sesion no encontrada")
    return list(session.get("regions") or [])


def _ensure_region(session: dict[str, Any], region_id: str, op: str) -> dict[str, Any]:
    for region in session.get("regions") or []:
        if region.get("region_id") != str(region_id or "").strip():
            continue
        if op not in set(region.get("allowed_ops") or []):
            raise ValueError(f"La región '{region_id}' no permite {op}")
        return region
    raise KeyError(f"Region no encontrada: {region_id}")


def _bump_session(
    session: dict[str, Any],
    *,
    action: str,
    addin_version: str | None,
    document_version: int | None = None,
) -> dict[str, Any]:
    session["updated_at"] = _now_iso()
    session["last_action"] = action
    session["document_version"] = int(document_version or (int(session.get("document_version") or 0) + 1))
    if addin_version:
        session["addin_version"] = str(addin_version).strip() or session.get("addin_version")
    return session


def _check_document_version(session: dict[str, Any], document_version: int | None) -> None:
    if document_version is None:
        return
    if int(document_version) != int(session.get("document_version") or 0):
        raise ValueError("document_version no coincide con la sesión")


def update_word_live_text_region(
    *,
    session_id: str,
    region_id: str,
    text: str,
    document_version: int | None = None,
    document_path: str | None = None,
    docx_b64: str | None = None,
    addin_version: str | None = None,
) -> dict[str, Any]:
    with _CACHE_LOCK:
        _load_cache_locked()
        session = deepcopy(_SESSIONS.get(str(session_id or "").strip()) or {})
        if not session:
            raise KeyError("Sesion no encontrada")
        _check_document_version(session, document_version)
        region = _ensure_region(session, region_id, "update_text")
        region["text_preview"] = re.sub(r"\s+", " ", str(text or "").strip()) or None
        region["source"] = "word"
        if docx_b64 or document_path:
            (
                session["regions"],
                session["warnings"],
                session["unsupported_features"],
                session["validation_status"],
                session["validation_errors"],
                session["document_hash"],
                session["document_path"],
            ) = _refresh_session_document(
                session,
                document_path=document_path,
                docx_b64=docx_b64,
                regions=[region],
            )
        _save_session_locked(_bump_session(session, action="region_text_updated", addin_version=addin_version))
        return deepcopy(session)


def _validate_fragment_for_kind(fragment_ooxml: str, kind: str) -> ET.Element:
    try:
        root = ET.fromstring(fragment_ooxml)
    except ET.ParseError as exc:
        raise ValueError(f"fragment_ooxml invalido: {exc}") from exc
    if kind == "table" and root.find(".//w:tbl", WORD_NS) is None and root.tag != _qn("w", "tbl"):
        raise ValueError("El fragmento de una región table debe contener w:tbl")
    if kind == "math":
        has_math = root.find(".//m:oMath", WORD_NS) is not None or root.find(".//m:oMathPara", WORD_NS) is not None
        if root.tag not in {_qn("m", "oMath"), _qn("m", "oMathPara")} and not has_math:
            raise ValueError("El fragmento de una región math debe contener OMML")
    if kind == "image":
        has_image = root.find(".//w:drawing", WORD_NS) is not None or root.find(".//w:pict", WORD_NS) is not None
        if root.tag not in {_qn("w", "drawing"), _qn("w", "pict")} and not has_image:
            raise ValueError("El fragmento de una región image debe contener drawing/pict")
    if kind == "section-block":
        block_tags = {_qn("w", "p"), _qn("w", "tbl"), _qn("w", "sdtContent")}
        if root.tag not in block_tags and not any(node.tag in block_tags for node in root.iter()):
            raise ValueError("El fragmento de una región section-block debe contener bloques Word")
    return root


def replace_word_live_region_fragment(
    *,
    session_id: str,
    region_id: str,
    fragment_ooxml: str,
    document_version: int | None = None,
    document_path: str | None = None,
    docx_b64: str | None = None,
    addin_version: str | None = None,
) -> dict[str, Any]:
    with _CACHE_LOCK:
        _load_cache_locked()
        session = deepcopy(_SESSIONS.get(str(session_id or "").strip()) or {})
        if not session:
            raise KeyError("Sesion no encontrada")
        _check_document_version(session, document_version)
        region = _ensure_region(session, region_id, "replace_fragment")
        if not bool(region.get("supports_ooxml_replace")):
            raise ValueError(f"La región '{region_id}' no soporta reemplazo OOXML")
        fragment_root = _validate_fragment_for_kind(fragment_ooxml, str(region.get("kind") or "section-block"))
        region["text_preview"] = _text_preview(fragment_root)
        region["source"] = "word"
        if docx_b64 or document_path:
            (
                session["regions"],
                session["warnings"],
                session["unsupported_features"],
                session["validation_status"],
                session["validation_errors"],
                session["document_hash"],
                session["document_path"],
            ) = _refresh_session_document(
                session,
                document_path=document_path,
                docx_b64=docx_b64,
                regions=[region],
            )
        _save_session_locked(_bump_session(session, action="region_fragment_replaced", addin_version=addin_version))
        return deepcopy(session)


def resync_word_live_session(
    *,
    session_id: str,
    document_path: str | None = None,
    docx_b64: str | None = None,
    regions: list[dict[str, Any]] | None = None,
    addin_version: str | None = None,
    document_version: int | None = None,
) -> dict[str, Any]:
    with _CACHE_LOCK:
        _load_cache_locked()
        session = deepcopy(_SESSIONS.get(str(session_id or "").strip()) or {})
        if not session:
            raise KeyError("Sesion no encontrada")
        (
            session["regions"],
            session["warnings"],
            session["unsupported_features"],
            session["validation_status"],
            session["validation_errors"],
            session["document_hash"],
            session["document_path"],
        ) = _refresh_session_document(
            session,
            document_path=document_path,
            docx_b64=docx_b64,
            regions=regions,
        )
        _save_session_locked(
            _bump_session(
                session,
                action="session_resynced",
                addin_version=addin_version,
                document_version=document_version,
            )
        )
        return deepcopy(session)


def _require_word_live_launcher_supported() -> None:
    if sys.platform != "win32":
        raise RuntimeError("Word Live launcher solo soportado en Windows por ahora")
    if not _manifest_path().exists():
        raise RuntimeError("Manifest de Word Live no encontrado")
    if not _frontend_dir().exists():
        raise RuntimeError("Directorio frontend no encontrado para registrar el add-in")


def _pick_docx_path_windows(initial_directory: str | None = None) -> str | None:
    start_dir = ""
    if initial_directory:
        try:
            candidate = Path(initial_directory).expanduser().resolve()
            start_dir = str(candidate if candidate.is_dir() else candidate.parent)
        except Exception:
            start_dir = ""
    escaped_start_dir = start_dir.replace("'", "''")
    command = f"""
Add-Type -AssemblyName System.Windows.Forms
$dialog = New-Object System.Windows.Forms.OpenFileDialog
$dialog.Title = 'Selecciona un documento Word para abrir con Inspyro Word Live'
$dialog.Filter = 'Documentos Word (*.docx)|*.docx|Todos los archivos (*.*)|*.*'
$dialog.Multiselect = $false
$dialog.CheckFileExists = $true
$dialog.RestoreDirectory = $true
if ('{escaped_start_dir}' -ne '') {{
  try {{ $dialog.InitialDirectory = '{escaped_start_dir}' }} catch {{ }}
}}
if ($dialog.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) {{
  [Console]::Out.Write($dialog.FileName)
}}
"""
    result = subprocess.run(
        ["powershell.exe", "-NoProfile", "-STA", "-Command", command],
        capture_output=True,
        text=True,
        timeout=300,
        creationflags=_subprocess_creation_flags(),
        check=False,
    )
    if result.returncode != 0:
        stderr = (result.stderr or result.stdout or "").strip()
        raise RuntimeError(stderr or "No se pudo abrir el selector nativo de documentos Word")
    selected = (result.stdout or "").strip()
    return selected or None


def pick_word_live_document_path(initial_directory: str | None = None) -> str | None:
    _require_word_live_launcher_supported()
    return _pick_docx_path_windows(initial_directory)


def _registered_addins_output() -> str:
    result = subprocess.run(
        [_npx_executable(), "office-addin-dev-settings", "registered"],
        cwd=str(_frontend_dir()),
        capture_output=True,
        text=True,
        timeout=120,
        creationflags=_subprocess_creation_flags(),
        check=False,
    )
    if result.returncode != 0:
        stderr = (result.stderr or result.stdout or "").strip()
        raise RuntimeError(stderr or "No se pudo consultar el registro de add-ins de Office")
    return (result.stdout or "").strip()


def is_word_live_addin_registered() -> bool:
    manifest_path = str(_manifest_path())
    addin_id = _word_live_addin_id()
    registered_output = _registered_addins_output()
    return addin_id in registered_output and manifest_path in registered_output


def install_word_live_addin() -> dict[str, Any]:
    _require_word_live_launcher_supported()
    manifest_path = _manifest_path()
    subprocess.run(
        [_npx_executable(), "office-addin-dev-settings", "register", str(manifest_path)],
        cwd=str(_frontend_dir()),
        capture_output=True,
        text=True,
        timeout=180,
        creationflags=_subprocess_creation_flags(),
        check=True,
    )
    return {
        "installed": True,
        "registered": is_word_live_addin_registered(),
        "addin_id": _word_live_addin_id(),
        "manifest_path": str(manifest_path),
        "platform": sys.platform,
    }


def _normalize_word_live_document_path(raw_path: str) -> str:
    normalized = _normalize_document_path(raw_path)
    if not normalized:
        raise ValueError("document_path requerido")
    if Path(normalized).suffix.lower() != ".docx":
        raise ValueError("Solo se soportan archivos .docx")
    return normalized


def _get_word_application():
    try:
        import pythoncom
        import win32com.client
    except ImportError as exc:  # pragma: no cover - depende de pywin32 en host Windows
        raise RuntimeError("pywin32 no disponible para automatizar Word") from exc

    pythoncom.CoInitialize()
    app = win32com.client.Dispatch("Word.Application")
    app.Visible = True
    return app


def _iter_word_documents(app) -> list[Any]:
    documents = getattr(app, "Documents", None)
    if documents is None:
        return []
    count = int(getattr(documents, "Count", 0) or 0)
    items: list[Any] = []
    for index in range(1, count + 1):
        try:
            items.append(documents.Item(index))
        except Exception:
            continue
    return items


def _find_sideload_document(app):
    for document in _iter_word_documents(app):
        try:
            name = str(getattr(document, "Name", "") or "")
        except Exception:
            continue
        if name.startswith(WORD_LIVE_TEMP_DOC_PREFIX):
            return document
    return None


def _wait_for_sideload_document(timeout_seconds: float = 45.0):
    deadline = time.time() + timeout_seconds
    last_error: Exception | None = None
    while time.time() < deadline:
        try:
            app = _get_word_application()
            sideload_doc = _find_sideload_document(app)
            if sideload_doc is not None:
                return app, sideload_doc
        except Exception as exc:  # pragma: no cover - depende del host Word
            last_error = exc
        time.sleep(0.5)
    if last_error is not None:
        raise RuntimeError(f"No se detectó la ventana de Word Live: {last_error}") from last_error
    raise RuntimeError("No se detectó la ventana de Word Live")


def _activate_word_document(document) -> None:
    try:
        document.Activate()
    except Exception:
        return
    try:
        windows = getattr(document, "Windows", None)
        if windows and int(getattr(windows, "Count", 0) or 0) >= 1:
            windows.Item(1).WindowState = WD_WINDOW_STATE_NORMAL
            windows.Item(1).Activate()
    except Exception:
        return


def _minimize_word_document(document) -> None:
    try:
        windows = getattr(document, "Windows", None)
        if windows and int(getattr(windows, "Count", 0) or 0) >= 1:
            windows.Item(1).WindowState = WD_WINDOW_STATE_MINIMIZE
    except Exception:
        return


def _find_document_by_path(app, document_path: str):
    normalized_target = str(Path(document_path).resolve()).lower()
    for document in _iter_word_documents(app):
        try:
            full_name = str(Path(str(getattr(document, "FullName", "") or "")).resolve()).lower()
        except Exception:
            continue
        if full_name == normalized_target:
            return document
    return None


def _open_or_activate_target_document(app, document_path: str):
    existing = _find_document_by_path(app, document_path)
    if existing is not None:
        _activate_word_document(existing)
        return existing, True
    opened = app.Documents.Open(
        str(document_path),
        ConfirmConversions=False,
        ReadOnly=False,
        AddToRecentFiles=True,
    )
    _activate_word_document(opened)
    return opened, False


def _launch_word_live_host() -> None:
    subprocess.run(
        [_npx_executable(), "office-addin-dev-settings", "sideload", str(_manifest_path()), "desktop", "-a", "Word"],
        cwd=str(_frontend_dir()),
        capture_output=True,
        text=True,
        timeout=180,
        creationflags=_subprocess_creation_flags(),
        check=True,
    )


def open_word_live_launcher(
    *,
    document_path: str | None = None,
    use_picker: bool = True,
    initial_directory: str | None = None,
) -> dict[str, Any]:
    _require_word_live_launcher_supported()
    selected_path = _normalize_word_live_document_path(document_path) if document_path else None
    if use_picker or not selected_path:
        picked = pick_word_live_document_path(initial_directory=initial_directory)
        if not picked:
            return {
                "cancelled": True,
                "document_path": None,
                "installed": is_word_live_addin_registered(),
                "launched": False,
                "message": "Selección cancelada por el usuario",
            }
        selected_path = _normalize_word_live_document_path(picked)

    install_payload = install_word_live_addin()
    _launch_word_live_host()
    app, sideload_document = _wait_for_sideload_document()
    target_document, already_open = _open_or_activate_target_document(app, selected_path)
    _minimize_word_document(sideload_document)
    _activate_word_document(target_document)
    return {
        "cancelled": False,
        "launched": True,
        "installed": bool(install_payload.get("installed")),
        "registered": bool(install_payload.get("registered")),
        "document_path": selected_path,
        "already_open": already_open,
        "host_document_name": str(getattr(sideload_document, "Name", "") or ""),
        "target_document_name": str(getattr(target_document, "Name", "") or ""),
        "message": "Word Live abierto en la misma instancia de Word",
    }
