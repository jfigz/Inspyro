import base64
import binascii
import os
import asyncio
from typing import Dict, Any, Optional

from app.core.state import get_template_mutation_lock
from app.services.jupyter_kernel import jupyter_kernel_manager
from app.services.template import storage as template_storage
from app.services import template_extract
from app.services import template_service
from app.services import template_tokens

TEMPLATE_UPLOAD_MAX_BYTES = int(os.getenv("INSPYRO_TEMPLATE_UPLOAD_MAX_BYTES", str(20 * 1024 * 1024)))

class TemplateValidationError(Exception):
    def __init__(self, message: str, error_code: str, extra: Optional[Dict] = None):
        super().__init__(message)
        self.error_code = error_code
        self.extra = extra or {}


def _kernel_preamble() -> str:
    from pathlib import Path
    backend_root = Path(__file__).resolve().parents[2]
    return (
        "import sys as _sys\n"
        f"_BR={str(backend_root)!r}\n"
        "if _BR not in _sys.path: _sys.path.insert(0, _BR)\n"
    )

def kernel_docx_set_template_code(
    template_path: Optional[str],
    table_style_runtime_defaults: Optional[Dict[str, Any]] = None,
    builder_required_style_defaults: Optional[Dict[str, Any]] = None,
    semantic_style_slots: Optional[Dict[str, Any]] = None,
) -> str:
    return (
        _kernel_preamble()
        + "from librerias_propias.docx_builder.session import get_session\n"
        + "_session = get_session()\n"
        + f"_session.set_template_path({template_path!r})\n"
        + f"_session.set_template_table_style_defaults({table_style_runtime_defaults or {}!r})\n"
        + f"_session.set_template_required_style_defaults({builder_required_style_defaults or {}!r})\n"
        + f"_session.set_template_semantic_style_slots({semantic_style_slots or {}!r})\n"
        + "_session.reset(hard=True)\n"
        + "del _session\n"
    )

def kernel_docx_reset_code() -> str:
    return (
        _kernel_preamble()
        + "from librerias_propias.docx_builder.session import get_session\n"
        + "_session = get_session()\n"
        + "_session.reset(hard=True)\n"
        + "del _session\n"
    )


async def apply_template_bytes_to_kernel(*, kernel_id: str, docx_bytes: bytes) -> dict:
    """Extrae estilos, guarda la plantilla y la aplica en el kernel."""
    extracted = await template_service.run_template_executor(template_extract.extract_styles_from_docx, docx_bytes)

    mutation_lock = await get_template_mutation_lock(kernel_id)
    template_path = None
    
    # Import locally to avoid circular dependencies if notebook_service relies on this
    from app.services.notebook_service import notebook_docx_hash, notebook_last_docx_b64, _get_kernel_lock
    from app.routers.notebook_common import _timed_lock
    
    async with asyncio.timeout(float(os.getenv("INSPYRO_LOCK_TIMEOUT", "60"))):
        async with mutation_lock:
            template_storage.save_template(kernel_id, docx_bytes, extracted)
            template_path = template_storage.get_template_docx_path(kernel_id)
            extracted = template_storage.get_template(kernel_id) or extracted

        if template_path and jupyter_kernel_manager:
            try:
                lock = _get_kernel_lock(kernel_id)
                async with _timed_lock(lock):
                    set_template_code = kernel_docx_set_template_code(
                        template_path,
                        extracted.get(template_service.TABLE_STYLE_RUNTIME_DEFAULTS_KEY),
                        extracted.get(template_service.BUILDER_REQUIRED_STYLE_DEFAULTS_KEY),
                        extracted.get(template_service.SEMANTIC_STYLE_SLOTS_KEY),
                    )
                    await jupyter_kernel_manager.execute_cell(kernel_id, set_template_code, capture_variables=False)
            except Exception:
                pass

        notebook_docx_hash.pop(kernel_id, None)
        notebook_last_docx_b64.pop(kernel_id, None)

    extracted["style_coverage"] = template_extract.get_style_coverage(extracted)
    return extracted


async def process_template_upload(kernel_id: str, docx_b64: Any) -> dict:
    """Valida la carga por base64 y la aplica."""
    if not docx_b64:
        raise TemplateValidationError("docx_base64 is required", "missing_docx_base64")
    if not isinstance(docx_b64, str):
        raise TemplateValidationError("docx_base64 must be a string", "invalid_docx_base64")

    docx_b64 = docx_b64.strip()
    estimated_size_bytes = ((len(docx_b64) + 3) // 4) * 3
    if estimated_size_bytes > TEMPLATE_UPLOAD_MAX_BYTES:
        raise TemplateValidationError(
            f"Template payload is too large. Estimated size: {estimated_size_bytes} bytes; max allowed: {TEMPLATE_UPLOAD_MAX_BYTES} bytes",
            "template_upload_too_large",
            {"details": {"received_estimated_bytes": estimated_size_bytes, "max_bytes": TEMPLATE_UPLOAD_MAX_BYTES}}
        )

    try:
        docx_bytes = base64.b64decode(docx_b64, validate=True)
    except (binascii.Error, ValueError):
        raise TemplateValidationError("docx_base64 is invalid", "invalid_docx_base64")

    payload_size_bytes = len(docx_bytes)
    if payload_size_bytes > TEMPLATE_UPLOAD_MAX_BYTES:
        raise TemplateValidationError(
            f"Template payload is too large. Received: {payload_size_bytes} bytes; max allowed: {TEMPLATE_UPLOAD_MAX_BYTES} bytes",
            "template_upload_too_large",
            {"details": {"received_bytes": payload_size_bytes, "max_bytes": TEMPLATE_UPLOAD_MAX_BYTES}}
        )

    return await apply_template_bytes_to_kernel(kernel_id=kernel_id, docx_bytes=docx_bytes)


async def process_template_attach(kernel_id: str, template_token: Any) -> tuple[dict, str]:
    """Valida la existencia del token de plantilla y la aplica."""
    if not isinstance(template_token, str) or not template_token.strip():
        raise TemplateValidationError("template_token is required", "missing_template_token")
    
    template_token = template_token.strip()
    stored = template_tokens.get_template_bytes(template_token)
    if not stored:
        raise TemplateValidationError("template_token is invalid or expired", "invalid_template_token")

    docx_bytes = stored.get("bytes")
    if not isinstance(docx_bytes, (bytes, bytearray)) or not docx_bytes:
        raise TemplateValidationError("template token has no data", "template_token_empty")

    extracted = await apply_template_bytes_to_kernel(kernel_id=kernel_id, docx_bytes=bytes(docx_bytes))
    return extracted, template_token

