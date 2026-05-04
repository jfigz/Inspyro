"""
Servicio de gestion de conexiones WebSocket.

Este modulo maneja las conexiones WebSocket de la aplicacion,
proporcionando funcionalidad para:
- Aceptar y registrar conexiones
- Enviar mensajes personales y broadcasts
- Manejar desconexiones de forma segura
- Metricas de conexiones
"""

import asyncio
from dataclasses import dataclass
import json
import math
import os
from typing import Any, List, Optional

from fastapi import WebSocket

from app.services import runtime_metrics
from app.services.home_compact import home_compact_store

# =============================================================================
# CONFIGURACION
# =============================================================================

WS_MAX_MESSAGE_SIZE = 10 * 1024 * 1024  # 10MB maximo por mensaje
WS_DEBUG_LOGGING = os.getenv("INSPYRO_WS_DEBUG", "0") == "1"
WS_OUTGOING_QUEUE_MAXSIZE = max(1, int(os.getenv("INSPYRO_WS_OUTGOING_QUEUE_MAXSIZE", "128")))
WS_OUTGOING_QUEUE_SATURATION_CLOSE_CODE = 1013
_WS_RECURSIVE_PLACEHOLDER = "<recursive-reference>"


@dataclass
class _ConnectionState:
    websocket: WebSocket
    queue: asyncio.Queue[tuple[str, float, int]]
    writer_task: Optional[asyncio.Task] = None
    closing: bool = False


def _ws_log(msg: str) -> None:
    """Log condicional para WebSocket (solo si INSPYRO_WS_DEBUG=1)."""
    if WS_DEBUG_LOGGING:
        print(msg)


def _make_json_safe(value: Any, seen: set[int] | None = None) -> Any:
    """Convierte payloads WS a JSON estricto evitando NaN/Infinity y ciclos simples."""
    if value is None or isinstance(value, (bool, int, str)):
        return value

    if isinstance(value, float):
        return value if math.isfinite(value) else None

    if seen is None:
        seen = set()

    if isinstance(value, dict):
        obj_id = id(value)
        if obj_id in seen:
            return _WS_RECURSIVE_PLACEHOLDER
        seen.add(obj_id)
        try:
            return {
                key if isinstance(key, str) else str(key): _make_json_safe(item, seen)
                for key, item in value.items()
            }
        finally:
            seen.discard(obj_id)

    if isinstance(value, (list, tuple, set, frozenset)):
        obj_id = id(value)
        if obj_id in seen:
            return [_WS_RECURSIVE_PLACEHOLDER]
        seen.add(obj_id)
        try:
            return [_make_json_safe(item, seen) for item in value]
        finally:
            seen.discard(obj_id)

    return value


def _serialize_ws_message(message: dict) -> str:
    safe_message = _make_json_safe(message)
    return json.dumps(safe_message, ensure_ascii=False, default=str, allow_nan=False)


# =============================================================================
# CONNECTION MANAGER
# =============================================================================

class ConnectionManager:
    """Gestor de conexiones WebSocket con manejo robusto de errores."""

    def __init__(self, outgoing_queue_maxsize: Optional[int] = None):
        self.active_connections: List[WebSocket] = []
        self._connection_count = 0  # Contador total para metricas
        self._lock = asyncio.Lock()  # Protects active_connections list
        self._connection_states: dict[int, _ConnectionState] = {}
        self._outgoing_queue_maxsize = max(
            1,
            int(outgoing_queue_maxsize if outgoing_queue_maxsize is not None else WS_OUTGOING_QUEUE_MAXSIZE),
        )

    @staticmethod
    def _bound_manager(websocket: WebSocket) -> "ConnectionManager | None":
        manager = getattr(websocket, "_inspyro_connection_manager", None)
        return manager if isinstance(manager, ConnectionManager) else None

    def _resolve_manager_for_websocket(self, websocket: WebSocket) -> "ConnectionManager":
        bound_manager = self._bound_manager(websocket)
        if bound_manager is not None:
            return bound_manager
        return self

    async def _close_websocket_safely(
        self,
        websocket: WebSocket,
        *,
        code: int,
        reason: Optional[str] = None,
    ) -> None:
        close_method = getattr(websocket, "close", None)
        if not callable(close_method):
            return
        try:
            if reason is None:
                await close_method(code=code)
            else:
                await close_method(code=code, reason=reason)
        except TypeError:
            try:
                await close_method(code)
            except Exception:
                pass
        except Exception:
            pass

    async def _writer_loop(self, state: _ConnectionState) -> None:
        websocket = state.websocket
        connection_id = id(websocket)
        loop = asyncio.get_running_loop()

        while True:
            payload, enqueued_at, payload_bytes_len = await state.queue.get()
            wait_ms = max(0.0, (loop.time() - enqueued_at) * 1000.0)
            runtime_metrics.record_outgoing_queue_dequeued(
                connection_id,
                state.queue.qsize(),
                wait_ms,
            )
            try:
                runtime_metrics.record_ws_outgoing_payload(payload_bytes_len)
                await websocket.send_text(payload)
            except asyncio.CancelledError:
                raise
            except RuntimeError as exc:
                _ws_log(f"[WS] Writer websocket no disponible: {exc}")
                await self._disconnect_internal(
                    websocket,
                    close=False,
                    cancel_writer=False,
                )
                return
            except Exception as exc:
                _ws_log(f"[WS] Writer error enviando mensaje: {type(exc).__name__}: {exc}")
                await self._disconnect_internal(
                    websocket,
                    close=False,
                    cancel_writer=False,
                )
                return
            finally:
                state.queue.task_done()

    async def connect(self, websocket: WebSocket) -> None:
        """Acepta y registra una nueva conexion WebSocket."""
        await websocket.accept()
        setattr(websocket, "_inspyro_connection_manager", self)
        state = _ConnectionState(
            websocket=websocket,
            queue=asyncio.Queue(maxsize=self._outgoing_queue_maxsize),
        )
        state.writer_task = asyncio.create_task(self._writer_loop(state))
        async with self._lock:
            self.active_connections.append(websocket)
            self._connection_count += 1
            self._connection_states[id(websocket)] = state
        _ws_log(f"[WS] Conexiones activas: {len(self.active_connections)}")

    async def _disconnect_internal(
        self,
        websocket: WebSocket,
        *,
        close: bool,
        cancel_writer: bool,
        close_code: int = 1000,
        close_reason: Optional[str] = None,
    ) -> None:
        connection_id = id(websocket)
        current_task = asyncio.current_task()
        state: Optional[_ConnectionState] = None

        async with self._lock:
            state = self._connection_states.pop(connection_id, None)
            try:
                self.active_connections.remove(websocket)
                _ws_log(f"[WS] Conexion cerrada. Activas: {len(self.active_connections)}")
            except ValueError:
                # WebSocket ya no esta en la lista - no es un error
                pass
            if state is not None:
                state.closing = True

        runtime_metrics.clear_outgoing_queue_connection(connection_id)

        if cancel_writer and state and state.writer_task and state.writer_task is not current_task:
            state.writer_task.cancel()
            try:
                await state.writer_task
            except asyncio.CancelledError:
                pass
            except Exception:
                pass

        if close:
            await self._close_websocket_safely(
                websocket,
                code=close_code,
                reason=close_reason,
            )

    async def disconnect(self, websocket: WebSocket) -> None:
        """Elimina una conexion de la lista de activas de forma segura."""
        target_manager = self._resolve_manager_for_websocket(websocket)
        if target_manager is not self:
            await target_manager.disconnect(websocket)
            return
        await self._disconnect_internal(
            websocket,
            close=False,
            cancel_writer=True,
        )

    async def _enqueue_serialized_payload(
        self,
        *,
        websocket: WebSocket,
        payload: str,
        payload_bytes_len: int,
    ) -> bool:
        connection_id = id(websocket)
        should_disconnect = False

        async with self._lock:
            state = self._connection_states.get(connection_id)
            if state is None or state.closing:
                return False

            if state.queue.full():
                state.closing = True
                runtime_metrics.record_outgoing_queue_full(connection_id, state.queue.maxsize)
                should_disconnect = True
            else:
                try:
                    state.queue.put_nowait((payload, asyncio.get_running_loop().time(), payload_bytes_len))
                except asyncio.QueueFull:
                    state.closing = True
                    runtime_metrics.record_outgoing_queue_full(connection_id, state.queue.maxsize)
                    should_disconnect = True
                else:
                    runtime_metrics.record_outgoing_queue_enqueued(
                        connection_id,
                        state.queue.qsize(),
                        state.queue.maxsize,
                    )

        if should_disconnect:
            _ws_log(
                f"[WS] Cola saliente saturada; cerrando conexion {connection_id} "
                f"(maxsize={self._outgoing_queue_maxsize})"
            )
            await self._disconnect_internal(
                websocket,
                close=True,
                cancel_writer=True,
                close_code=WS_OUTGOING_QUEUE_SATURATION_CLOSE_CODE,
                close_reason="outgoing_queue_saturated",
            )
            return False

        return True

    async def send_personal_message(self, message: dict, websocket: WebSocket) -> bool:
        """Envia un mensaje a un WebSocket especifico."""
        target_manager = self._resolve_manager_for_websocket(websocket)
        if target_manager is not self:
            return await target_manager.send_personal_message(message, websocket)
        try:
            home_compact_store.observe_notebook_message(message)
            try:
                json_data = _serialize_ws_message(message)
            except (TypeError, ValueError, RecursionError) as json_err:
                _ws_log(f"[WS] Error serializando mensaje: {json_err}")
                json_data = json.dumps(
                    {"type": "error", "message": "Error interno de serializacion"},
                    ensure_ascii=False,
                    allow_nan=False,
                )
            return await self._enqueue_serialized_payload(
                websocket=websocket,
                payload=json_data,
                payload_bytes_len=len(json_data.encode("utf-8")),
            )
        except RuntimeError as exc:
            _ws_log(f"[WS] WebSocket no disponible: {exc}")
            await self.disconnect(websocket)
            return False
        except Exception as exc:
            _ws_log(f"[WS] Error enviando mensaje WebSocket: {type(exc).__name__}: {exc}")
            await self.disconnect(websocket)
            return False

    async def broadcast(self, message: dict) -> int:
        """Envia un mensaje a todas las conexiones activas."""
        async with self._lock:
            connections = self.active_connections.copy()

        home_compact_store.observe_notebook_message(message)

        # Serialize once outside the loop to avoid repeated json.dumps calls.
        try:
            payload = _serialize_ws_message(message)
        except (TypeError, ValueError, RecursionError) as json_err:
            _ws_log(f"[WS] Error serializando broadcast: {json_err}")
            payload = json.dumps(
                {"type": "error", "message": "Error interno de serializacion"},
                ensure_ascii=False,
                allow_nan=False,
            )
        payload_bytes_len = len(payload.encode("utf-8"))
        successful = 0

        for connection in connections:
            try:
                accepted = await self._enqueue_serialized_payload(
                    websocket=connection,
                    payload=payload,
                    payload_bytes_len=payload_bytes_len,
                )
                if accepted:
                    successful += 1
            except RuntimeError as exc:
                _ws_log(f"[WS] Broadcast websocket no disponible: {exc}")
                await self.disconnect(connection)
            except Exception as exc:
                _ws_log(f"[WS] Error en broadcast a conexion: {type(exc).__name__}: {exc}")
                await self.disconnect(connection)
        return successful

    @property
    def connection_count(self) -> int:
        """Retorna el numero de conexiones activas."""
        return len(self.active_connections)

    @property
    def total_connections(self) -> int:
        """Retorna el numero total de conexiones desde el inicio."""
        return self._connection_count

    def get_metrics(self) -> dict:
        """Retorna metricas del gestor de conexiones."""
        backlog_connections = 0
        backlog_depth = 0
        for state in self._connection_states.values():
            depth = state.queue.qsize()
            backlog_depth += depth
            if depth > 0:
                backlog_connections += 1
        return {
            "active": self.connection_count,
            "total": self.total_connections,
            "outgoing_queue_maxsize": self._outgoing_queue_maxsize,
            "outgoing_connections_with_backlog": backlog_connections,
            "outgoing_queue_depth_current": backlog_depth,
        }


# =============================================================================
# INSTANCIA GLOBAL
# =============================================================================

# Instancia singleton para uso en toda la aplicacion
manager = ConnectionManager()
notebook_manager = ConnectionManager(
    outgoing_queue_maxsize=max(
        1,
        int(os.getenv("INSPYRO_NOTEBOOK_WS_OUTGOING_QUEUE_MAXSIZE", str(WS_OUTGOING_QUEUE_MAXSIZE))),
    )
)
