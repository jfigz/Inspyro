"""Inspyro Bridge - Cliente interno REST+WS para el servidor MCP.

Centraliza:
- Conexion HTTP al backend FastAPI.
- Conexion WebSocket al dispatcher principal.
- Correlacion por ``request_id`` para requests discretos.
- Suscripcion por ``execution_id`` para flujos multi-mensaje.
"""

from __future__ import annotations

import asyncio
import inspect
import json
import logging
import threading
import uuid
from contextlib import asynccontextmanager
from typing import Any, Callable, Optional

import httpx
import websockets
import websockets.exceptions

from . import config
from .session_state import McpSessionState
from .runtime import DEFAULT_SESSION_ID, resolve_session_id

logger = logging.getLogger("inspyro.mcp.bridge")

_DISCONNECTED_MESSAGE_TYPE = "__bridge_disconnected__"


class BridgeError(RuntimeError):
    """Error estructurado del bridge REST/WS."""

    def __init__(
        self,
        message: str,
        *,
        payload: Optional[dict[str, Any]] = None,
        messages: Optional[list[dict[str, Any]]] = None,
    ) -> None:
        super().__init__(message)
        self.payload = payload or {}
        self.messages = list(messages or [])


class InspyroBridge:
    """Cliente async session-scoped que conecta con el backend Inspyro local."""

    _instance: Optional["InspyroBridge"] = None
    _instances: dict[str, "InspyroBridge"] = {}
    _instances_lock = threading.RLock()

    def __init__(self, *, session_id: str) -> None:
        self._session_id = resolve_session_id(session_id)
        self._http: Optional[httpx.AsyncClient] = None
        self._ws: Optional[websockets.WebSocketClientProtocol] = None
        self._ws_lock = asyncio.Lock()
        self._request_queues: dict[str, asyncio.Queue[dict[str, Any]]] = {}
        self._execution_subscribers: dict[str, set[asyncio.Queue[dict[str, Any]]]] = {}
        self._listener_task: Optional[asyncio.Task[None]] = None
        self._connected = False
        self._session_state = McpSessionState.get()

    def register_execution_observer(
        self,
        execution_id: str,
    ) -> tuple[asyncio.Queue[dict[str, Any]], Callable[[], None]]:
        """Registra un observer interno para todos los mensajes de un ``execution_id``."""
        normalized = self._normalize_key(execution_id)
        if normalized is None:
            raise BridgeError("execution_id requerido para registrar observer")

        queue: asyncio.Queue[dict[str, Any]] = asyncio.Queue()
        subscribers = self._execution_subscribers.setdefault(normalized, set())
        subscribers.add(queue)

        def unregister() -> None:
            current = self._execution_subscribers.get(normalized)
            if current is None:
                return
            current.discard(queue)
            if not current:
                self._execution_subscribers.pop(normalized, None)

        return queue, unregister

    @classmethod
    def get(cls, session_id: str | None = None) -> "InspyroBridge":
        """Obtiene la instancia del bridge para la sesion MCP actual."""
        resolved_session = resolve_session_id(session_id)
        with cls._instances_lock:
            instance = cls._instances.get(resolved_session)
            if instance is None:
                instance = cls(session_id=resolved_session)
                cls._instances[resolved_session] = instance
            if resolved_session == DEFAULT_SESSION_ID:
                cls._instance = instance
            return instance

    @classmethod
    async def disconnect_all(cls) -> None:
        with cls._instances_lock:
            instances = list(cls._instances.values())
            cls._instances.clear()
            cls._instance = None
        for instance in instances:
            await instance.disconnect()

    async def connect(self) -> None:
        """Conecta al backend Inspyro (REST + WS)."""
        if self._connected:
            return

        self._http = httpx.AsyncClient(
            base_url=config.BACKEND_URL,
            timeout=httpx.Timeout(config.REST_TIMEOUT),
        )

        try:
            resp = await self._http.get("/health")
            resp.raise_for_status()
            logger.info("Backend Inspyro conectado en %s", config.BACKEND_URL)
        except (httpx.ConnectError, httpx.HTTPStatusError) as exc:
            raise ConnectionError(
                f"No se pudo conectar al backend Inspyro en {config.BACKEND_URL}. "
                "Asegurate de que el backend este corriendo (./restart_inspyro.ps1)."
            ) from exc

        await self._connect_ws()
        self._connected = True

    async def _connect_ws(self) -> None:
        """Conecta o reconecta el WebSocket al backend."""
        if self._listener_task and not self._listener_task.done():
            self._listener_task.cancel()
            try:
                await self._listener_task
            except asyncio.CancelledError:
                pass

        try:
            self._ws = await websockets.connect(
                config.BACKEND_WS_URL,
                max_size=50 * 1024 * 1024,
                ping_interval=20,
                ping_timeout=20,
                close_timeout=5,
            )
            self._listener_task = asyncio.create_task(self._ws_listener())
            logger.info("WebSocket conectado a %s", config.BACKEND_WS_URL)
        except Exception as exc:
            logger.warning("No se pudo conectar WS a %s: %s", config.BACKEND_WS_URL, exc)
            self._ws = None
            self._notify_disconnect("websocket_connect_failed")

    async def _ensure_http(self) -> httpx.AsyncClient:
        if self._http is None:
            await self.connect()
        if self._http is None:
            raise ConnectionError("Cliente HTTP del bridge no inicializado.")
        return self._http

    async def _ensure_ws(self) -> websockets.WebSocketClientProtocol:
        async with self._ws_lock:
            if self._ws is None or self._ws_is_closed():
                await self._connect_ws()
            if self._ws is None:
                raise ConnectionError("No se pudo establecer conexion WebSocket con el backend.")
            return self._ws

    def _ws_is_closed(self) -> bool:
        """Verifica si el WS esta cerrado, compatible con websockets v13+."""
        if self._ws is None:
            return True
        try:
            from websockets.protocol import State

            return self._ws.state is State.CLOSED
        except (AttributeError, ImportError):
            pass
        try:
            return self._ws.closed
        except AttributeError:
            return False

    async def disconnect(self) -> None:
        """Cierra conexiones al backend y limpia waiters/subscribers."""
        if self._listener_task and not self._listener_task.done():
            self._listener_task.cancel()
            try:
                await self._listener_task
            except asyncio.CancelledError:
                pass

        if self._ws and not self._ws_is_closed():
            try:
                await self._ws.close()
            except Exception:
                pass

        if self._http:
            await self._http.aclose()

        self._notify_disconnect("bridge_disconnected")
        self._connected = False
        self._ws = None
        self._http = None
        logger.info("Bridge desconectado.")

    def _notify_disconnect(self, reason: str) -> None:
        message = {"type": _DISCONNECTED_MESSAGE_TYPE, "reason": reason}

        for queue in self._request_queues.values():
            queue.put_nowait(message)
        self._request_queues.clear()

        for queues in self._execution_subscribers.values():
            for queue in queues:
                queue.put_nowait(message)
        self._execution_subscribers.clear()

    @staticmethod
    def _normalize_key(value: Any) -> Optional[str]:
        if value is None:
            return None
        text = str(value).strip()
        return text or None

    @staticmethod
    def _extract_http_payload(response: httpx.Response) -> Any:
        try:
            return response.json()
        except Exception:
            return response.text

    @classmethod
    def _is_error_payload(
        cls,
        payload: dict[str, Any],
        error_types: Optional[set[str]] = None,
    ) -> bool:
        msg_type = str(payload.get("type") or "")
        if error_types and msg_type in error_types:
            return True
        if msg_type in {"error", "template_error", "notebook_error", "notebook_cell_error"}:
            return True
        if msg_type.endswith("_error"):
            return True
        return False

    @classmethod
    def _build_bridge_error(
        cls,
        payload: dict[str, Any],
        *,
        messages: Optional[list[dict[str, Any]]] = None,
    ) -> BridgeError:
        msg_type = str(payload.get("type") or "bridge_error")
        error_message = (
            payload.get("error")
            or payload.get("message")
            or payload.get("detail")
            or f"Backend returned {msg_type}"
        )
        return BridgeError(str(error_message), payload=payload, messages=messages)

    async def _raise_for_status(
        self,
        response: httpx.Response,
        *,
        method: str,
        path: str,
    ) -> None:
        try:
            response.raise_for_status()
        except httpx.HTTPStatusError as exc:
            payload = self._extract_http_payload(response)
            detail = payload.get("detail") if isinstance(payload, dict) else payload
            raise BridgeError(
                f"REST {method} {path} failed: {detail}",
                payload={
                    "type": "rest_error",
                    "method": method,
                    "path": path,
                    "status_code": response.status_code,
                    "detail": detail,
                    "response": payload,
                },
            ) from exc

    def _record_message_side_effects(self, message: dict[str, Any]) -> None:
        self._session_state.observe_execution_message(message, session_id=self._session_id)

    async def _ws_listener(self) -> None:
        """Loop de escucha de mensajes WS del backend."""
        assert self._ws is not None
        try:
            async for raw in self._ws:
                try:
                    msg = json.loads(raw)
                except json.JSONDecodeError:
                    logger.warning("Mensaje WS no JSON recibido: %s", raw[:200])
                    continue

                if not isinstance(msg, dict):
                    logger.debug("Mensaje WS ignorado por no ser objeto JSON: %r", msg)
                    continue

                self._record_message_side_effects(msg)

                request_id = self._normalize_key(msg.get("request_id"))
                execution_id = self._normalize_key(msg.get("execution_id"))
                routed = False

                if request_id:
                    queue = self._request_queues.get(request_id)
                    if queue is not None:
                        queue.put_nowait(msg)
                        routed = True

                if execution_id:
                    for queue in list(self._execution_subscribers.get(execution_id, ())):
                        queue.put_nowait(msg)
                        routed = True

                if not routed:
                    logger.debug("Mensaje WS no solicitado: type=%s", msg.get("type", ""))

        except websockets.exceptions.ConnectionClosed:
            logger.warning("WebSocket cerrado por el servidor.")
            self._ws = None
            self._notify_disconnect("websocket_closed")
        except asyncio.CancelledError:
            self._notify_disconnect("listener_cancelled")
            raise
        except Exception:
            logger.exception("Error en WS listener")
            self._ws = None
            self._notify_disconnect("listener_failed")

    async def rest_get(self, path: str, *, params: Optional[dict] = None) -> Any:
        """GET request al backend REST."""
        http = await self._ensure_http()
        try:
            resp = await http.get(path, params=params)
        except httpx.HTTPError as exc:
            raise BridgeError(
                f"REST GET {path} failed: {exc}",
                payload={"type": "rest_error", "method": "GET", "path": path},
            ) from exc
        await self._raise_for_status(resp, method="GET", path=path)
        return resp.json()

    async def rest_post(self, path: str, *, json_data: Optional[dict] = None) -> Any:
        """POST request al backend REST."""
        http = await self._ensure_http()
        try:
            resp = await http.post(path, json=json_data)
        except httpx.HTTPError as exc:
            raise BridgeError(
                f"REST POST {path} failed: {exc}",
                payload={"type": "rest_error", "method": "POST", "path": path},
            ) from exc
        await self._raise_for_status(resp, method="POST", path=path)
        return resp.json()

    async def rest_post_files(
        self,
        path: str,
        *,
        files: dict[str, tuple[str, bytes, str]],
    ) -> Any:
        """POST multipart/form-data al backend REST."""
        http = await self._ensure_http()
        try:
            resp = await http.post(path, files=files)
        except httpx.HTTPError as exc:
            raise BridgeError(
                f"REST multipart POST {path} failed: {exc}",
                payload={"type": "rest_error", "method": "POST", "path": path},
            ) from exc
        await self._raise_for_status(resp, method="POST", path=path)
        return resp.json()

    async def rest_delete(self, path: str, *, params: Optional[dict] = None) -> Any:
        """DELETE request al backend REST."""
        http = await self._ensure_http()
        try:
            resp = await http.delete(path, params=params)
        except httpx.HTTPError as exc:
            raise BridgeError(
                f"REST DELETE {path} failed: {exc}",
                payload={"type": "rest_error", "method": "DELETE", "path": path},
            ) from exc
        await self._raise_for_status(resp, method="DELETE", path=path)
        return resp.json()

    async def rest_get_bytes(self, path: str, *, params: Optional[dict] = None) -> bytes:
        """GET request que retorna bytes raw (para PDF/DOCX)."""
        http = await self._ensure_http()
        try:
            resp = await http.get(path, params=params)
        except httpx.HTTPError as exc:
            raise BridgeError(
                f"REST bytes GET {path} failed: {exc}",
                payload={"type": "rest_error", "method": "GET", "path": path},
            ) from exc
        await self._raise_for_status(resp, method="GET", path=path)
        return resp.content

    async def rest_post_bytes(self, path: str, *, json_data: Optional[dict] = None) -> bytes:
        """POST request que retorna bytes raw (para DOCX/PDF generados)."""
        http = await self._ensure_http()
        try:
            resp = await http.post(path, json=json_data)
        except httpx.HTTPError as exc:
            raise BridgeError(
                f"REST bytes POST {path} failed: {exc}",
                payload={"type": "rest_error", "method": "POST", "path": path},
            ) from exc
        await self._raise_for_status(resp, method="POST", path=path)
        return resp.content

    async def ws_send(self, msg_type: str, data: dict) -> None:
        """Envia un mensaje WS sin esperar respuesta."""
        ws = await self._ensure_ws()
        payload = {"type": msg_type, **data}
        await ws.send(json.dumps(payload))
        logger.debug("WS enviado: type=%s", msg_type)

    async def ws_request(
        self,
        msg_type: str,
        data: dict,
        *,
        response_type: Optional[str] = None,
        success_types: Optional[set[str] | list[str]] = None,
        error_types: Optional[set[str] | list[str]] = None,
        timeout: Optional[int] = None,
    ) -> dict[str, Any]:
        """Envia un mensaje WS y espera la respuesta correlacionada por request_id."""
        ws = await self._ensure_ws()
        timeout = timeout or config.WS_TIMEOUT

        request_id = self._normalize_key(data.get("request_id"))
        if request_id is None:
            request_id = str(uuid.uuid4())[:8]
            data["request_id"] = request_id

        success_set = set(success_types or ())
        if response_type:
            success_set.add(response_type)
        error_set = set(error_types or ())

        if request_id in self._request_queues:
            raise BridgeError(
                f"request_id duplicado en bridge: {request_id}",
                payload={"type": "bridge_error", "request_id": request_id},
            )

        queue: asyncio.Queue[dict[str, Any]] = asyncio.Queue()
        self._request_queues[request_id] = queue

        try:
            payload = {"type": msg_type, **data}
            await ws.send(json.dumps(payload))
            logger.debug("WS request: type=%s request_id=%s", msg_type, request_id)

            while True:
                msg = await asyncio.wait_for(queue.get(), timeout=timeout)
                if msg.get("type") == _DISCONNECTED_MESSAGE_TYPE:
                    raise ConnectionError(
                        f"WebSocket desconectado mientras se esperaba {msg_type} (request_id={request_id})"
                    )
                if self._is_error_payload(msg, error_set):
                    raise self._build_bridge_error(msg, messages=[msg])
                if not success_set or str(msg.get("type") or "") in success_set:
                    return msg
                logger.debug(
                    "WS request %s ignora mensaje intermedio type=%s",
                    request_id,
                    msg.get("type"),
                )

        except asyncio.TimeoutError as exc:
            raise TimeoutError(
                f"Timeout ({timeout}s) esperando respuesta para {msg_type} "
                f"(request_id={request_id})"
            ) from exc
        finally:
            self._request_queues.pop(request_id, None)

    @asynccontextmanager
    async def execution_subscription(self, execution_id: str):
        """Suscribe una cola a todos los mensajes de un ``execution_id``."""
        queue, unregister = self.register_execution_observer(execution_id)
        try:
            yield queue
        finally:
            unregister()

    async def ws_request_multi(
        self,
        msg_type: str,
        data: dict,
        *,
        collect_types: list[str],
        terminal_type: Optional[str] = None,
        terminal_types: Optional[list[str] | set[str]] = None,
        error_types: Optional[list[str] | set[str]] = None,
        on_message: Optional[Any] = None,
        timeout: Optional[int] = None,
    ) -> list[dict[str, Any]]:
        """Envia un mensaje WS y recolecta multiples respuestas por ``execution_id``."""
        ws = await self._ensure_ws()
        timeout = timeout or config.WS_TIMEOUT

        execution_id = self._normalize_key(data.get("execution_id")) or self._normalize_key(data.get("request_id"))
        if execution_id is None:
            execution_id = str(uuid.uuid4())[:8]
            data["execution_id"] = execution_id

        collect_set = set(collect_types or [])
        terminal_set = set(terminal_types or [])
        if terminal_type:
            terminal_set.add(terminal_type)
        error_set = set(error_types or [])
        collected: list[dict[str, Any]] = []

        async with self.execution_subscription(execution_id) as queue:
            payload = {"type": msg_type, **data}
            await ws.send(json.dumps(payload))
            logger.debug("WS multi-request: type=%s execution_id=%s", msg_type, execution_id)

            loop = asyncio.get_running_loop()
            deadline = loop.time() + timeout

            while True:
                remaining = deadline - loop.time()
                if remaining <= 0:
                    raise TimeoutError(
                        f"Timeout ({timeout}s) esperando stream para {msg_type} "
                        f"(execution_id={execution_id})"
                    )

                msg = await asyncio.wait_for(queue.get(), timeout=remaining)
                if msg.get("type") == _DISCONNECTED_MESSAGE_TYPE:
                    raise ConnectionError(
                        f"WebSocket desconectado mientras se esperaba stream {msg_type} "
                        f"(execution_id={execution_id})"
                    )

                msg_type_value = str(msg.get("type") or "")
                is_error = self._is_error_payload(msg, error_set)
                is_relevant = (
                    not collect_set
                    or msg_type_value in collect_set
                    or msg_type_value in terminal_set
                    or is_error
                )
                if not is_relevant:
                    continue

                collected.append(msg)
                if on_message is not None:
                    callback_result = on_message(msg)
                    if inspect.isawaitable(callback_result):
                        await callback_result

                if is_error:
                    raise self._build_bridge_error(msg, messages=collected)
                if msg_type_value in terminal_set:
                    return collected
