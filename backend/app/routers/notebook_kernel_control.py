"""Notebook kernel-control handlers."""

import logging

from fastapi import WebSocket

logger = logging.getLogger(__name__)

from app.routers.notebook_common import (
    manager,
    jupyter_kernel_manager,
    notebook_cumulative_graphs,
    notebook_cumulative_variables,
    notebook_cumulative_call_stacks,
    notebook_docx_hash,
    notebook_last_docx_b64,
    template_storage,
    template_service,
    _cancel_kernel_execution,
    _bind_kernel_to_connection,
    _clear_execution_state,
    _execute_kernel_code_safely,
    _kernel_docx_set_template_code,
    _send_notebook_error,
    _shutdown_kernel_resources,
    _untrack_kernel_for_connection,
)
from app.services import template_binding
from app.services.notebook_service import get_kernel_docx_source

async def handle_notebook_cancel_execution(message: dict, websocket: WebSocket):
    kernel_id = message.get("kernel_id")
    request_id = message.get("request_id")
    execution_id_raw = message.get("execution_id")
    execution_id = str(execution_id_raw).strip() if execution_id_raw is not None else None
    if execution_id == "":
        execution_id = None

    try:
        await _bind_kernel_to_connection(websocket, kernel_id)
        effective_execution_id = await _cancel_kernel_execution(kernel_id, execution_id)
        if jupyter_kernel_manager is not None and kernel_id:
            try:
                await jupyter_kernel_manager.interrupt_kernel(kernel_id)
            except Exception:
                pass
        await manager.send_personal_message(
            {
                "type": "notebook_execution_cancelled",
                "kernel_id": kernel_id,
                "execution_id": effective_execution_id,
                "cancelled": bool(effective_execution_id),
                "request_id": request_id,
            },
            websocket,
        )
    except Exception as exc:
        await _send_notebook_error(
            websocket,
            str(exc),
            error_code="notebook_cancel_execution_failed",
            extra={"kernel_id": kernel_id, "execution_id": execution_id, "request_id": request_id},
        )

async def handle_notebook_mdoc_clear(message: dict, websocket: WebSocket):
    try:
        kernel_id = message.get('kernel_id')
        await _bind_kernel_to_connection(websocket, kernel_id)
        # Try to reset in kernel (if running), but don't fail if kernel is gone
        try:
            await _execute_kernel_code_safely(
                kernel_id,
                "from librerias_propias.math_to_docx import doc_reset\ndoc_reset(hard=True)\n",
                timeout_s=15,
            )
        except Exception:
            pass  # Kernel not running, that's OK
        
        # Always clear backend state
        notebook_docx_hash.pop(kernel_id, None)
        notebook_last_docx_b64.pop(kernel_id, None)  # Also clear stored DOCX
        
        await manager.send_personal_message({'type': 'notebook_mdoc_cleared', 'kernel_id': kernel_id}, websocket)
    except Exception as e:
        await _send_notebook_error(websocket, str(e), error_code="notebook_mdoc_clear_failed")

async def handle_notebook_reset_kernel(message: dict, websocket: WebSocket):
    request_id = message.get("request_id")
    try:
        kernel_id = message.get("kernel_id")
        await _bind_kernel_to_connection(websocket, kernel_id)
        await jupyter_kernel_manager.restart_kernel(kernel_id)
        await _clear_execution_state(kernel_id)
        notebook_cumulative_graphs[kernel_id] = {"nodes": [], "links": []}
        notebook_cumulative_variables[kernel_id] = {}
        notebook_cumulative_call_stacks[kernel_id] = []
        
        # Restore template if one exists for this kernel
        template_path = template_storage.get_template_docx_path(kernel_id)
        template_binding_status = template_binding.get_kernel_template_binding_status(kernel_id)
        if template_path:
            try:
                template_info = template_storage.get_template(kernel_id) or {}
                set_template_code = _kernel_docx_set_template_code(
                    template_path,
                    template_info.get(template_service.TABLE_STYLE_RUNTIME_DEFAULTS_KEY),
                    template_info.get(template_service.BUILDER_REQUIRED_STYLE_DEFAULTS_KEY),
                    template_info.get(template_service.SEMANTIC_STYLE_SLOTS_KEY),
                )
                await _execute_kernel_code_safely(kernel_id, set_template_code)
            except Exception as e:
                logger.warning("[Template] Could not restore template after restart: %s", e)
        elif template_binding_status and template_binding_status.get("status") not in {"none", "missing"}:
            source_info = get_kernel_docx_source(kernel_id)
            template_binding_status = await template_binding.apply_notebook_template_binding_to_kernel(
                kernel_id=kernel_id,
                notebook_path=source_info.get("source_path"),
                notebook=None,
            )

        await manager.send_personal_message(
            {
                "type": "notebook_kernel_reset",
                "kernel_id": kernel_id,
                "template_binding": template_binding_status,
                "request_id": request_id,
            },
            websocket,
        )
    except Exception as e:
        await _send_notebook_error(
            websocket,
            str(e),
            error_code="notebook_reset_kernel_failed",
            extra={"request_id": request_id},
        )

async def handle_notebook_interrupt_kernel(message: dict, websocket: WebSocket):
    request_id = message.get("request_id")
    try:
        kernel_id = message.get("kernel_id")
        await _bind_kernel_to_connection(websocket, kernel_id)
        await _cancel_kernel_execution(kernel_id, None)
        await jupyter_kernel_manager.interrupt_kernel(kernel_id)
        await manager.send_personal_message(
            {
                "type": "notebook_kernel_interrupted",
                "kernel_id": kernel_id,
                "request_id": request_id,
            },
            websocket,
        )
    except Exception as e:
        await _send_notebook_error(
            websocket,
            str(e),
            error_code="notebook_interrupt_kernel_failed",
            extra={"request_id": request_id},
        )

async def handle_notebook_shutdown_kernel(message: dict, websocket: WebSocket):
    request_id = message.get("request_id")
    try:
        kernel_id = message.get("kernel_id")
        await _bind_kernel_to_connection(websocket, kernel_id)
        await _shutdown_kernel_resources(kernel_id)
        await _untrack_kernel_for_connection(websocket, kernel_id)
        await manager.send_personal_message(
            {
                "type": "notebook_kernel_shutdown",
                "kernel_id": kernel_id,
                "request_id": request_id,
            },
            websocket,
        )
    except Exception as e:
        await _send_notebook_error(
            websocket,
            str(e),
            error_code="notebook_shutdown_kernel_failed",
            extra={"request_id": request_id},
        )

async def handle_notebook_comm_msg(message: dict, websocket: WebSocket):
    try:
        kernel_id = message.get("kernel_id")
        await _bind_kernel_to_connection(websocket, kernel_id)
        await manager.send_personal_message({"type": "notebook_comm_ack", "kernel_id": kernel_id}, websocket)
    except Exception as e:
        await _send_notebook_error(websocket, str(e), error_code="notebook_comm_msg_failed")
