"""
Servicio de conversión DOCX a PDF.

Este módulo centraliza la lógica de conversión de documentos DOCX a PDF,
soportando múltiples backends:
1. Microsoft Word (COM automation) - Primario en Windows
2. LibreOffice (soffice headless) - Fallback multiplataforma
"""

import asyncio
import base64
import hashlib
import json
import os
import posixpath
import re
import shutil
import subprocess
import sys
import tempfile
import zipfile
import io
import logging
import time
import threading
import xml.etree.ElementTree as ET
from pathlib import Path
from collections import OrderedDict
from typing import Awaitable, Callable, Optional
from concurrent.futures import Executor, ThreadPoolExecutor

from librerias_propias.docx_builder.utils import validate_docx_package_bytes

# =============================================================================
# DETECCIÓN DE CONVERSORES DISPONIBLES
# =============================================================================

# Buscar LibreOffice (validate the binary belongs to a LibreOffice installation)
def _find_soffice() -> str | None:
    for cmd in ('soffice', 'libreoffice'):
        path = shutil.which(cmd)
        if path:
            # On Windows, verify it's inside a LibreOffice directory
            if os.name == 'nt':
                norm = os.path.normpath(path).lower()
                if 'libreoffice' in norm:
                    return path
            else:
                return path
    if os.name == 'nt':
        for p in (
            r"C:\Program Files\LibreOffice\program\soffice.exe",
            r"C:\Program Files (x86)\LibreOffice\program\soffice.exe",
        ):
            if os.path.exists(p):
                return p
    return None

_SOFFICE_PATH = _find_soffice()


PDF_CONVERT_AVAILABLE = _SOFFICE_PATH is not None

# Check for MS Word availability (Windows only)
MS_WORD_AVAILABLE = False
if os.name == 'nt':
    try:
        import win32com.client
        import pythoncom
        MS_WORD_AVAILABLE = True
    except ImportError:
        pass

# =============================================================================
# CONFIGURACIÓN
# =============================================================================

DOCX_MAX_BYTES = max(0, int(os.getenv("INSPYRO_PDF_MAX_DOCX_BYTES", "0")))  # 0 = sin límite
PDF_CACHE_MAX_ENTRIES = 128
PDF_CONVERT_TIMEOUT_S = int(os.getenv("INSPYRO_PDF_TIMEOUT", "600"))
PDF_DEBOUNCE_SECONDS = 1.0  # Mínimo 1 segundo entre conversiones
DOCX_VALIDATION_CACHE_MAX_ENTRIES = 128
PDF_GENERIC_EXECUTOR_MAX_WORKERS = max(
    2,
    int(os.getenv("INSPYRO_PDF_CONVERTER_MAX_WORKERS", str(min(4, max(2, os.cpu_count() or 2))))),
)

# =============================================================================
# CACHE DE PDF
# =============================================================================

_pdf_cache: "OrderedDict[str, str]" = OrderedDict()
_pdf_cache_lock = threading.Lock()  # Protects _pdf_cache, _pdf_cache_hits, _pdf_conversions, _pdf_conversion_durations
_pdf_cache_hits: int = 0
_pdf_conversions: int = 0
_pdf_conversion_durations: list[int] = []  # últimas duraciones ms (cap 500)
_pdf_last_conversion_time: dict[str, float] = {}  # kernel_id -> timestamp
# Microsoft Word COM is unstable under concurrent conversions; serialize globally.
_word_conversion_lock = threading.Lock()
_docx_validation_cache: "OrderedDict[str, tuple[bool, str | None]]" = OrderedDict()
_pdf_generic_executor = ThreadPoolExecutor(
    max_workers=PDF_GENERIC_EXECUTOR_MAX_WORKERS,
    thread_name_prefix="inspyro-pdf",
)
_pdf_word_executor = ThreadPoolExecutor(
    max_workers=1,
    thread_name_prefix="inspyro-word-pdf",
)
_pdf_word_async_gate = asyncio.Lock()

_logger = logging.getLogger(__name__)


def _approx_b64_size_bytes(b64_text: str) -> int:
    padding = len(b64_text) - len(b64_text.rstrip("="))
    return max(0, (len(b64_text) * 3 // 4) - padding)


def _elapsed_ms(started_at: float | None) -> int | None:
    if started_at is None:
        return None
    return int((time.perf_counter() - started_at) * 1000)


def _inject_queue_wait_timing(
    result: tuple[dict, str | None, str | None, bool],
    queue_wait_ms: int | None,
) -> tuple[dict, str | None, str | None, bool]:
    if not queue_wait_ms or queue_wait_ms <= 0:
        return result
    pdf_diag, pdf_b64, pdf_hash, from_cache = result
    if not isinstance(pdf_diag, dict):
        return result
    stage_timings_ms = dict(pdf_diag.get("stage_timings_ms") or {})
    stage_timings_ms["pdf_queue_wait_ms"] = int(queue_wait_ms)
    updated_diag = dict(pdf_diag)
    updated_diag["stage_timings_ms"] = stage_timings_ms
    return updated_diag, pdf_b64, pdf_hash, from_cache


def _build_docx_too_large_result(size_bytes: int) -> dict:
    limit = DOCX_MAX_BYTES
    return {
        "attempted": False,
        "pdf_b64": None,
        "stdout": None,
        "stderr": (
            f"docx too large: received {size_bytes} bytes, configured max {limit} bytes"
            if limit > 0
            else "docx too large"
        ),
        "duration_ms": None,
        "error": "too_large",
        "error_kind": "input",
        "docx_size_bytes": size_bytes,
        "pdf_size_bytes": None,
        "converter_used": None,
        "word_error": None,
        "max_docx_bytes": limit,
    }


def pdf_cache_get(docx_hash: str | None) -> str | None:
    """Obtiene un PDF del cache si existe."""
    global _pdf_cache_hits
    if not docx_hash:
        return None
    with _pdf_cache_lock:
        try:
            value = _pdf_cache[docx_hash]
            _pdf_cache.move_to_end(docx_hash)
            _pdf_cache_hits += 1
            return value
        except KeyError:
            return None


def pdf_cache_set(docx_hash: str, pdf_b64: str) -> None:
    """Guarda un PDF en el cache."""
    with _pdf_cache_lock:
        _pdf_cache[docx_hash] = pdf_b64
        _pdf_cache.move_to_end(docx_hash)
        while len(_pdf_cache) > PDF_CACHE_MAX_ENTRIES:
            try:
                _pdf_cache.popitem(last=False)
            except Exception:
                break


def get_cache_stats() -> dict:
    """Retorna estadísticas del cache."""
    with _pdf_cache_lock:
        return {
            "entries": len(_pdf_cache),
            "hits": _pdf_cache_hits,
            "conversions": _pdf_conversions,
            "hit_ratio": _pdf_cache_hits / (_pdf_cache_hits + _pdf_conversions) if (_pdf_cache_hits + _pdf_conversions) > 0 else 0.0
        }


def get_latency_quantiles() -> tuple[int | None, int | None]:
    """Calcula percentiles de latencia (p50, p95)."""
    with _pdf_cache_lock:
        if not _pdf_conversion_durations:
            return None, None
        data = sorted(_pdf_conversion_durations)
    
    def _q(p: float) -> int | None:
        if not data:
            return None
        k = (len(data) - 1) * p
        f = int(k)
        c = min(f + 1, len(data) - 1)
        if f == c:
            return data[f]
        return int(data[f] + (data[c] - data[f]) * (k - f))
    
    return _q(0.5), _q(0.95)


# =============================================================================
# HASH SEMÁNTICO
# =============================================================================

def compute_docx_semantic_hash(docx_b64: str) -> tuple[str, str]:
    """Calcula el hash semántico de un DOCX eliminando atributos volátiles.
    
    Retorna (semantic_hash, binary_hash). El hash semántico ignora rsid*, paraId,
    textId y editId para permitir comparaciones estables entre ejecuciones.
    Incluye estilos/tema/listas y headers/footers para reflejar cambios de plantilla.
    """
    binary_hash = hashlib.sha256(docx_b64.encode()).hexdigest()
    semantic_hash = binary_hash  # fallback

    def _clean_xml(xml: str) -> str:
        xml = re.sub(r'\s(w(?::|14:)?(?:rsid\w*|paraId|textId|editId))="[^"]+"', '', xml)
        return re.sub(r'\s+', ' ', xml).strip()

    try:
        raw = base64.b64decode(docx_b64)
        zf = zipfile.ZipFile(io.BytesIO(raw))
        parts: list[str] = []

        def _read_part(name: str) -> None:
            try:
                xml = zf.read(name).decode("utf-8", "ignore")
            except KeyError:
                return
            if xml:
                parts.append(_clean_xml(xml))

        # Core document + template-defining parts
        for name in (
            "word/document.xml",
            "word/styles.xml",
            "word/numbering.xml",
            "word/theme/theme1.xml",
            "word/settings.xml",
            "word/fontTable.xml",
        ):
            _read_part(name)

        # Include headers/footers which commonly come from templates
        for name in sorted(zf.namelist()):
            if name.startswith("word/header") and name.endswith(".xml"):
                _read_part(name)
            elif name.startswith("word/footer") and name.endswith(".xml"):
                _read_part(name)

        if parts:
            semantic_hash = hashlib.sha256("\n".join(parts).encode("utf-8")).hexdigest()
    except Exception:
        pass

    return semantic_hash, binary_hash


# =============================================================================
# VALIDACIÓN DE ESTRUCTURA DOCX
# =============================================================================

def _validate_relationship_targets(zf: zipfile.ZipFile, names: set[str]) -> tuple[bool, str | None]:
    rel_files = [name for name in names if name.endswith(".rels")]
    for rel_path in rel_files:
        try:
            rel_root = ET.fromstring(zf.read(rel_path))
        except ET.ParseError as exc:
            return False, f"XML malformado en {rel_path}: {exc}"
        except Exception as exc:
            return False, f"Error parseando {rel_path}: {type(exc).__name__}"

        rels_dir = posixpath.dirname(rel_path)
        source_dir = posixpath.dirname(rels_dir) if rels_dir.endswith("_rels") else rels_dir

        for rel in list(rel_root):
            if not str(rel.tag).endswith("Relationship"):
                continue
            target = rel.attrib.get("Target")
            target_mode = (rel.attrib.get("TargetMode") or "").lower()
            if not target or target_mode == "external":
                continue

            if target.startswith("/"):
                resolved = target.lstrip("/")
            else:
                resolved = posixpath.normpath(posixpath.join(source_dir, target))
            resolved = resolved.lstrip("./")

            if resolved.startswith("../"):
                rel_id = rel.attrib.get("Id") or "<sin-id>"
                return False, f"Relación inválida en {rel_path} ({rel_id}): Target fuera del paquete ({target})"
            if resolved not in names:
                rel_id = rel.attrib.get("Id") or "<sin-id>"
                return False, f"Relación rota en {rel_path} ({rel_id}): falta {resolved}"

    return True, None


def _validate_docx_structure_bytes_uncached(raw: bytes) -> tuple[bool, str | None]:
    try:
        is_valid, errors = validate_docx_package_bytes(raw)
        if not is_valid:
            return False, errors[0] if errors else "DOCX invalid"
        return True, None
    except Exception as exc:
        return False, f"Error de validación: {type(exc).__name__}: {str(exc)[:100]}"

    buffer = io.BytesIO(raw)
    if not zipfile.is_zipfile(buffer):
        return False, "El archivo no es un ZIP válido (DOCX corrupto)"

    buffer.seek(0)
    try:
        with zipfile.ZipFile(buffer, "r") as zf:
            names = zf.namelist()
            name_set = set(names)

            if "word/document.xml" not in name_set:
                return False, "Falta word/document.xml (DOCX incompleto)"
            if "[Content_Types].xml" not in name_set:
                return False, "Falta [Content_Types].xml (DOCX incompleto)"

            for part_name in names:
                if not part_name.lower().endswith(".xml"):
                    continue
                try:
                    ET.fromstring(zf.read(part_name))
                except ET.ParseError as exc:
                    return False, f"XML malformado en {part_name}: {exc}"
                except Exception as exc:
                    return False, f"Error parseando {part_name}: {type(exc).__name__}"

            try:
                doc_root = ET.fromstring(zf.read("word/document.xml"))
                body = doc_root.find(".//{http://schemas.openxmlformats.org/wordprocessingml/2006/main}body")
                if body is None:
                    return False, "Estructura DOCX inválida: falta elemento <w:body>"
            except ET.ParseError as exc:
                return False, f"XML malformado en word/document.xml: {exc}"
            except Exception as exc:
                return False, f"Error parseando word/document.xml: {type(exc).__name__}"

            try:
                content_types = ET.fromstring(zf.read("[Content_Types].xml"))
                for node in list(content_types):
                    if not str(node.tag).endswith("Override"):
                        continue
                    part_name = (node.attrib.get("PartName") or "").lstrip("/")
                    if part_name and part_name not in name_set:
                        return False, f"[Content_Types].xml referencia parte faltante: {part_name}"
            except ET.ParseError as exc:
                return False, f"XML malformado en [Content_Types].xml: {exc}"
            except Exception as exc:
                return False, f"Error parseando [Content_Types].xml: {type(exc).__name__}"

            rel_ok, rel_error = _validate_relationship_targets(zf, name_set)
            if not rel_ok:
                return False, rel_error
    except zipfile.BadZipFile:
        return False, "El archivo no es un ZIP válido (DOCX corrupto)"
    except Exception as exc:
        return False, f"Error de validación: {type(exc).__name__}: {str(exc)[:100]}"

    return True, None


def _validate_docx_structure_bytes_cached(raw: bytes) -> tuple[bool, str | None, bool]:
    cache_key = hashlib.sha256(raw).hexdigest()
    with _pdf_cache_lock:
        cached = _docx_validation_cache.get(cache_key)
        if cached is not None:
            _docx_validation_cache.move_to_end(cache_key)
            return cached[0], cached[1], True

    result = _validate_docx_structure_bytes_uncached(raw)
    with _pdf_cache_lock:
        _docx_validation_cache[cache_key] = result
        _docx_validation_cache.move_to_end(cache_key)
        while len(_docx_validation_cache) > DOCX_VALIDATION_CACHE_MAX_ENTRIES:
            _docx_validation_cache.popitem(last=False)
    return result[0], result[1], False


def _validate_docx_structure_bytes(raw: bytes) -> tuple[bool, str | None]:
    is_valid, error, _ = _validate_docx_structure_bytes_cached(raw)
    return is_valid, error


def _looks_like_word_corruption_error(error_text: Optional[str]) -> bool:
    if not error_text:
        return False
    lowered = str(error_text).lower()
    markers = (
        "corrompido",
        "corrupt",
        "damaged",
        "el archivo parece estar corrompido",
        "-2146822496",
    )
    return any(marker in lowered for marker in markers)


def _repair_docx_with_libreoffice(raw: bytes, timeout_s: int, max_len: int = 800) -> tuple[bytes | None, str | None]:
    """Attempt DOCX->DOCX roundtrip in LibreOffice to recover malformed packages."""
    if not PDF_CONVERT_AVAILABLE or not _SOFFICE_PATH:
        return None, "libreoffice_unavailable"

    try:
        with tempfile.TemporaryDirectory() as tmp:
            in_docx = os.path.join(tmp, "source.docx")
            out_dir = os.path.join(tmp, "repair_out")
            profile_dir = os.path.join(tmp, "repair_profile")
            os.makedirs(out_dir, exist_ok=True)
            os.makedirs(profile_dir, exist_ok=True)

            with open(in_docx, "wb") as f:
                f.write(raw)

            cmd = [
                _SOFFICE_PATH,
                f"-env:UserInstallation={Path(profile_dir).as_uri()}",
                "--headless",
                "--convert-to", "docx",
                "--outdir", out_dir,
                "--norestore",
                "--writer",
                in_docx,
            ]
            proc = subprocess.run(
                cmd,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                timeout=max(5, int(timeout_s)),
            )
            stdout_txt = (proc.stdout.decode(errors="ignore") or "").strip()
            stderr_txt = (proc.stderr.decode(errors="ignore") or "").strip()
            if proc.returncode != 0:
                err = stderr_txt or stdout_txt or f"repair_return_code_{proc.returncode}"
                return None, err[:max_len]

            repaired_path = os.path.join(out_dir, "source.docx")
            if not os.path.exists(repaired_path):
                return None, "repair_missing_output_docx"

            repaired_bytes = Path(repaired_path).read_bytes()
            if not repaired_bytes:
                return None, "repair_empty_output_docx"

            valid, validation_error = _validate_docx_structure_bytes(repaired_bytes)
            if not valid:
                return None, f"repair_invalid_docx: {validation_error}"
            return repaired_bytes, None
    except subprocess.TimeoutExpired:
        return None, f"repair_timeout_{timeout_s}s"
    except Exception as exc:
        return None, f"repair_exception:{type(exc).__name__}"


def validate_docx_structure(docx_b64: str) -> tuple[bool, str | None]:
    """Valida la estructura del DOCX antes de intentar conversión."""
    try:
        raw = base64.b64decode(docx_b64)
    except Exception as exc:
        return False, f"Base64 inválido: {type(exc).__name__}"
    return _validate_docx_structure_bytes(raw)

# =============================================================================
# CONVERSIÓN CON WORD (COM)
# =============================================================================

def _convert_to_pdf_word(docx_path: str, pdf_path: str) -> dict:
    """Intenta convertir DOCX a PDF usando Microsoft Word via COM."""
    if not MS_WORD_AVAILABLE:
        return {"success": False, "error": "word_unavailable"}
    
    word_app = None
    doc = None
    try:
        # Initialize COM in this thread
        pythoncom.CoInitialize()
        # Create Word instance (headless)
        word_app = win32com.client.Dispatch("Word.Application")
        word_app.Visible = False
        word_app.DisplayAlerts = 0  # wdAlertsNone
        
        abs_docx = os.path.abspath(docx_path)
        abs_pdf = os.path.abspath(pdf_path)
        
        # Open document
        doc = word_app.Documents.Open(abs_docx, ReadOnly=True, AddToRecentFiles=False)
        
        # wdExportFormatPDF = 17
        doc.ExportAsFixedFormat(
            OutputFileName=abs_pdf,
            ExportFormat=17,
            OpenAfterExport=False,
            OptimizeFor=0,  # wdExportOptimizeForPrint
            CreateBookmarks=1,  # wdExportCreateHeadingBookmarks
            DocStructureTags=True
        )
        return {"success": True}
        
    except Exception as e:
        return {"success": False, "error": str(e), "error_kind": type(e).__name__}
    finally:
        if doc:
            try:
                doc.Close(SaveChanges=0)  # wdDoNotSaveChanges
            except Exception:
                pass
        if word_app:
            try:
                word_app.Quit()
            except Exception:
                pass
        try:
            pythoncom.CoUninitialize()
        except Exception:
            pass


# =============================================================================
# CONVERSIÓN PRINCIPAL
# =============================================================================

def _convert_to_pdf_word_with_timeout(docx_path: str, pdf_path: str, timeout_s: int) -> dict:
    """Run Word conversion in a subprocess so timeout can be enforced safely."""
    if not MS_WORD_AVAILABLE:
        return {"success": False, "error": "word_unavailable"}

    runner = """
import json
import os
import sys

def run(docx_path, pdf_path):
    word_app = None
    doc = None
    try:
        import pythoncom
        import win32com.client
        pythoncom.CoInitialize()
        word_app = win32com.client.Dispatch("Word.Application")
        word_app.Visible = False
        word_app.DisplayAlerts = 0
        doc = word_app.Documents.Open(os.path.abspath(docx_path), ReadOnly=True, AddToRecentFiles=False)
        doc.ExportAsFixedFormat(
            OutputFileName=os.path.abspath(pdf_path),
            ExportFormat=17,
            OpenAfterExport=False,
            OptimizeFor=0,
            CreateBookmarks=1,
            DocStructureTags=True
        )
        return {"success": True}
    except Exception as exc:
        return {"success": False, "error": str(exc), "error_kind": type(exc).__name__}
    finally:
        if doc is not None:
            try:
                doc.Close(SaveChanges=0)
            except Exception:
                pass
        if word_app is not None:
            try:
                word_app.Quit()
            except Exception:
                pass
        try:
            import pythoncom
            pythoncom.CoUninitialize()
        except Exception:
            pass

if __name__ == "__main__":
    result = run(sys.argv[1], sys.argv[2])
    print(json.dumps(result))
"""

    cmd = [sys.executable, "-c", runner, os.path.abspath(docx_path), os.path.abspath(pdf_path)]
    try:
        proc = subprocess.run(
            cmd,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            timeout=max(1, int(timeout_s)),
            text=True,
            encoding="utf-8",
            errors="ignore",
        )
    except subprocess.TimeoutExpired:
        return {"success": False, "error": f"word_timeout_{timeout_s}s", "error_kind": "timeout"}
    except Exception as exc:
        return {"success": False, "error": f"word_subprocess_exception:{exc}", "error_kind": type(exc).__name__}

    stdout = (proc.stdout or "").strip()
    stderr = (proc.stderr or "").strip()
    if proc.returncode != 0:
        err = stderr or stdout or f"word_subprocess_rc_{proc.returncode}"
        return {"success": False, "error": err[:800], "error_kind": "subprocess"}

    if not stdout:
        return {"success": False, "error": "word_subprocess_empty_output", "error_kind": "subprocess"}

    try:
        parsed = json.loads(stdout)
        if isinstance(parsed, dict):
            return parsed
        return {"success": False, "error": "word_subprocess_invalid_json", "error_kind": "subprocess"}
    except Exception:
        return {"success": False, "error": f"word_subprocess_parse_error:{stdout[:800]}", "error_kind": "subprocess"}


def convert_docx_with_diagnostics(
    docx_b64: str | None,
    timeout_s: int | None = None,
    progress_callback: Callable[[str], None] | None = None
) -> dict:
    """Convierte un DOCX (base64) a PDF (base64) devolviendo diagnóstico completo.
    
    Intenta usar Microsoft Word primero si está disponible, luego LibreOffice.
    
    THREADING NOTE: This function is synchronous and MUST be called from a
    thread pool (e.g. via ``loop.run_in_executor(None, ...)``) when invoked
    from an async context. The ``_word_conversion_lock`` (``threading.Lock``)
    serializes Word COM access across threads, which is correct because COM
    requires single-threaded apartment (STA) semantics. Do NOT replace with
    ``asyncio.Lock`` — that would deadlock when used from a thread pool.
    
    The ``_pdf_cache_lock`` (also ``threading.Lock``) protects the global PDF
    cache and is safe to use from both sync and async callers.
    
    Args:
        docx_b64: Contenido DOCX codificado en base64
        timeout_s: Timeout en segundos para la conversión
        progress_callback: Callback para reportar progreso
    
    Returns:
        dict con campos: attempted, pdf_b64, stdout, stderr, duration_ms,
                        error, error_kind, docx_size_bytes, pdf_size_bytes
    """
    global _pdf_conversions, _pdf_conversion_durations
    
    if timeout_s is None:
        timeout_s = PDF_CONVERT_TIMEOUT_S
    MAX_LEN = 800
    stage_timings_ms: dict[str, int] = {}
    
    if not docx_b64:
        return {
            "attempted": False, "pdf_b64": None, "stdout": None, "stderr": None,
            "duration_ms": None, "error": "no_docx", "error_kind": "input",
            "docx_size_bytes": None, "pdf_size_bytes": None,
            "converter_used": None, "word_error": None,
            "max_docx_bytes": DOCX_MAX_BYTES,
            "stage_timings_ms": stage_timings_ms,
        }

    decode_started_at = time.perf_counter()
    try:
        raw = base64.b64decode(docx_b64, validate=True)
    except Exception as e:
        return {
            "attempted": False, "pdf_b64": None, "stdout": None,
            "stderr": str(e)[:MAX_LEN], "duration_ms": None, "error": "b64_decode_failed",
            "error_kind": "input", "docx_size_bytes": None, "pdf_size_bytes": None,
            "converter_used": None, "word_error": None,
            "max_docx_bytes": DOCX_MAX_BYTES,
            "stage_timings_ms": stage_timings_ms,
        }
    stage_timings_ms["b64_decode_ms"] = _elapsed_ms(decode_started_at) or 0

    if DOCX_MAX_BYTES and len(raw) > DOCX_MAX_BYTES:
        result = _build_docx_too_large_result(len(raw))
        result["stage_timings_ms"] = stage_timings_ms
        return result

    # Pre-validación de estructura DOCX para evitar que Word/LibreOffice se cuelguen
    validation_started_at = time.perf_counter()
    is_valid, validation_error, _ = _validate_docx_structure_bytes_cached(raw)
    validation_ms = _elapsed_ms(validation_started_at) or 0
    if not is_valid:
        repair_started_at = time.perf_counter()
        repaired_raw, repair_error = _repair_docx_with_libreoffice(raw, timeout_s, max_len=MAX_LEN)
        stage_timings_ms["docx_repair_ms"] = _elapsed_ms(repair_started_at) or 0
        if repaired_raw is not None:
            raw = repaired_raw
            revalidation_started_at = time.perf_counter()
            is_valid, validation_error, _ = _validate_docx_structure_bytes_cached(raw)
            validation_ms += _elapsed_ms(revalidation_started_at) or 0
        stage_timings_ms["pdf_validation_ms"] = validation_ms
        if not is_valid:
            msg = validation_error or "DOCX invalid"
            if repair_error:
                msg = f"{msg} | repair: {repair_error}"
            return {
                "attempted": False, "pdf_b64": None, "stdout": None,
                "stderr": msg[:MAX_LEN], "duration_ms": None,
                "error": "docx_validation_failed", "error_kind": "validation",
                "docx_size_bytes": len(raw), "pdf_size_bytes": None,
                "converter_used": None, "word_error": None,
                "max_docx_bytes": DOCX_MAX_BYTES,
                "stage_timings_ms": stage_timings_ms,
            }
    else:
        stage_timings_ms["pdf_validation_ms"] = validation_ms

    stdout_txt = stderr_txt = None
    duration_ms = None
    pdf_b64 = None
    error = None
    error_kind = None
    docx_size = len(raw) if raw else None
    pdf_size = None
    converter_used = None  # NEW: Track which converter succeeded
    word_error = None      # NEW: Capture Word error details for frontend
    
    with tempfile.TemporaryDirectory() as tmp:
        docx_path = os.path.join(tmp, 'in.docx')
        pdf_path = os.path.join(tmp, 'in.pdf')
        
        with open(docx_path, 'wb') as f:
            f.write(raw)
            
        t0 = time.perf_counter()
        pdf_convert_started_at = time.perf_counter()
        
        # 1. Attempt MS Word conversion first
        word_result = {"success": False}
        word_repair_error = None
        if MS_WORD_AVAILABLE:
            if progress_callback:
                try:
                    progress_callback("Convirtiendo a PDF usando Microsoft Word...")
                except Exception:
                    pass
            with _word_conversion_lock:
                word_result = _convert_to_pdf_word_with_timeout(docx_path, pdf_path, timeout_s)
                # Retry once after LibreOffice DOCX repair when Word reports corruption.
                if (
                    not word_result.get("success")
                    and _looks_like_word_corruption_error(word_result.get("error"))
                ):
                    repaired_raw, word_repair_error = _repair_docx_with_libreoffice(raw, timeout_s, max_len=MAX_LEN)
                    if repaired_raw is not None:
                        raw = repaired_raw
                        with open(docx_path, "wb") as f:
                            f.write(raw)
                        word_result = _convert_to_pdf_word_with_timeout(docx_path, pdf_path, timeout_s)
                    else:
                        word_result["repair_error"] = word_repair_error
            _logger.debug(f"Word result: {word_result}")
        else:
            _logger.debug(f"MS_WORD_AVAILABLE = False, skipping Word")
        
        if word_result.get("success"):
            # Word success
            converter_used = "word"
            try:
                with open(pdf_path, 'rb') as fpdf:
                    data = fpdf.read()
                if data:
                    pdf_b64 = base64.b64encode(data).decode('utf-8')
                    pdf_size = len(data)
                else:
                    error = "empty_pdf_word"
                    error_kind = "output"
            except Exception as e:
                error = f"pdf_read_error:{e}"
                error_kind = "output"
        else:
            # Word failed or not available - capture error for frontend
            if MS_WORD_AVAILABLE:
                word_error = word_result.get("error") or "unknown_word_error"
                if word_repair_error:
                    word_error = f"{word_error} | repair: {word_repair_error}"
                # DEBUG: Log Word failure reason
                _logger.debug(f"Word FAILED! Error: {word_error}, full result: {word_result}")
            # 2. Fallback to LibreOffice
            if not PDF_CONVERT_AVAILABLE:
                error = "all_converters_unavailable"
                error_kind = "environment"
            else:
                if progress_callback:
                    try:
                        progress_callback("Convirtiendo a PDF usando LibreOffice (Fallback)...")
                    except Exception:
                        pass
                
                # LibreOffice logic
                user_inst_dir = os.path.join(tmp, 'soffice_profile')
                os.makedirs(user_inst_dir, exist_ok=True)
                user_inst_url = Path(user_inst_dir).as_uri()
                
                cmd = [
                    _SOFFICE_PATH,
                    f'-env:UserInstallation={user_inst_url}',
                    '--headless',
                    '--convert-to', 'pdf',
                    '--outdir', tmp,
                    '--norestore',
                    '--writer',
                    docx_path
                ]
                try:
                    proc = subprocess.run(
                        cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                        timeout=timeout_s
                    )
                    stdout_txt = (proc.stdout.decode(errors='ignore') or '').strip()[:MAX_LEN] or None
                    stderr_txt = (proc.stderr.decode(errors='ignore') or '').strip()[:MAX_LEN] or None
                    
                    if proc.returncode != 0:
                        error = f'return_code_{proc.returncode}'
                        error_kind = 'process'
                    elif not os.path.exists(pdf_path):
                        error = 'missing_pdf_output'
                        error_kind = 'output'
                    else:
                        with open(pdf_path, 'rb') as fpdf:
                            data = fpdf.read()
                        if data:
                            pdf_b64 = base64.b64encode(data).decode('utf-8')
                            pdf_size = len(data)
                            converter_used = "libreoffice"  # LibreOffice success
                        else:
                            error = 'empty_pdf'
                            error_kind = 'output'
                except subprocess.TimeoutExpired:
                    error = 'timeout'
                    error_kind = 'timeout'
                except Exception as e:
                    error = f'exception:{type(e).__name__}'
                    error_kind = 'internal'
                    if not stderr_txt:
                        stderr_txt = str(e)[:MAX_LEN]

        duration_ms = int((time.perf_counter() - t0) * 1000)
        stage_timings_ms["pdf_convert_ms"] = _elapsed_ms(pdf_convert_started_at) or duration_ms

    # Classify unknown failures
    if not error and not pdf_b64:
        error = "unknown_failure"
        error_kind = "internal"
    
    # Update metrics (thread-safe)
    with _pdf_cache_lock:
        _pdf_conversions += 1
        if duration_ms and pdf_b64:
            _pdf_conversion_durations.append(duration_ms)
            if len(_pdf_conversion_durations) > 500:
                del _pdf_conversion_durations[:len(_pdf_conversion_durations) - 500]

    return {
        "attempted": True,
        "pdf_b64": pdf_b64,
        "stdout": stdout_txt,
        "stderr": stderr_txt,
        "duration_ms": duration_ms,
        "error": error,
        "error_kind": error_kind,
        "docx_size_bytes": docx_size,
        "pdf_size_bytes": pdf_size,
        "converter_used": converter_used,  # NEW: "word", "libreoffice", or None
        "word_error": word_error,          # NEW: Word failure reason if LibreOffice was used
        "max_docx_bytes": DOCX_MAX_BYTES,
        "stage_timings_ms": stage_timings_ms,
    }


def convert_docx_b64_to_pdf_b64(docx_b64: str) -> str | None:
    """Wrapper simple que solo retorna el PDF o None."""
    return convert_docx_with_diagnostics(docx_b64).get('pdf_b64') if docx_b64 else None


async def convert_docx_async(
    docx_b64: str | None,
    timeout_s: int | None = None,
    executor: Executor | None = None
) -> dict:
    """Wrapper async que ejecuta la conversión PDF en un proceso separado.
    
    Args:
        docx_b64: Contenido DOCX codificado en base64
        timeout_s: Timeout en segundos
        executor: Pool de procesos a usar (si no se provee, usa el default)
    
    Returns:
        dict con resultado de la conversión
    """
    import asyncio
    
    if not docx_b64:
        return {"attempted": False, "pdf_b64": None, "error": "no_docx"}
    
    loop = asyncio.get_event_loop()
    try:
        result = await loop.run_in_executor(
            executor,
            convert_docx_with_diagnostics,
            docx_b64,
            timeout_s
        )
        return result
    except Exception as e:
        return {"attempted": False, "pdf_b64": None, "error": str(e), "error_kind": "executor"}


def is_pdf_conversion_busy() -> bool:
    """Indica si el convertidor PDF serializado por Word ya estÃ¡ ocupado."""
    return bool(MS_WORD_AVAILABLE and _pdf_word_async_gate.locked())


async def build_pdf_context_async(
    docx_b64: str | None,
    docx_hash: str | None,
    attempt_conversion: bool,
    force_from_cache: bool = False,
    progress_callback: Callable[[str], None] | None = None,
    timeout_s: int | None = None,
    on_queue_wait: Callable[[], Awaitable[None]] | None = None,
) -> tuple[dict, str | None, str | None, bool]:
    """Wrapper async para aislar la cola del convertidor PDF del executor compartido."""
    if not docx_b64:
        return build_pdf_context(
            docx_b64,
            docx_hash,
            attempt_conversion,
            force_from_cache,
            progress_callback,
            timeout_s,
        )

    cached_pdf = pdf_cache_get(docx_hash)
    if cached_pdf:
        return build_pdf_context(
            docx_b64,
            docx_hash,
            attempt_conversion,
            force_from_cache,
            progress_callback,
            timeout_s,
        )

    loop = asyncio.get_running_loop()

    def _call_build_pdf_context() -> tuple[dict, str | None, str | None, bool]:
        return build_pdf_context(
            docx_b64,
            docx_hash,
            attempt_conversion,
            force_from_cache,
            progress_callback,
            timeout_s,
        )

    if not MS_WORD_AVAILABLE:
        return await loop.run_in_executor(_pdf_generic_executor, _call_build_pdf_context)

    if _pdf_word_async_gate.locked() and on_queue_wait is not None:
        await on_queue_wait()

    queue_wait_started_at = time.perf_counter()
    async with _pdf_word_async_gate:
        queue_wait_ms = _elapsed_ms(queue_wait_started_at)
        result = await loop.run_in_executor(_pdf_word_executor, _call_build_pdf_context)
    return _inject_queue_wait_timing(result, queue_wait_ms)


def build_pdf_context(
    docx_b64: str | None,
    docx_hash: str | None,
    attempt_conversion: bool,
    force_from_cache: bool = False,
    progress_callback: Callable[[str], None] | None = None,
    timeout_s: int | None = None,
) -> tuple[dict, str | None, str | None, bool]:
    """Centraliza la obtención (y posible conversión) de PDF + diagnóstico + tamaños.
    
    Args:
        docx_b64: Contenido DOCX codificado en base64
        docx_hash: Hash del DOCX para cache
        attempt_conversion: Si True, intenta convertir si no está en cache
        force_from_cache: Si True y existe cache, retorna aunque attempt_conversion=False
        progress_callback: Callback para reportar progreso
        timeout_s: Timeout opcional para la conversión real
    
    Returns:
        (pdf_diag, pdf_b64, pdf_hash, from_cache)
    """
    pdf_diag = {
        "attempted": False, "pdf_b64": None, "stdout": None, "stderr": None,
        "duration_ms": None, "error": None, "error_kind": None,
        "docx_size_bytes": None, "pdf_size_bytes": None,
        "converter_used": None, "word_error": None,
        "max_docx_bytes": DOCX_MAX_BYTES,
        "stage_timings_ms": {},
    }
    pdf_b64 = None
    pdf_hash = None
    from_cache = False
    
    if not docx_b64:
        return pdf_diag, None, None, False
    
    # Calcular tamaño DOCX si podemos
    try:
        pdf_diag['docx_size_bytes'] = _approx_b64_size_bytes(docx_b64)
    except Exception:
        pass
    
    # Intentar cache
    cache_lookup_started_at = time.perf_counter()
    cached_pdf = pdf_cache_get(docx_hash)
    cache_lookup_ms = _elapsed_ms(cache_lookup_started_at) or 0
    pdf_diag["stage_timings_ms"]["cache_lookup_ms"] = cache_lookup_ms
    if cached_pdf:
        pdf_b64 = cached_pdf
        from_cache = True
        pdf_diag.update({
            "attempted": False, "pdf_b64": pdf_b64, "duration_ms": 0,
            "converter_used": "cached",  # NEW: Indicate PDF was served from cache
            "stage_timings_ms": {
                "cache_lookup_ms": cache_lookup_ms,
                "pdf_validation_ms": 0,
                "pdf_convert_ms": 0,
            },
        })
        try:
            pdf_diag['pdf_size_bytes'] = len(base64.b64decode(pdf_b64))
        except Exception:
            pass
    elif attempt_conversion:
        pdf_diag = convert_docx_with_diagnostics(
            docx_b64,
            timeout_s=timeout_s,
            progress_callback=progress_callback,
        )
        pdf_b64 = pdf_diag.get('pdf_b64')
        if pdf_b64 and docx_hash:
            pdf_cache_set(docx_hash, pdf_b64)
        if pdf_b64 and pdf_diag.get('pdf_size_bytes') is None:
            try:
                pdf_diag['pdf_size_bytes'] = len(base64.b64decode(pdf_b64))
            except Exception:
                pass
    
    # Hash PDF
    if pdf_b64:
        try:
            pdf_hash = hashlib.sha256(pdf_b64.encode()).hexdigest()
        except Exception:
            pdf_hash = None
    
    return pdf_diag, pdf_b64, pdf_hash, from_cache


# =============================================================================
# INFO DEL SERVICIO
# =============================================================================

def get_service_info() -> dict:
    """Retorna información del servicio de conversión."""
    return {
        "pdf_available": PDF_CONVERT_AVAILABLE,
        "word_available": MS_WORD_AVAILABLE,
        "soffice_path": _SOFFICE_PATH,
        "max_docx_bytes": DOCX_MAX_BYTES,
        "timeout_seconds": PDF_CONVERT_TIMEOUT_S,
    }
