"""
Bridge de Kernel Jupyter para Inspyro.

Este módulo gestiona kernels reales (ipykernel) usando jupyter_client
y expone operaciones de alto nivel para ejecutar celdas y recoger outputs
en formato compatible con notebooks Jupyter.
"""

from __future__ import annotations

import asyncio
from contextlib import suppress
import logging
import os
from dataclasses import dataclass
import ast as _ast
import json as _json
from queue import Empty as QueueEmpty
from typing import Any, Dict, List, Optional, Set, Tuple

logger = logging.getLogger(__name__)

# Timeouts configurables via env vars
KERNEL_EXECUTION_TIMEOUT = float(os.getenv('INSPYRO_KERNEL_TIMEOUT', '600'))
KERNEL_IDLE_TIMEOUT = float(os.getenv('INSPYRO_KERNEL_IDLE_TIMEOUT', '10'))
IOPUB_CALLBACK_MAX_PENDING = max(1, int(os.getenv('INSPYRO_IOPUB_MAX_PENDING', '128')))
VARIABLE_CAPTURE_TIMEOUT = float(os.getenv('INSPYRO_VARIABLE_CAPTURE_TIMEOUT', '2.5'))
VARIABLE_CAPTURE_RETRY_COUNT = max(0, int(os.getenv('INSPYRO_VARIABLE_CAPTURE_RETRY_COUNT', '1')))
VARIABLE_CAPTURE_RETRY_DELAY = max(0.0, float(os.getenv('INSPYRO_VARIABLE_CAPTURE_RETRY_DELAY', '0.05')))
DEFAULT_POST_REPLY_IDLE_GRACE_TIMEOUT = max(
    0.25,
    min(
        float(os.getenv('INSPYRO_POST_REPLY_IDLE_GRACE_TIMEOUT', str(min(KERNEL_IDLE_TIMEOUT, 2.0)))),
        10.0,
    ),
)


try:
    # jupyter_client >= 8.x expone AsyncKernelManager/AsyncKernelClient en el top-level
    from jupyter_client import AsyncKernelManager  # type: ignore
    try:
        from jupyter_client import AsyncKernelClient  # type: ignore
    except Exception:
        # Compatibilidad: algunas instalaciones lo exponen en asynchronous.client
        from jupyter_client.asynchronous.client import AsyncKernelClient  # type: ignore
except Exception as e:  # pragma: no cover
    AsyncKernelManager = None  # type: ignore
    AsyncKernelClient = None  # type: ignore
    _import_error = e
else:
    _import_error = None


def _decode_ue_literal(text: str) -> str:
    """Decode quoted python-literal payloads produced by user_expressions."""
    s = str(text or "").strip()
    if not s:
        return ""
    quoted = (s.startswith("'") and s.endswith("'")) or (s.startswith('"') and s.endswith('"'))
    if not quoted:
        return s
    try:
        decoded = _ast.literal_eval(s)
        if isinstance(decoded, str):
            # Common case from user_expressions: JSON text containing repr strings
            # encoded as "\\'" which is invalid for JSON decoders.
            if "\\'" in decoded and decoded[:1] in {"{", "["}:
                decoded = decoded.replace("\\'", "'")
            return decoded
        return str(decoded)
    except Exception:
        # Backward-compatible fallback when literal eval fails.
        return s[1:-1]


def _extract_ue_text(entry: Any) -> Optional[str]:
    """Extract a plain-text value from a Jupyter `user_expressions` entry.

    The kernel returns each user_expression as a dict like::

        {"data": {"text/plain": "'some_value'"}, "status": "ok"}

    This helper normalises the value: joins lists, strips surrounding quotes,
    and returns the cleaned string (or *None* if the entry is empty/invalid).
    """
    if not isinstance(entry, dict):
        return None
    data = entry.get('data', {}) or {}
    txt = data.get('text/plain')
    if isinstance(txt, list):
        txt = ''.join(txt)
    if not isinstance(txt, str):
        return None
    s = _decode_ue_literal(txt)
    return s if s else None


def _safe_json_loads(raw_text: Optional[str], *, field_name: str) -> Any:
    """Parse JSON from user_expressions with defensive fallback decoding."""
    if not raw_text:
        return None

    try:
        return _json.loads(raw_text)
    except _json.JSONDecodeError as exc:
        decoded = _decode_ue_literal(raw_text)
        if decoded != raw_text:
            try:
                return _json.loads(decoded)
            except Exception as fallback_exc:
                logger.debug(
                    "Failed parsing %s from user_expressions after fallback decode: %s / %s",
                    field_name,
                    exc,
                    fallback_exc,
                )
                return None
        logger.debug("Failed parsing %s from user_expressions: %s", field_name, exc)
        return None
    except Exception as exc:
        logger.debug("Failed parsing %s from user_expressions: %s", field_name, exc)
        return None


def _describe_exception(exc: BaseException) -> str:
    text = str(exc or "").strip()
    if text:
        return text
    return exc.__class__.__name__


def _is_benign_iopub_empty(exc: BaseException) -> bool:
    return isinstance(exc, QueueEmpty) or exc.__class__.__name__ == "Empty"


def _default_execution_extras() -> Dict[str, Any]:
    return {"performance_data": {}, "execution_states": []}


def _resolve_timeout_seconds(
    value: Optional[float],
    *,
    default: float,
    minimum: float = 0.01,
) -> float:
    try:
        resolved = float(value) if value is not None else float(default)
    except (TypeError, ValueError):
        resolved = float(default)
    if resolved <= minimum:
        return float(default)
    return resolved


def _resolve_post_reply_idle_grace_timeout(
    requested: Optional[float],
    *,
    execution_timeout: float,
) -> float:
    grace_timeout = _resolve_timeout_seconds(
        requested,
        default=DEFAULT_POST_REPLY_IDLE_GRACE_TIMEOUT,
        minimum=0.01,
    )
    return max(0.25, min(grace_timeout, max(execution_timeout, 0.25)))


@dataclass
class KernelSession:
    kernel_id: str
    manager: AsyncKernelManager
    client: AsyncKernelClient
    execute_lock: asyncio.Lock
    last_variables: Dict[str, Any] = None  # type: ignore
    last_extras: Dict[str, Any] = None  # type: ignore
    # Caché inteligente: {var_name: (object_id, serialized_value)}
    _var_id_cache: Dict[str, tuple] = None  # type: ignore


class JupyterKernelManager:
    """Gestor de kernels Jupyter reales para notebooks Inspyro."""

    def __init__(self) -> None:
        self._sessions: Dict[str, KernelSession] = {}
        self._lock = asyncio.Lock()

    def _create_client(self, manager: AsyncKernelManager) -> AsyncKernelClient:
        client = manager.client()
        if client is None:
            raise RuntimeError("No se pudo crear el cliente del kernel Jupyter")
        client.start_channels()
        return client

    async def start_kernel(self, kernel_name: str = "python3", cwd: Optional[str] = None) -> str:
        """Inicia un nuevo kernel y devuelve su id."""
        if _import_error is not None:
            raise RuntimeError(
                f"Dependencias Jupyter no disponibles: {_import_error}. Instala jupyter_client, ipykernel, pyzmq, tornado."
            )

        async with self._lock:
            km = AsyncKernelManager(kernel_name=kernel_name)
            # start_kernel accepts cwd to set working directory
            kwargs = {}
            if cwd:
                kwargs['cwd'] = cwd
            await km.start_kernel(**kwargs)

            kc = self._create_client(km)
            # En jupyter_client 8.x, start_channels es síncrono

            # Verificar canal iopub operativo
            # Enviar un ping simple: solicitar ejecución vacía
            msg_id = kc.execute("", store_history=False, allow_stdin=False, silent=True)
            await self._wait_for_idle(kc, parent_msg_id=msg_id, timeout=10.0)

            kernel_id = km.kernel_id  # type: ignore[attr-defined]
            if not kernel_id:
                # Fallback: usar id del objeto
                kernel_id = str(id(km))

            self._sessions[kernel_id] = KernelSession(
                kernel_id=kernel_id,
                manager=km,
                client=kc,
                execute_lock=asyncio.Lock(),
            )
            return kernel_id

    async def restart_kernel(self, kernel_id: str) -> None:
        session = self._get_session(kernel_id)
        await session.manager.restart_kernel(now=True)
        # Reiniciar canales: detener y volver a iniciar (métodos síncronos)
        try:
            session.client.stop_channels()
        except Exception as e:
            logger.debug(f"Error deteniendo canales al reiniciar: {e}")
        new_client = self._create_client(session.manager)
        session.client = new_client
        
        # Esperar a que el kernel esté listo (ping)
        try:
            msg_id = new_client.execute("", store_history=False, allow_stdin=False, silent=True)
            await self._wait_for_idle(new_client, parent_msg_id=msg_id, timeout=10.0)
        except Exception as e:
            logger.debug(f"Error esperando kernel listo tras restart: {e}")

    async def shutdown_kernel(self, kernel_id: str) -> None:
        session = self._get_session(kernel_id)
        try:
            # stop_channels es síncrono en esta versión
            session.client.stop_channels()
        finally:
            await session.manager.shutdown_kernel(now=True)
            self._sessions.pop(kernel_id, None)

    async def shutdown_all_kernels(self) -> None:
        """Apaga todos los kernels activos. Útil para limpieza al cierre."""
        if not self._sessions:
            return
        logger.info(f"Apagando {len(self._sessions)} kernels activos...")
        kernel_ids = list(self._sessions.keys())
        for k_id in kernel_ids:
            try:
                await self.shutdown_kernel(k_id)
            except Exception as e:
                logger.error(f"Error apagando kernel {k_id} durante shutdown global: {e}")


    async def interrupt_kernel(self, kernel_id: str) -> None:
        """Interrumpe la ejecución del kernel (señal estilo Ctrl+C)."""
        session = self._get_session(kernel_id)
        await session.manager.interrupt_kernel()

    def _get_session(self, kernel_id: str) -> KernelSession:
        session = self._sessions.get(kernel_id)
        if not session:
            raise ValueError(f"Kernel {kernel_id} no encontrado")
        return session

    def get_last_variables(self, kernel_id: str) -> Dict[str, Any]:
        """Obtiene las últimas variables capturadas para un kernel (fire-and-forget)."""
        session = self._sessions.get(kernel_id)
        if session and session.last_variables:
            return session.last_variables
        return {}

    async def capture_variables_now(self, kernel_id: str, timeout: float = VARIABLE_CAPTURE_TIMEOUT) -> Dict[str, Any]:
        """Captura variables ON-DEMAND (lazy capture).
        
        Llamar solo cuando se necesiten las variables (ej: al mostrar grafo de dependencias).
        Timeout corto para no bloquear mucho.
        """
        try:
            session = self._get_session(kernel_id)
            async with session.execute_lock:
                kc = session.client
                variables, extras = await asyncio.wait_for(
                    self._capture_variables_summary(kc, timeout=timeout),
                    timeout=timeout + 0.5
                )
            # Guardar en sesión para cache
            session.last_variables = variables
            session.last_extras = extras
            return variables
        except asyncio.TimeoutError:
            return {}
        except Exception:
            return {}

    async def execute_cell(
        self,
        kernel_id: str,
        code: str,
        capture_variables: bool = True,
        on_iopub: Optional[Any] = None,
        capture_docx: bool = False,
        execution_timeout: Optional[float] = None,
        post_reply_idle_grace_timeout: Optional[float] = None,
    ) -> Tuple[List[Dict[str, Any]], int, Dict[str, Any], Dict[str, Any]]:
        session = self._get_session(kernel_id)
        async with session.execute_lock:
            return await self._execute_cell_locked(
                session=session,
                code=code,
                capture_variables=capture_variables,
                on_iopub=on_iopub,
                capture_docx=capture_docx,
                execution_timeout=execution_timeout,
                post_reply_idle_grace_timeout=post_reply_idle_grace_timeout,
            )

    async def _execute_cell_locked(
        self,
        *,
        session: KernelSession,
        code: str,
        capture_variables: bool = True,
        on_iopub: Optional[Any] = None,
        capture_docx: bool = False,
        execution_timeout: Optional[float] = None,
        post_reply_idle_grace_timeout: Optional[float] = None,
    ) -> Tuple[List[Dict[str, Any]], int, Dict[str, Any], Dict[str, Any]]:
        """
        Ejecuta código en el kernel y devuelve (outputs, execution_count, variables_summary).

        - outputs: lista de outputs nbformat (stream, execute_result, display_data, error)
        - execution_count: contador asignado por el kernel a esta ejecución
        - variables_summary: diccionario serializado con variables del usuario (heurística amigable)
        """
        kc = session.client
        effective_execution_timeout = _resolve_timeout_seconds(
            execution_timeout,
            default=KERNEL_EXECUTION_TIMEOUT,
        )
        effective_post_reply_idle_grace_timeout = _resolve_post_reply_idle_grace_timeout(
            post_reply_idle_grace_timeout,
            execution_timeout=effective_execution_timeout,
        )


        # Lanzar ejecución
        parent_msg_id = kc.execute(
            code,
            store_history=True,
            allow_stdin=True,
            stop_on_error=False,
            silent=False,
            user_expressions=None,
        )

        outputs: List[Dict[str, Any]] = []
        execution_count: Optional[int] = None

        # Mapa display_id -> índice en outputs
        display_id_to_index: Dict[str, int] = {}

        # Recolectar en paralelo: shell reply + iopub mensajes hasta idle
        reply_task = asyncio.create_task(
            self._wait_for_execute_reply(
                kc,
                parent_msg_id,
                timeout=effective_execution_timeout,
            )
        )
        iopub_task = asyncio.create_task(
            self._collect_iopub_outputs(
                kc,
                parent_msg_id,
                outputs,
                display_id_to_index,
                timeout=effective_execution_timeout,
                on_iopub=on_iopub,
            )
        )

        try:
            reply = await reply_task
            try:
                execution_count = int(reply.get("content", {}).get("execution_count", 0) or 0)
            except Exception:
                execution_count = 0
            iopub_diagnostics: Dict[str, Any] = {}
            try:
                iopub_diagnostics = await asyncio.wait_for(
                    iopub_task,
                    timeout=effective_post_reply_idle_grace_timeout,
                )
            except asyncio.TimeoutError:
                iopub_diagnostics = {"idle_missing": True}
                logger.warning(
                    "Proceeding without IOPub idle after execute_reply for kernel %s msg %s",
                    session.kernel_id,
                    parent_msg_id,
                )
                iopub_task.cancel()
                with suppress(asyncio.CancelledError):
                    await iopub_task
        finally:
            if not reply_task.done():
                reply_task.cancel()
                with suppress(asyncio.CancelledError):
                    await reply_task
            if not iopub_task.done():
                iopub_task.cancel()
                with suppress(asyncio.CancelledError):
                    await iopub_task

        variables: Dict[str, Any] = {}
        extras: Dict[str, Any] = _default_execution_extras()
        execution_diagnostics: Dict[str, Any] = {}
        if iopub_diagnostics.get("iopub_error"):
            execution_diagnostics["iopub_error"] = iopub_diagnostics["iopub_error"]
        if iopub_diagnostics.get("idle_missing"):
            execution_diagnostics["idle_missing"] = True
        if capture_variables:
            await asyncio.sleep(0.01)
            variables, extras, capture_diagnostics = await self._capture_variables_with_fallback(
                session,
                kc,
                timeout=VARIABLE_CAPTURE_TIMEOUT,
                retry_count=VARIABLE_CAPTURE_RETRY_COUNT,
                retry_delay=VARIABLE_CAPTURE_RETRY_DELAY,
            )
            execution_diagnostics.update(capture_diagnostics)
        if execution_diagnostics:
            extras = dict(extras or _default_execution_extras())
            extras.setdefault("execution_diagnostics", {}).update(execution_diagnostics)
        return outputs, execution_count, variables, extras

    async def _capture_variables_with_fallback(
        self,
        session: KernelSession,
        kc: AsyncKernelClient,
        *,
        timeout: float,
        retry_count: int,
        retry_delay: float,
    ) -> Tuple[Dict[str, Any], Dict[str, Any], Dict[str, Any]]:
        diagnostics: Dict[str, Any] = {}
        capture_error: Optional[str] = None

        for attempt in range(retry_count + 1):
            try:
                variables, extras = await asyncio.wait_for(
                    self._capture_variables_summary(kc, timeout=timeout),
                    timeout=timeout + 0.25,
                )
                if not isinstance(variables, dict):
                    variables = {}
                if not isinstance(extras, dict):
                    extras = _default_execution_extras()
                session.last_variables = dict(variables)
                session.last_extras = dict(extras)
                return variables, extras, diagnostics
            except asyncio.TimeoutError:
                capture_error = "timeout"
                diagnostics["variables_capture_timeout"] = True
            except Exception as exc:
                capture_error = _describe_exception(exc)
            if attempt < retry_count and retry_delay > 0:
                await asyncio.sleep(retry_delay)

        has_snapshot = session.last_variables is not None
        diagnostics["variables_capture_degraded"] = True
        if has_snapshot:
            variables = dict(session.last_variables or {})
            extras = dict(session.last_extras or _default_execution_extras())
            extras.setdefault("variables_snapshot_fallback", True)
        else:
            variables = {}
            extras = _default_execution_extras()
        extras.setdefault("variables_snapshot_degraded", True)

        if capture_error:
            diagnostics["variables_capture_error"] = capture_error
        if diagnostics:
            logger.warning(
                "Variables capture degraded for kernel %s: %s (fallback=%s)",
                session.kernel_id,
                diagnostics,
                has_snapshot,
            )
        return variables, extras, diagnostics

    async def _collect_iopub_outputs(
        self,
        kc: AsyncKernelClient,
        parent_msg_id: str,
        outputs: List[Dict[str, Any]],
        display_id_to_index: Dict[str, int],
        timeout: float = KERNEL_EXECUTION_TIMEOUT,
        on_iopub: Optional[Any] = None,
    ) -> Dict[str, Any]:
        """Recoge mensajes iopub hasta el estado idle de esta ejecucion."""
        loop_deadline = asyncio.get_event_loop().time() + timeout
        got_idle = False
        pending_callback_tasks: Set[asyncio.Task] = set()
        diagnostics: Dict[str, Any] = {}

        async def _dispatch_iopub(msg_type: str, content: Dict[str, Any]) -> None:
            if on_iopub is None:
                return

            async def _run_callback() -> None:
                try:
                    await on_iopub(msg_type, content, parent_msg_id)
                except Exception:
                    pass

            task = asyncio.create_task(_run_callback())
            pending_callback_tasks.add(task)

            def _cleanup(done_task: asyncio.Task) -> None:
                pending_callback_tasks.discard(done_task)
                try:
                    _ = done_task.exception()
                except asyncio.CancelledError:
                    pass
                except Exception:
                    pass

            task.add_done_callback(_cleanup)
            if len(pending_callback_tasks) >= IOPUB_CALLBACK_MAX_PENDING:
                await asyncio.wait(pending_callback_tasks, return_when=asyncio.FIRST_COMPLETED)

        while not got_idle:
            remaining = loop_deadline - asyncio.get_event_loop().time()
            if remaining <= 0:
                break
            try:
                msg = await kc.iopub_channel.get_msg(timeout=min(1.0, remaining))
            except (asyncio.TimeoutError, TimeoutError, QueueEmpty):
                continue
            except Exception as _iopub_err:
                if _is_benign_iopub_empty(_iopub_err):
                    continue
                diagnostics["iopub_error"] = _describe_exception(_iopub_err)
                logger.warning(
                    "Unexpected error reading iopub channel for msg %s: %s",
                    parent_msg_id,
                    diagnostics["iopub_error"],
                )
                break

            if msg.get("parent_header", {}).get("msg_id") != parent_msg_id:
                continue

            msg_type = msg.get("msg_type")
            content = msg.get("content", {})

            if msg_type == "status":
                if content.get("execution_state") == "idle":
                    got_idle = True
                    await _dispatch_iopub("status", content)
                continue

            if msg_type == "clear_output":
                outputs.clear()
                await _dispatch_iopub("clear_output", content)
                continue

            if msg_type == "stream":
                outputs.append(
                    {
                        "output_type": "stream",
                        "name": content.get("name", "stdout"),
                        "text": content.get("text", ""),
                    }
                )
                await _dispatch_iopub("stream", content)
                continue

            if msg_type in ("display_data", "execute_result"):
                out: Dict[str, Any] = {
                    "output_type": msg_type,
                    "data": content.get("data", {}),
                    "metadata": content.get("metadata", {}),
                }
                if "execution_count" in content:
                    out["execution_count"] = content.get("execution_count")

                display_id = content.get("transient", {}).get("display_id")
                if display_id:
                    display_id_to_index[display_id] = len(outputs)
                outputs.append(out)
                await _dispatch_iopub(msg_type, content)
                continue

            if msg_type == "update_display_data":
                display_id = content.get("transient", {}).get("display_id")
                if display_id and display_id in display_id_to_index:
                    idx = display_id_to_index[display_id]
                    if 0 <= idx < len(outputs):
                        outputs[idx] = {
                            "output_type": "display_data",
                            "data": content.get("data", {}),
                            "metadata": content.get("metadata", {}),
                        }
                await _dispatch_iopub("update_display_data", content)
                continue

            if msg_type == "error":
                ename = content.get("ename")
                evalue = content.get("evalue")
                traceback = content.get("traceback", [])

                if ename == "DimensionalityError":
                    original_evalue = str(evalue or "")
                    ename = "Error Físico (DimensionalityError)"
                    evalue = f"Operación dimensionalmente inválida: {original_evalue}"
                    # Provide a clean, short traceback instead of the full Pint internal stack
                    traceback = [f"\033[1;31m{ename}\033[0m: {evalue}"]

                outputs.append(
                    {
                        "output_type": "error",
                        "ename": ename,
                        "evalue": evalue,
                        "traceback": traceback,
                    }
                )
                await _dispatch_iopub("error", content)
                continue

            if msg_type in ("execute_input", "comm_open", "comm_msg", "comm_close"):
                await _dispatch_iopub(msg_type, content)
        if not got_idle:
            diagnostics["idle_missing"] = True
            if "iopub_error" not in diagnostics:
                logger.warning("IOPub idle missing for msg %s after %.1fs", parent_msg_id, timeout)
        return diagnostics

    async def _wait_for_execute_reply(self, kc: AsyncKernelClient, parent_msg_id: str, timeout: float = KERNEL_EXECUTION_TIMEOUT) -> Dict[str, Any]:
        deadline = asyncio.get_event_loop().time() + timeout
        while True:
            remaining = deadline - asyncio.get_event_loop().time()
            if remaining <= 0:
                raise TimeoutError("Timeout esperando execute_reply")
            try:
                msg = await kc.shell_channel.get_msg(timeout=min(1.0, remaining))
            except Exception:
                continue
            if msg.get("parent_header", {}).get("msg_id") == parent_msg_id and msg.get("msg_type") == "execute_reply":
                return msg

    async def _wait_for_idle(self, kc: AsyncKernelClient, parent_msg_id: str, timeout: float = KERNEL_IDLE_TIMEOUT) -> None:
        deadline = asyncio.get_event_loop().time() + timeout
        while True:
            remaining = deadline - asyncio.get_event_loop().time()
            if remaining <= 0:
                logger.warning("_wait_for_idle timed out after %.1fs for msg %s", timeout, parent_msg_id)
                return
            try:
                msg = await kc.iopub_channel.get_msg(timeout=min(1.0, remaining))
            except Exception:
                continue
            if msg.get("parent_header", {}).get("msg_id") == parent_msg_id:
                if msg.get("msg_type") == "status" and msg.get("content", {}).get("execution_state") == "idle":
                    return

    async def _capture_variables_summary(self, kc: AsyncKernelClient, timeout: float = KERNEL_IDLE_TIMEOUT) -> Tuple[Dict[str, Any], Dict[str, Any]]:
        """Captura variables y extras (performance/estados) vía user_expressions en execute_reply."""
        build_vars_code = r'''
import builtins

_INTEROP_MODULE_MARKERS = ('comtypes', 'win32com', 'pythoncom', 'ctypes', '_ctypes')
_INTEROP_CLASS_MARKERS = ('idispatch', 'dispatch', 'cdispatch', 'iunknown', 'pointer', 'safearray')
_SAFE_PREVIEW_MAX = 120
_JSON_VALUE_MAX_ITEMS = 64
_JSON_VALUE_MAX_DEPTH = 4

def _insp_type_name(value):
    try:
        return str(getattr(type(value), '__name__', type(value).__name__) or 'object')
    except Exception:
        return 'object'

def _insp_type_module(value):
    try:
        return str(getattr(type(value), '__module__', '') or '')
    except Exception:
        return ''

def _insp_placeholder_repr(value):
    _module = _insp_type_module(value)
    _type = _insp_type_name(value)
    return f"<{_module + '.' if _module else ''}{_type}>"

def _insp_is_safe_scalar(value):
    return value is None or isinstance(value, (bool, int, float, str))

def _insp_is_interop_like(value):
    _module = _insp_type_module(value).lower()
    _type = _insp_type_name(value).lower()
    _qualified = f"{_module}.{_type}" if _module else _type
    if any(marker in _module for marker in _INTEROP_MODULE_MARKERS):
        return True
    if any(marker in _qualified for marker in _INTEROP_CLASS_MARKERS):
        return True
    for _attr in ('_comobj', '_oleobj_', '__com_interface__'):
        try:
            if hasattr(value, _attr):
                return True
        except Exception:
            return True
    return False

def _insp_safe_scalar_repr(value):
    if value is None:
        return 'None'
    if isinstance(value, bool):
        return 'True' if value else 'False'
    if isinstance(value, (int, float)):
        return repr(value)
    if isinstance(value, str):
        _text = value
        if len(_text) > _SAFE_PREVIEW_MAX:
            _text = _text[:_SAFE_PREVIEW_MAX] + '...'
        return repr(_text)
    return _insp_placeholder_repr(value)

def _insp_small_sequence_repr(values, open_char, close_char):
    if not values:
        return open_char + close_char
    if not all(_insp_is_safe_scalar(item) for item in values):
        return open_char + '...' + close_char
    return open_char + ', '.join(_insp_safe_scalar_repr(item) for item in values) + close_char

def _insp_small_mapping_repr(mapping):
    _items = list(mapping.items())
    if not _items:
        return '{}'
    if not all(_insp_is_safe_scalar(k) and _insp_is_safe_scalar(v) for k, v in _items):
        return '{...}'
    return '{' + ', '.join(f"{_insp_safe_scalar_repr(k)}: {_insp_safe_scalar_repr(v)}" for k, v in _items) + '}'

def _insp_json_data(value, depth=0):
    if depth > _JSON_VALUE_MAX_DEPTH:
        raise ValueError('max depth exceeded')
    _quantity = _insp_try_serialize_quantity(value)
    if _quantity is not None:
        return _quantity
    if value is None or isinstance(value, (bool, int, float, str)):
        return _np_to_native(value)
    value = _np_to_native(value)
    if value is None or isinstance(value, (bool, int, float, str)):
        return value
    if isinstance(value, dict):
        if len(value) > _JSON_VALUE_MAX_ITEMS:
            raise ValueError('mapping too large')
        _payload = {}
        for _key, _item in value.items():
            if not _insp_is_safe_scalar(_key):
                raise ValueError('unsupported mapping key')
            _payload[str(_key)] = _insp_json_data(_item, depth + 1)
        return _payload
    if isinstance(value, (list, tuple)):
        if len(value) > _JSON_VALUE_MAX_ITEMS:
            raise ValueError('sequence too large')
        return [_insp_json_data(_item, depth + 1) for _item in value]
    if isinstance(value, set):
        if len(value) > _JSON_VALUE_MAX_ITEMS:
            raise ValueError('set too large')
        return [_insp_json_data(_item, depth + 1) for _item in list(value)]
    if hasattr(value, 'tolist'):
        return _insp_json_data(value.tolist(), depth + 1)
    raise ValueError('unsupported value')

def _insp_is_user_var(name, val):
    if not isinstance(name, str):
        return False
    if name.startswith('__') and name.endswith('__'):
        return False
    if name.startswith('__INSP_'):
        return False
    if name in {
        '_', '_i', '__', '___', 'In', 'Out', 'get_ipython',
        '_dh', '_ih', '_ii', '_iii', '_oh', '_sh',
        '_ip', '_np_to_native',
        'exit', 'quit',
        '__UNITS_BR', '__UNITS_IMPORT_ERROR',
        '__INSP_UNITS_BEFORE', '__INSP_UNITS_AFTER',
        '__INSP_UNITS_IMPORTED_NAMES', '__INSP_UNITS_IMPORTED_IDS',
        '__INSP_UNITS_READY', '__serialize_quantity',
    }:
        return False
    if name.startswith('_i') and len(name) > 2 and name[2:].isdigit():
        return False
    if name == 'ret' or name.startswith('ret_'):
        return False
    if name.startswith('_insp_') or name.startswith('__insp_'):
        return False
    if name in dir(builtins):
        return False
    if _insp_is_interop_like(val):
        return False
    try:
        _imported_ids = globals().get('__INSP_UNITS_IMPORTED_IDS') or {}
        _has_imported_id = name in _imported_ids
        if name in _imported_ids:
            try:
                if id(val) == _imported_ids.get(name):
                    return False
            except Exception:
                return False

        _imported = globals().get('__INSP_UNITS_IMPORTED_NAMES')
        if (not _has_imported_id) and _imported and name in _imported:
            # Extra guard for old kernels where __INSP_UNITS_IMPORTED_IDS is missing.
            if callable(val):
                return False
            if hasattr(val, 'magnitude') and hasattr(val, 'units'):
                try:
                    if float(val.magnitude) == 1.0:
                        return False
                except Exception:
                    return False
    except Exception:
        pass
    if callable(val):
        if getattr(val, '__module__', None) in ('builtins', None):
            return False
    try:
        import types
        if isinstance(val, types.ModuleType):
            return False
    except Exception:
        pass
    return True

def _np_to_native(x):
    try:
        import numpy as _np
        if isinstance(x, _np.generic):
            return x.item()
    except Exception:
        pass
    return x

def _insp_try_serialize_quantity(value):
    if not (hasattr(value, 'magnitude') and hasattr(value, 'units')):
        return None

    _serializer = globals().get('__serialize_quantity')
    if callable(_serializer):
        try:
            return _serializer(value)
        except Exception:
            pass

    try:
        from librerias_propias.inspyro_units.serialization import serialize_quantity as _insp_serialize_quantity
        return _insp_serialize_quantity(value)
    except Exception:
        pass

    # Fallback mínimo cuando la librería no está disponible en el kernel.
    try:
        _magnitude = value.magnitude
        try:
            _magnitude = float(_magnitude)
        except Exception:
            if hasattr(_magnitude, 'tolist'):
                _magnitude = _magnitude.tolist()
        return {
            'type': 'Quantity',
            'magnitude': _magnitude,
            'unit': f"{value.units:~P}",
            'unit_full': f"{value.units:P}",
            'unit_canonical': f"{value.units:~P}",
            'unit_display': f"{value.units:~P}",
            'unit_pint': f"{value.units:P}",
            'aliases': [f"{value.units:~P}", f"{value.units:P}"],
            'dimensionality': str(getattr(value, 'dimensionality', '')),
            'is_quantity': True,
            'repr': f"{value:~P}",
            'category': 'Otra',
            'metadata': None,
        }
    except Exception:
        return {
            'type': _insp_type_name(value),
            'module': _insp_type_module(value),
            'value': '<no serializable>',
            'repr': _insp_placeholder_repr(value),
        }

def _insp_conv(value):
    _quantity = _insp_try_serialize_quantity(value)
    if _quantity is not None:
        return _quantity
    if _insp_is_interop_like(value):
        return {
            'type': _insp_type_name(value),
            'class': _insp_type_name(value),
            'module': _insp_type_module(value),
            'value': '<interop object>',
            'repr': _insp_placeholder_repr(value),
            'interop': True,
        }

    _cache = globals().setdefault('_insp_import_cache', {})
    if '_np' not in _cache:
        try:
            import numpy; _cache['_np'] = numpy
        except Exception:
            _cache['_np'] = None
    if '_pd' not in _cache:
        try:
            import pandas; _cache['_pd'] = pandas
        except Exception:
            _cache['_pd'] = None
    _np = _cache['_np']
    _pd = _cache['_pd']
    try:
        if _pd is not None and isinstance(value, _pd.DataFrame):
            # Optimización: solo metadatos, sin datos completos para rendimiento
            max_rows = 5; max_cols = 10
            try: mem=int(value.memory_usage(deep=True).sum())
            except Exception: mem=None
            # Solo incluir datos si el DataFrame es pequeño
            data = None
            if value.shape[0] <= 10 and value.shape[1] <= 5:
                try:
                    d=value.head(max_rows).iloc[:, :max_cols]
                    data=[{k:_np_to_native(v) for k,v in rec.items()} for rec in d.to_dict('records')]
                except Exception: data=None
            return {'type':'DataFrame','subtype':'pandas','shape':list(value.shape),'columns':[str(c) for c in value.columns[:max_cols]],
                    'repr':f"DataFrame[{value.shape[0]} filas × {value.shape[1]} columnas]",'value':f"DataFrame ({value.shape[0]}×{value.shape[1]})",
                    'memory_usage':mem,'is_engineering_data':True,'data':data}
        if _pd is not None and isinstance(value, _pd.Series):
            # Optimización: solo metadatos básicos
            return {'type':'Series','subtype':'pandas','name':str(value.name),'length':int(len(value)),'dtype':str(value.dtype),
                    'repr':f"Series[{len(value)} elementos] dtype={value.dtype}",
                    'value':f"Series ({len(value)})"}
        if _np is not None and isinstance(value, _np.ndarray):
            # Optimización: solo metadatos para arrays grandes
            max_elements=100
            if value.size<=max_elements:
                data=value.tolist() if value.ndim<=2 else f"Array {int(value.ndim)}D"
            else:
                data=None  # No incluir datos para arrays grandes
            return {'type':'ndarray','subtype':'numpy','shape':list(value.shape),'dtype':str(value.dtype),'size':int(value.size),'ndim':int(value.ndim),
                    'data':data,'repr':f"Array{list(value.shape)} dtype={value.dtype}", 'value':f"Array {list(value.shape)}",
                    'memory_usage':int(value.nbytes),'is_engineering_data':True}
    except Exception:
        pass
    if value is None: return {'type':'NoneType','value':'None','repr':'None'}
    if isinstance(value,(bool,)): return {'type':'bool','value':bool(value),'repr':repr(bool(value))}
    if isinstance(value,(int,float)): return {'type':type(value).__name__,'value':value,'repr':repr(value)}
    if isinstance(value,str): return {'type':'str','value':value,'repr':_insp_safe_scalar_repr(value)}
    if isinstance(value,list):
        try: data=_insp_json_data(value)
        except Exception: data=None
        return {'type':'list','length':len(value),'value':f"[{len(value)} elementos]",'repr':(_insp_small_sequence_repr(value, '[', ']') if len(value)<=5 else '[...]'),'data':data}
    if isinstance(value,dict):
        try: data=_insp_json_data(value)
        except Exception: data=None
        return {'type':'dict','length':len(value),'value':'{'+str(len(value))+' elementos}','repr':(_insp_small_mapping_repr(value) if len(value)<=3 else '{...}'),'data':data}
    if isinstance(value,tuple):
        try: data=_insp_json_data(list(value))
        except Exception: data=None
        return {'type':'tuple','length':len(value),'value':f"({len(value)} elementos)",'repr':(_insp_small_sequence_repr(list(value), '(', ')') if len(value)<=5 else '(...)'),'data':data}
    if isinstance(value,set):
        try: data=_insp_json_data(list(value))
        except Exception: data=None
        return {'type':'set','length':len(value),'value':f"{{{len(value)} Ãºnicos}}",'repr':(_insp_small_sequence_repr(list(value), '{', '}') if len(value)<=3 else '{...}'),'data':data}
    if isinstance(value,list): return {'type':'list','length':len(value),'value':f"[{len(value)} elementos]",'repr':(_insp_small_sequence_repr(value, '[', ']') if len(value)<=5 else '[...]')}
    if isinstance(value,dict): return {'type':'dict','length':len(value),'value':'{'+str(len(value))+' elementos}','repr':(_insp_small_mapping_repr(value) if len(value)<=3 else '{...}')}
    if isinstance(value,tuple): return {'type':'tuple','length':len(value),'value':f"({len(value)} elementos)",'repr':(_insp_small_sequence_repr(list(value), '(', ')') if len(value)<=5 else '(...)')}
    if isinstance(value,set): return {'type':'set','length':len(value),'value':f"{{{len(value)} únicos}}",'repr':(_insp_small_sequence_repr(list(value), '{', '}') if len(value)<=3 else '{...}')}
    if callable(value):
        name=getattr(value,'__name__','callable'); return {'type':'function','name':name,'module':_insp_type_module(value),'value':f'function {name}','repr':_insp_placeholder_repr(value)}
    return {'type':_insp_type_name(value),'class':_insp_type_name(value),'module':_insp_type_module(value),'value':f"<{_insp_type_name(value)} object>", 'repr':_insp_placeholder_repr(value)}

from IPython import get_ipython
_ip=get_ipython()
_ns=dict(_ip.user_ns) if _ip and hasattr(_ip,'user_ns') else globals()

__V={}
for _n,_v in list(_ns.items()):
    if _insp_is_user_var(_n,_v):
        try: __V[_n]=_insp_conv(_v)
        except Exception: __V[_n]={'type':_insp_type_name(_v),'module':_insp_type_module(_v),'value':'<no serializable>','repr':_insp_placeholder_repr(_v)}
'''
        # Ejecutar en silencio y solicitar el JSON de __V como user_expression
        msg_id = kc.execute(
            build_vars_code,
            store_history=False,
            allow_stdin=False,
            silent=True,
            user_expressions={
                '__vars__': '__import__("json").dumps(__V)',
                '__perf__': '(__import__("json").dumps(globals().get("__insp_perf", {})) if "__insp_perf" in globals() else "{}")',
                '__states__': '(__import__("json").dumps(globals().get("__insp_states", [])) if "__insp_states" in globals() else "[]")',
            },
        )

        reply = await self._wait_for_execute_reply(kc, msg_id, timeout=timeout)
        try:
            ue = (reply.get('content', {}) or {}).get('user_expressions', {})

            # --- Variables ---
            variables: Dict[str, Any] = {}
            vars_txt = _extract_ue_text(ue.get('__vars__'))
            if vars_txt:
                parsed_vars = _safe_json_loads(vars_txt, field_name='__vars__')
                if isinstance(parsed_vars, dict):
                    variables = dict(parsed_vars)

            # --- Performance data ---
            perf: Dict[str, Any] = {}
            perf_txt = _extract_ue_text(ue.get('__perf__'))
            if perf_txt:
                parsed_perf = _safe_json_loads(perf_txt, field_name='__perf__')
                if isinstance(parsed_perf, dict):
                    perf = dict(parsed_perf)

            # --- Execution states ---
            states: list = []
            states_txt = _extract_ue_text(ue.get('__states__'))
            if states_txt:
                parsed_states = _safe_json_loads(states_txt, field_name='__states__')
                if isinstance(parsed_states, list):
                    states = list(parsed_states)

            extras_payload: Dict[str, Any] = {'performance_data': perf, 'execution_states': states}
            return variables, extras_payload
        except Exception:
            pass
        return {}, {'performance_data': {}, 'execution_states': []}


# Instancia global
jupyter_kernel_manager = JupyterKernelManager()
