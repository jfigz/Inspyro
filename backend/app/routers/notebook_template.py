"""Notebook template handlers."""

import os
import binascii
import asyncio
import traceback
from typing import Optional, Tuple

from fastapi import WebSocket

from app.routers.notebook_common import (
    manager,
    jupyter_kernel_manager,
    notebook_docx_hash,
    notebook_last_docx_b64,
    template_storage,
    template_preview,
    template_service,
    template_style_apply,
    template_table_format,
    template_tokens,
    _get_kernel_lock,
    _get_template_mutation_lock,
    _register_preview_request,
    _is_preview_request_current,
    _complete_preview_request,
    _cancel_preview_by_key,
    _cancel_preview_by_request_id,
    _send_template_error,
    _timed_lock,
    _track_template_handler,
    _parse_table_index,
    _kernel_docx_set_template_code,
    _template_style_preview_semaphore,
    _template_table_preview_semaphore,
    _bind_kernel_to_connection,
    TEMPLATE_PREVIEW_TIMEOUT_S,
)
from app.services import template_logic

TEMPLATE_UPLOAD_MAX_BYTES = int(os.getenv("INSPYRO_TEMPLATE_UPLOAD_MAX_BYTES", str(20 * 1024 * 1024)))


async def _reload_template_in_kernel(kernel_id: str, template_payload: Optional[dict]) -> None:
    if not jupyter_kernel_manager or not kernel_id:
        return
    try:
        lock = _get_kernel_lock(kernel_id)
        async with _timed_lock(lock):
            template_path = template_storage.get_template_docx_path(kernel_id)
            reload_code = _kernel_docx_set_template_code(
                template_path,
                (template_payload or {}).get(template_service.TABLE_STYLE_RUNTIME_DEFAULTS_KEY),
                (template_payload or {}).get(template_service.BUILDER_REQUIRED_STYLE_DEFAULTS_KEY),
                (template_payload or {}).get(template_service.SEMANTIC_STYLE_SLOTS_KEY),
            )
            await jupyter_kernel_manager.execute_cell(kernel_id, reload_code, capture_variables=False)
    except Exception:
        pass


async def _bind_template_kernel_connection(websocket: WebSocket, kernel_id: Optional[str]) -> None:
    if not kernel_id:
        return
    await _bind_kernel_to_connection(websocket, kernel_id)


async def handle_template_upload(message: dict, websocket: WebSocket):
    request_id = message.get("request_id")
    kernel_id = message.get("kernel_id")

    async with _track_template_handler("template_upload"):
        try:
            if not kernel_id:
                await _send_template_error(websocket, "kernel_id is required", error_code="missing_kernel_id", request_id=request_id)
                return
            await _bind_template_kernel_connection(websocket, kernel_id)

            extracted = await template_logic.process_template_upload(kernel_id, message.get("docx_base64"))

            await manager.send_personal_message({
                "type": "template_uploaded",
                "kernel_id": kernel_id,
                "request_id": request_id,
                "template": extracted,
            }, websocket)

        except template_logic.TemplateValidationError as e:
            await _send_template_error(websocket, str(e), error_code=e.error_code, request_id=request_id, kernel_id=kernel_id, extra=e.extra)
        except asyncio.TimeoutError:
            await _send_template_error(websocket, "Timeout waiting for kernel lock during template upload", error_code="kernel_lock_timeout", request_id=request_id, kernel_id=kernel_id)
        except Exception as exc:
            await _send_template_error(websocket, str(exc), error_code="template_upload_failed", request_id=request_id, kernel_id=kernel_id, traceback_text=traceback.format_exc())

async def handle_template_attach(message: dict, websocket: WebSocket):
    request_id = message.get("request_id")
    kernel_id = message.get("kernel_id")
    template_token = message.get("template_token")

    async with _track_template_handler("template_attach"):
        try:
            if not kernel_id:
                await _send_template_error(websocket, "kernel_id is required", error_code="missing_kernel_id", request_id=request_id)
                return
            await _bind_template_kernel_connection(websocket, kernel_id)

            extracted, used_token = await template_logic.process_template_attach(kernel_id, template_token)

            await manager.send_personal_message({
                "type": "template_uploaded",
                "kernel_id": kernel_id,
                "request_id": request_id,
                "template_token": used_token,
                "template": extracted,
            }, websocket)

        except template_logic.TemplateValidationError as e:
            await _send_template_error(websocket, str(e), error_code=e.error_code, request_id=request_id, kernel_id=kernel_id, extra=e.extra)
        except asyncio.TimeoutError:
            await _send_template_error(websocket, "Timeout waiting for kernel lock during template attach", error_code="kernel_lock_timeout", request_id=request_id, kernel_id=kernel_id)
        except Exception as exc:
            await _send_template_error(websocket, str(exc), error_code="template_attach_failed", request_id=request_id, kernel_id=kernel_id, traceback_text=traceback.format_exc())

async def handle_template_get(message: dict, websocket: WebSocket):
    """Get the current template for a kernel."""
    try:
        kernel_id = message.get("kernel_id")
        request_id = message.get("request_id")
        
        if not kernel_id:
            await manager.send_personal_message({
                "type": "template_info",
                "request_id": request_id,
                "template": None
            }, websocket)
            return
        await _bind_template_kernel_connection(websocket, kernel_id)
        
        template = template_storage.get_template(kernel_id)
        
        await manager.send_personal_message({
            "type": "template_info",
            "kernel_id": kernel_id,
            "request_id": request_id,
            "template": template
        }, websocket)
        
    except Exception as e:
        await _send_template_error(
            websocket,
            str(e),
            error_code="template_get_failed",
            request_id=message.get("request_id"),
            kernel_id=message.get("kernel_id"),
        )

async def handle_template_delete(message: dict, websocket: WebSocket):
    """Delete the template for a kernel."""
    request_id = message.get("request_id")
    kernel_id = message.get("kernel_id")

    try:
        if not kernel_id:
            await _send_template_error(
                websocket,
                "kernel_id is required",
                error_code="missing_kernel_id",
                request_id=request_id,
            )
            return

        mutation_lock = await _get_template_mutation_lock(kernel_id)
        async with asyncio.timeout(float(os.getenv("INSPYRO_LOCK_TIMEOUT", "60"))):
            async with mutation_lock:
                deleted = template_storage.delete_template(kernel_id)

            if jupyter_kernel_manager:
                try:
                    lock = _get_kernel_lock(kernel_id)
                    async with _timed_lock(lock):
                        clear_template_code = _kernel_docx_set_template_code(None, {})
                        await jupyter_kernel_manager.execute_cell(kernel_id, clear_template_code, capture_variables=False)
                except Exception:
                    pass  # Kernel may not be running.

            notebook_docx_hash.pop(kernel_id, None)
            notebook_last_docx_b64.pop(kernel_id, None)

        await manager.send_personal_message(
            {
                "type": "template_deleted",
                "kernel_id": kernel_id,
                "request_id": request_id,
                "was_deleted": deleted,
            },
            websocket,
        )

    except asyncio.TimeoutError:
        await _send_template_error(
            websocket,
            "Timeout waiting for kernel lock during template delete",
            error_code="kernel_lock_timeout",
            request_id=request_id,
            kernel_id=kernel_id,
        )
    except Exception as exc:
        await _send_template_error(
            websocket,
            str(exc),
            error_code="template_delete_failed",
            request_id=request_id,
            kernel_id=kernel_id,
            traceback_text=traceback.format_exc(),
        )

async def handle_template_update_style(message: dict, websocket: WebSocket):
    """Update a specific style in the template."""
    request_id = message.get("request_id")
    kernel_id = message.get("kernel_id")

    try:
        style_name = message.get("style_name")
        updates = message.get("updates", {})
        
        if not kernel_id:
            await _send_template_error(
                websocket,
                "kernel_id is required",
                error_code="missing_kernel_id",
                request_id=request_id,
            )
            return
        await _bind_template_kernel_connection(websocket, kernel_id)
        
        if not style_name:
            await _send_template_error(
                websocket,
                "style_name is required",
                error_code="missing_style_name",
                request_id=request_id,
                kernel_id=kernel_id,
            )
            return

        mutation_lock = await _get_template_mutation_lock(kernel_id)
        async with asyncio.timeout(float(os.getenv("INSPYRO_LOCK_TIMEOUT", "60"))):
            async with mutation_lock:
                updated_template = await template_service.run_template_executor(
                    template_style_apply.update_template_style,
                    kernel_id,
                    style_name,
                    updates,
                )

            await _reload_template_in_kernel(kernel_id, updated_template)

            notebook_docx_hash.pop(kernel_id, None)
            notebook_last_docx_b64.pop(kernel_id, None)

        await manager.send_personal_message(
            {
                "type": "template_style_updated",
                "kernel_id": kernel_id,
                "request_id": request_id,
                "style_name": style_name,
                "template": updated_template,
            },
            websocket,
        )

    except asyncio.TimeoutError:
        await _send_template_error(
            websocket,
            "Timeout waiting for kernel lock during style update",
            error_code="kernel_lock_timeout",
            request_id=request_id,
            kernel_id=kernel_id,
        )
    except Exception as exc:
        await _send_template_error(
            websocket,
            str(exc),
            error_code="template_update_failed",
            request_id=request_id,
            kernel_id=kernel_id,
            traceback_text=traceback.format_exc(),
        )


async def handle_template_update_document_defaults(message: dict, websocket: WebSocket):
    request_id = message.get("request_id")
    kernel_id = message.get("kernel_id")

    try:
        updates = message.get("updates", {})
        if not kernel_id:
            await _send_template_error(
                websocket,
                "kernel_id is required",
                error_code="missing_kernel_id",
                request_id=request_id,
            )
            return
        await _bind_template_kernel_connection(websocket, kernel_id)

        mutation_lock = await _get_template_mutation_lock(kernel_id)
        async with asyncio.timeout(float(os.getenv("INSPYRO_LOCK_TIMEOUT", "60"))):
            async with mutation_lock:
                updated_template = await template_service.run_template_executor(
                    template_style_apply.update_template_document_defaults,
                    kernel_id,
                    updates,
                )

            await _reload_template_in_kernel(kernel_id, updated_template)

            notebook_docx_hash.pop(kernel_id, None)
            notebook_last_docx_b64.pop(kernel_id, None)

        await manager.send_personal_message(
            {
                "type": "template_document_defaults_updated",
                "kernel_id": kernel_id,
                "request_id": request_id,
                "template": updated_template,
            },
            websocket,
        )
    except asyncio.TimeoutError:
        await _send_template_error(
            websocket,
            "Timeout waiting for kernel lock during document defaults update",
            error_code="kernel_lock_timeout",
            request_id=request_id,
            kernel_id=kernel_id,
        )
    except Exception as exc:
        await _send_template_error(
            websocket,
            str(exc),
            error_code="template_document_defaults_update_failed",
            request_id=request_id,
            kernel_id=kernel_id,
            traceback_text=traceback.format_exc(),
        )


async def handle_template_update_semantic_slots(message: dict, websocket: WebSocket):
    request_id = message.get("request_id")
    kernel_id = message.get("kernel_id")

    try:
        semantic_style_slots = message.get("semantic_style_slots", {})
        if not kernel_id:
            await _send_template_error(
                websocket,
                "kernel_id is required",
                error_code="missing_kernel_id",
                request_id=request_id,
            )
            return
        await _bind_template_kernel_connection(websocket, kernel_id)
        if not isinstance(semantic_style_slots, dict):
            await _send_template_error(
                websocket,
                "semantic_style_slots must be an object",
                error_code="invalid_semantic_style_slots",
                request_id=request_id,
                kernel_id=kernel_id,
            )
            return

        mutation_lock = await _get_template_mutation_lock(kernel_id)
        async with asyncio.timeout(float(os.getenv("INSPYRO_LOCK_TIMEOUT", "60"))):
            async with mutation_lock:
                updated_template = await template_service.run_template_executor(
                    template_service.update_template_semantic_style_slots,
                    kernel_id,
                    semantic_style_slots,
                )

            await _reload_template_in_kernel(kernel_id, updated_template)

            notebook_docx_hash.pop(kernel_id, None)
            notebook_last_docx_b64.pop(kernel_id, None)

        await manager.send_personal_message(
            {
                "type": "template_semantic_slots_updated",
                "kernel_id": kernel_id,
                "request_id": request_id,
                "template": updated_template,
            },
            websocket,
        )
    except asyncio.TimeoutError:
        await _send_template_error(
            websocket,
            "Timeout waiting for kernel lock during semantic slot update",
            error_code="kernel_lock_timeout",
            request_id=request_id,
            kernel_id=kernel_id,
        )
    except Exception as exc:
        await _send_template_error(
            websocket,
            str(exc),
            error_code="template_semantic_slots_update_failed",
            request_id=request_id,
            kernel_id=kernel_id,
            traceback_text=traceback.format_exc(),
        )


async def handle_template_preview_style(message: dict, websocket: WebSocket):
    """Generate a Word-rendered preview of a style.
    
    FIX #5: Supports request_id for stale response detection.
    """
    preview_track_key: Optional[Tuple[str, str]] = None
    kernel_id = message.get("kernel_id")
    preview_key = message.get("preview_key")
    request_id = message.get("request_id")
    style_name = message.get("style_name", "Preview")
    style_id = None
    try:
        style_props = message.get("style_props", {})
        if not isinstance(style_props, dict):
            style_props = {}
        # Backward compatibility: accept legacy top-level preview fields.
        if message.get("style_id") and not style_props.get("style_id"):
            style_props["style_id"] = message.get("style_id")
        if (message.get("is_table_style") or message.get("style_type") == "table") and not style_props.get("style_type"):
            style_props["style_type"] = "table"
        if message.get("category") and not style_props.get("category"):
            style_props["category"] = message.get("category")
        style_id = style_props.get("style_id") if isinstance(style_props, dict) else None
        force_refresh_raw = message.get("force_refresh", False)
        force_refresh = (
            force_refresh_raw is True
            or (isinstance(force_refresh_raw, str) and force_refresh_raw.strip().lower() in {"1", "true", "yes", "on"})
            or (isinstance(force_refresh_raw, (int, float)) and int(force_refresh_raw) == 1)
        )
        
        if not kernel_id:
            await manager.send_personal_message({
                "type": "template_preview_error",
                "error": "kernel_id is required",
                "preview_key": preview_key,
                "request_id": request_id  # FIX #5
            }, websocket)
            return
        await _bind_template_kernel_connection(websocket, kernel_id)

        preview_track_key = await _register_preview_request(
            kernel_id,
            preview_key,
            request_id,
            fallback=f"style:{style_id or style_name}",
        )
        if not await _is_preview_request_current(preview_track_key, request_id):
            return

        cached_preview = None if force_refresh else template_preview.get_preview_cache(preview_key, kernel_id)
        if cached_preview:
            await manager.send_personal_message({
                "type": "template_preview_ready",
                "kernel_id": kernel_id,
                "style_name": style_name,
                "style_id": style_id,
                "preview_png_base64": cached_preview,
                "preview_key": preview_key,
                "request_id": request_id
            }, websocket)
            return
        
        # Run preview generation in executor to not block event loop
        try:
            async with _template_style_preview_semaphore:
                if not await _is_preview_request_current(preview_track_key, request_id):
                    return
                preview_b64 = await asyncio.wait_for(
                    template_service.run_template_executor(
                        template_preview.generate_style_preview,
                        kernel_id,
                        style_name,
                        style_props,
                    ),
                    timeout=TEMPLATE_PREVIEW_TIMEOUT_S,
                )
        except asyncio.TimeoutError:
            if preview_track_key and not await _is_preview_request_current(preview_track_key, request_id):
                return
            await manager.send_personal_message({
                "type": "template_preview_error",
                "kernel_id": kernel_id,
                "style_name": style_name,
                "style_id": style_id,
                "error": f"Preview timeout after {TEMPLATE_PREVIEW_TIMEOUT_S}s",
                "preview_key": preview_key,
                "request_id": request_id
            }, websocket)
            return

        if preview_track_key and not await _is_preview_request_current(preview_track_key, request_id):
            return
        
        if preview_b64:
            if preview_key:
                template_preview.set_preview_cache(preview_key, preview_b64, kernel_id)
            await manager.send_personal_message({
                "type": "template_preview_ready",
                "kernel_id": kernel_id,
                "style_name": style_name,
                "style_id": style_id,
                "preview_png_base64": preview_b64,
                "preview_key": preview_key,
                "request_id": request_id
            }, websocket)
        else:
            await manager.send_personal_message({
                "type": "template_preview_error",
                "kernel_id": kernel_id,
                "style_name": style_name,
                "style_id": style_id,
                "error": "Preview generation failed (Word may not be available)",
                "preview_key": preview_key,
                "request_id": request_id
            }, websocket)
    
    except Exception as e:
        if preview_track_key and kernel_id:
            if not await _is_preview_request_current(preview_track_key, request_id):
                return
        await manager.send_personal_message({
            "type": "template_preview_error",
            "error": str(e),
            "traceback": traceback.format_exc(),
            "style_id": style_id,
            "preview_key": preview_key,
            "request_id": request_id
        }, websocket)
    finally:
        if preview_track_key:
            await _complete_preview_request(preview_track_key, request_id)

async def handle_template_preview_cancel(message: dict, websocket: WebSocket):
    kernel_id = message.get("kernel_id")
    preview_key_raw = message.get("preview_key")
    request_id_raw = message.get("request_id")
    preview_key = preview_key_raw.strip() if isinstance(preview_key_raw, str) else None
    request_id = request_id_raw.strip() if isinstance(request_id_raw, str) else None
    cancelled_entries = 0

    if not kernel_id:
        await _send_template_error(
            websocket,
            "kernel_id is required",
            error_code="missing_kernel_id",
            request_id=request_id,
        )
        return
    await _bind_template_kernel_connection(websocket, kernel_id)
    if not preview_key and not request_id:
        await _send_template_error(
            websocket,
            "preview_key or request_id is required",
            error_code="missing_preview_identifier",
            request_id=request_id,
            kernel_id=kernel_id,
        )
        return

    if preview_key:
        await _cancel_preview_by_key(kernel_id, preview_key)
        cancelled_entries += 1
    if request_id:
        cancelled_entries += await _cancel_preview_by_request_id(kernel_id, request_id)

    await manager.send_personal_message(
        {
            "type": "template_preview_cancelled",
            "kernel_id": kernel_id,
            "preview_key": preview_key,
            "request_id": request_id,
            "cancelled": cancelled_entries > 0,
            "cancelled_entries": cancelled_entries,
        },
        websocket,
    )

async def handle_template_table_preview(message: dict, websocket: WebSocket):
    """Generate a Word-rendered preview of a document table.
    
    This handler generates a preview image of a specific table found in the
    uploaded template document, showing its actual formatting.
    """
    kernel_id = message.get("kernel_id")
    table_index = message.get("table_index", 0)
    request_id = message.get("request_id")

    preview_track_key: Optional[Tuple[str, str]] = None
    try:
        
        if not kernel_id:
            await manager.send_personal_message({
                "type": "template_table_preview_error",
                "kernel_id": kernel_id,
                "table_index": table_index,
                "error": "kernel_id is required",
                "request_id": request_id
            }, websocket)
            return
        await _bind_template_kernel_connection(websocket, kernel_id)

        parsed_table_index = _parse_table_index(table_index)
        if parsed_table_index is None or parsed_table_index < 0:
            await manager.send_personal_message({
                "type": "template_table_preview_error",
                "kernel_id": kernel_id,
                "table_index": table_index,
                "error": f"Invalid table_index {table_index!r}. Expected a non-negative integer.",
                "request_id": request_id
            }, websocket)
            return
        table_index = parsed_table_index

        preview_track_key = await _register_preview_request(
            kernel_id,
            message.get("preview_key"),
            request_id,
            fallback=f"table:{table_index}",
        )
        if not await _is_preview_request_current(preview_track_key, request_id):
            return
        
        # Run preview generation in executor to not block event loop.
        # Serialized to avoid Word COM instability under concurrent preview requests.
        async with _template_table_preview_semaphore:
            if not await _is_preview_request_current(preview_track_key, request_id):
                return
            try:
                result = await asyncio.wait_for(
                    template_service.run_template_executor(
                        template_preview.generate_document_table_preview,
                        kernel_id,
                        table_index,
                        4,  # max_rows for preview
                    ),
                    timeout=TEMPLATE_PREVIEW_TIMEOUT_S,
                )
            except asyncio.TimeoutError:
                if preview_track_key and not await _is_preview_request_current(preview_track_key, request_id):
                    return
                await manager.send_personal_message({
                    "type": "template_table_preview_error",
                    "kernel_id": kernel_id,
                    "table_index": table_index,
                    "error": f"Preview timeout after {TEMPLATE_PREVIEW_TIMEOUT_S}s",
                    "request_id": request_id
                }, websocket)
                return

        if preview_track_key and not await _is_preview_request_current(preview_track_key, request_id):
            return
        
        # Handle the new dict-based response format
        if result and result.get("success"):
            await manager.send_personal_message({
                "type": "template_table_preview_ready",
                "kernel_id": kernel_id,
                "table_index": table_index,
                "preview_png_base64": result.get("preview_b64"),
                "request_id": request_id
            }, websocket)
        else:
            # Extract detailed error information
            error = result.get("error", "Unknown error") if result else "Preview generation returned no result"
            error_detail = result.get("error_detail", "") if result else ""
            
            # Build comprehensive error message
            full_error = error
            if error_detail:
                full_error += f" ({error_detail})"
            
            await manager.send_personal_message({
                "type": "template_table_preview_error",
                "kernel_id": kernel_id,
                "table_index": table_index,
                "error": full_error,
                "error_detail": error_detail,
                "converter_used": result.get("converter_used") if result else None,
                "request_id": request_id
            }, websocket)
    
    except Exception as e:
        if preview_track_key and kernel_id:
            if not await _is_preview_request_current(preview_track_key, request_id):
                return
        await manager.send_personal_message({
            "type": "template_table_preview_error",
            "kernel_id": kernel_id,
            "table_index": table_index,
            "error": f"Unexpected error in handler: {str(e)}",
            "traceback": traceback.format_exc(),
            "request_id": request_id
        }, websocket)
    finally:
        if preview_track_key:
            await _complete_preview_request(preview_track_key, request_id)

async def handle_template_create_style_from_table(message: dict, websocket: WebSocket):
    """Create a new table style from a detected table in the document."""
    request_id = message.get("request_id")
    kernel_id = message.get("kernel_id")

    try:
        table_index = message.get("table_index")
        style_name = message.get("style_name")
        
        if not kernel_id or table_index is None or not style_name:
            await _send_template_error(
                websocket,
                "Missing required fields (kernel_id, table_index, style_name)",
                error_code="missing_required_fields",
                request_id=request_id,
                kernel_id=kernel_id,
                extra={"table_index": table_index},
            )
            return
        await _bind_template_kernel_connection(websocket, kernel_id)

        parsed_table_index = _parse_table_index(table_index)
        if parsed_table_index is None or parsed_table_index < 0:
            await _send_template_error(
                websocket,
                f"Invalid table_index {table_index!r}. Expected a non-negative integer.",
                error_code="invalid_table_index",
                request_id=request_id,
                kernel_id=kernel_id,
                extra={"table_index": table_index},
            )
            return
        table_index = parsed_table_index

        mutation_lock = await _get_template_mutation_lock(kernel_id)
        async with asyncio.timeout(float(os.getenv("INSPYRO_LOCK_TIMEOUT", "60"))):
            async with mutation_lock:
                updated_template = await template_service.run_template_executor(
                    template_table_format.create_table_style_from_format,
                    kernel_id,
                    table_index,
                    style_name,
                )

            if updated_template:
                await _reload_template_in_kernel(kernel_id, updated_template)

            if updated_template:
                notebook_docx_hash.pop(kernel_id, None)
                notebook_last_docx_b64.pop(kernel_id, None)

        if updated_template:
            
            await manager.send_personal_message(
                {
                    "type": "template_style_created",
                    "kernel_id": kernel_id,
                    "request_id": request_id,
                    "style_name": style_name,
                    "template": updated_template,
                },
                websocket,
            )
        else:
            await _send_template_error(
                websocket,
                "Failed to create table style from format",
                error_code="template_style_create_failed",
                request_id=request_id,
                kernel_id=kernel_id,
                extra={"table_index": table_index, "style_name": style_name},
            )

    except asyncio.TimeoutError:
        await _send_template_error(
            websocket,
            "Timeout waiting for kernel lock during style creation from table",
            error_code="kernel_lock_timeout",
            request_id=request_id,
            kernel_id=kernel_id,
            extra={"table_index": message.get("table_index"), "style_name": message.get("style_name")},
        )
    except Exception as exc:
        await _send_template_error(
            websocket,
            str(exc),
            error_code="template_style_create_failed",
            request_id=request_id,
            kernel_id=kernel_id,
            traceback_text=traceback.format_exc(),
            extra={"table_index": message.get("table_index"), "style_name": message.get("style_name")},
        )

async def handle_template_apply_table_format(message: dict, websocket: WebSocket):
    """Apply the format from a detected table to an existing table style."""
    request_id = message.get("request_id")
    kernel_id = message.get("kernel_id")

    try:
        table_index = message.get("table_index")
        target_style_name = message.get("target_style_name")
        target_style_id = message.get("target_style_id")
        
        if not kernel_id or table_index is None or (not target_style_name and not target_style_id):
            await _send_template_error(
                websocket,
                "Missing required fields (kernel_id, table_index, target_style_name|target_style_id)",
                error_code="missing_required_fields",
                request_id=request_id,
                kernel_id=kernel_id,
                extra={
                    "table_index": table_index,
                    "target_style_name": target_style_name,
                    "target_style_id": target_style_id,
                },
            )
            return
        await _bind_template_kernel_connection(websocket, kernel_id)

        parsed_table_index = _parse_table_index(table_index)
        if parsed_table_index is None or parsed_table_index < 0:
            await _send_template_error(
                websocket,
                f"Invalid table_index {table_index!r}. Expected a non-negative integer.",
                error_code="invalid_table_index",
                request_id=request_id,
                kernel_id=kernel_id,
                extra={"table_index": table_index},
            )
            return
        table_index = parsed_table_index

        mutation_lock = await _get_template_mutation_lock(kernel_id)
        async with asyncio.timeout(float(os.getenv("INSPYRO_LOCK_TIMEOUT", "60"))):
            async with mutation_lock:
                updated_template = await template_service.run_template_executor(
                    template_table_format.apply_table_format_to_style,
                    kernel_id,
                    table_index,
                    target_style_name,
                    target_style_id,
                )

            if updated_template:
                await _reload_template_in_kernel(kernel_id, updated_template)

            if updated_template:
                notebook_docx_hash.pop(kernel_id, None)
                notebook_last_docx_b64.pop(kernel_id, None)
        
        if updated_template:
            style_label = target_style_name or target_style_id or "estilo objetivo"
            
            await manager.send_personal_message(
                {
                    "type": "template_format_applied",
                    "kernel_id": kernel_id,
                    "request_id": request_id,
                    "table_index": table_index,
                    "target_style_name": target_style_name,
                    "target_style_id": target_style_id,
                    "template": updated_template,
                    "message": f"Formato de tabla #{table_index + 1} aplicado al estilo '{style_label}'",
                },
                websocket,
            )
        else:
            await _send_template_error(
                websocket,
                f"Failed to apply table format to style '{target_style_name}'",
                error_code="template_apply_format_failed",
                request_id=request_id,
                kernel_id=kernel_id,
                extra={
                    "table_index": table_index,
                    "target_style_name": target_style_name,
                    "target_style_id": target_style_id,
                },
            )

    except asyncio.TimeoutError:
        await _send_template_error(
            websocket,
            "Timeout waiting for kernel lock during apply table format",
            error_code="kernel_lock_timeout",
            request_id=request_id,
            kernel_id=kernel_id,
            extra={
                "table_index": message.get("table_index"),
                "target_style_name": message.get("target_style_name"),
                "target_style_id": message.get("target_style_id"),
            },
        )
    except Exception as exc:
        await _send_template_error(
            websocket,
            str(exc),
            error_code="template_apply_format_failed",
            request_id=request_id,
            kernel_id=kernel_id,
            traceback_text=traceback.format_exc(),
            extra={
                "table_index": message.get("table_index"),
                "target_style_name": message.get("target_style_name"),
                "target_style_id": message.get("target_style_id"),
            },
        )
