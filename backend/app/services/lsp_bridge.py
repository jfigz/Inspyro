"""
Bridge para Python Language Server Protocol.
Gestiona procesos pylsp y traduce mensajes WebSocket <-> stdio.
"""

import asyncio
import json
import logging
import os
import subprocess
import sys
from pathlib import Path
from typing import Any, Callable, Optional

logger = logging.getLogger(__name__)


class LSPBridge:
    """
    Gestiona una conexion LSP para un cliente WebSocket.

    Actua como puente entre un WebSocket del cliente y el proceso pylsp,
    traduciendo mensajes JSON-RPC entre ambos.
    """

    _SERVICES_DIR = Path(__file__).parent.resolve()
    _BACKEND_DIR = _SERVICES_DIR.parent.parent
    _PROJECT_ROOT = _BACKEND_DIR.parent

    DEFAULT_STUBS_PATH = str(_BACKEND_DIR / "stubs")

    def __init__(self, workspace_root: Optional[str] = None):
        self.process: Optional[subprocess.Popen[bytes]] = None
        self._reader_task: Optional[asyncio.Task] = None
        self._stderr_task: Optional[asyncio.Task] = None
        self._running = False
        self.workspace_root = workspace_root or str(self._PROJECT_ROOT)
        self._configured = False

    async def start(self) -> bool:
        """
        Inicia el proceso pylsp.

        Usa subprocess.Popen en lugar de asyncio.create_subprocess_exec porque
        en Windows el event loop selector de uvicorn no soporta subprocess
        transport y lanza NotImplementedError.
        """
        commands: list[list[str]] = []
        env_python = os.getenv("INSPYRO_PYTHON")
        if env_python:
            commands.append([env_python, "-m", "pylsp"])

        if os.name == "nt":
            venv_python = self._PROJECT_ROOT / "venv_inspyro" / "Scripts" / "python.exe"
        else:
            venv_python = self._PROJECT_ROOT / "venv_inspyro" / "bin" / "python"
        if venv_python.exists():
            commands.append([str(venv_python), "-m", "pylsp"])

        if sys.executable and os.path.exists(sys.executable):
            commands.append([sys.executable, "-m", "pylsp"])

        commands.append(["pylsp"])

        for cmd in commands:
            try:
                creation_flags = 0
                if sys.platform == "win32":
                    creation_flags = subprocess.CREATE_NO_WINDOW

                self.process = subprocess.Popen(
                    cmd,
                    stdin=subprocess.PIPE,
                    stdout=subprocess.PIPE,
                    stderr=subprocess.PIPE,
                    cwd=str(self._BACKEND_DIR),
                    creationflags=creation_flags,
                )

                await asyncio.sleep(0.2)
                if self.process.poll() is not None:
                    err_excerpt = self._read_stderr_excerpt()
                    logger.warning(
                        "LSP command exited immediately (cmd=%s, returncode=%s, stderr=%s)",
                        cmd,
                        self.process.returncode,
                        err_excerpt or "<empty>",
                    )
                    self.process = None
                    continue

                self._running = True
                logger.info("LSP bridge started with PID %s using %s", self.process.pid, cmd[0])
                return True
            except FileNotFoundError:
                logger.debug("LSP command not available: %s", cmd[0])
            except Exception as exc:
                logger.warning("Failed to start pylsp (%s): %s", type(exc).__name__, exc)
                self.process = None

        loop_name = "<unknown>"
        try:
            loop_name = type(asyncio.get_running_loop()).__name__
        except Exception:
            pass
        logger.warning(
            "Unable to start pylsp. Install python-lsp-server[all] if missing. event_loop=%s",
            loop_name,
        )
        return False

    async def send(self, message: dict) -> bool:
        """Envia un mensaje JSON-RPC al servidor LSP."""
        if not self.process or not self.process.stdin or not self._running:
            return False

        try:
            content = json.dumps(message).encode("utf-8")
            header = f"Content-Length: {len(content)}\r\n\r\n".encode("utf-8")
            await asyncio.to_thread(self._write_stdin, header + content)
            return True
        except Exception as exc:
            logger.error("Error sending to LSP: %s", exc)
            return False

    async def read_message(self) -> Optional[dict]:
        """Lee un mensaje JSON-RPC del servidor LSP."""
        if not self.process or not self.process.stdout or not self._running:
            return None

        try:
            return await asyncio.to_thread(self._read_message_sync)
        except asyncio.CancelledError:
            raise
        except Exception as exc:
            logger.error("Error reading from LSP: %s", exc)
            return None

    async def start_forwarding(self, send_callback: Callable[[dict], Any]) -> None:
        """Inicia el reenvio de mensajes del LSP al callback."""

        async def forward_loop():
            while self._running:
                try:
                    msg = await self.read_message()
                    if msg:
                        await send_callback(msg)
                    else:
                        await asyncio.sleep(0.01)
                except asyncio.CancelledError:
                    break
                except Exception as exc:
                    logger.error("Error in LSP forward loop: %s", exc)
                    break

        self._reader_task = asyncio.create_task(forward_loop())
        self._stderr_task = asyncio.create_task(self._drain_stderr())

    async def stop(self) -> None:
        """Detiene el proceso pylsp y limpia recursos."""
        self._running = False

        if self._reader_task:
            self._reader_task.cancel()
            try:
                await self._reader_task
            except asyncio.CancelledError:
                pass
            self._reader_task = None

        if self._stderr_task:
            self._stderr_task.cancel()
            try:
                await self._stderr_task
            except asyncio.CancelledError:
                pass
            self._stderr_task = None

        if self.process:
            try:
                if self.process.poll() is None:
                    self.process.terminate()
                    try:
                        await asyncio.to_thread(self.process.wait, 5.0)
                    except subprocess.TimeoutExpired:
                        self.process.kill()
                        await asyncio.to_thread(self.process.wait, 5.0)
            except Exception as exc:
                logger.error("Error stopping pylsp: %s", exc)
            finally:
                self.process = None

        logger.info("LSP bridge stopped")

    @classmethod
    def build_extra_paths(cls, extra_paths: Optional[list] = None) -> list[str]:
        """
        Construye y normaliza extra_paths para Jedi.

        Siempre incluye backend/stubs y normaliza rutas relativas para
        evitar dependencia del cwd del proceso pylsp.
        """
        candidates = [Path(cls.DEFAULT_STUBS_PATH)]
        if extra_paths:
            candidates.extend(Path(p) for p in extra_paths if isinstance(p, str) and p.strip())

        normalized: list[str] = []
        seen: set[str] = set()
        for candidate in candidates:
            resolved = candidate if candidate.is_absolute() else (cls._PROJECT_ROOT / candidate)
            resolved_str = str(resolved.resolve())
            if resolved_str in seen:
                continue
            seen.add(resolved_str)
            normalized.append(resolved_str)
        return normalized

    async def configure(self, extra_paths: Optional[list] = None) -> bool:
        """
        Envia configuracion al servidor LSP para jedi/pylsp.

        Configura extra_paths para que jedi pueda encontrar los stubs
        de la API DOCX y otras librerias inyectadas.
        """
        if not self._running:
            return False

        paths = self.build_extra_paths(extra_paths)

        settings = {
            "pylsp": {
                "plugins": {
                    "jedi": {
                        "extra_paths": paths,
                        "environment": None,
                    },
                    "jedi_completion": {
                        "enabled": True,
                        "include_params": True,
                        "include_class_objects": True,
                        "fuzzy": True,
                    },
                    "jedi_hover": {"enabled": True},
                    "jedi_references": {"enabled": True},
                    "jedi_signature_help": {"enabled": True},
                    "jedi_symbols": {
                        "enabled": True,
                        "all_scopes": True,
                    },
                    "pylint": {"enabled": False},
                    "pycodestyle": {"enabled": False},
                    "mccabe": {"enabled": False},
                    "pyflakes": {"enabled": True},
                    "flake8": {"enabled": False},
                }
            }
        }

        result = await self.send(
            {
                "jsonrpc": "2.0",
                "method": "workspace/didChangeConfiguration",
                "params": {"settings": settings},
            }
        )

        if result:
            self._configured = True
            logger.info("LSP configured with extra_paths: %s", paths)

        return result

    @property
    def is_running(self) -> bool:
        """Indica si el bridge esta activo."""
        return self._running and self.process is not None

    @property
    def is_configured(self) -> bool:
        """Indica si el bridge ya fue configurado."""
        return self._configured

    def _write_stdin(self, payload: bytes) -> None:
        if not self.process or not self.process.stdin:
            raise RuntimeError("LSP stdin no disponible")
        self.process.stdin.write(payload)
        self.process.stdin.flush()

    def _read_message_sync(self) -> Optional[dict]:
        if not self.process or not self.process.stdout or not self._running:
            return None

        headers: dict[str, str] = {}
        while True:
            line = self.process.stdout.readline()
            if not line:
                return None
            line_str = line.decode("utf-8", errors="replace").strip()
            if line_str == "":
                break
            if ":" in line_str:
                key, value = line_str.split(":", 1)
                headers[key.strip().lower()] = value.strip()

        content_length = int(headers.get("content-length", 0))
        if content_length <= 0:
            return None

        content = self.process.stdout.read(content_length)
        if not content:
            return None
        return json.loads(content.decode("utf-8"))

    def _read_stderr_excerpt(self, limit: int = 2000) -> str:
        if not self.process or not self.process.stderr:
            return ""
        try:
            return self.process.stderr.read(limit).decode("utf-8", errors="replace").strip()
        except Exception:
            return ""

    async def _drain_stderr(self) -> None:
        while self._running and self.process and self.process.stderr:
            try:
                line = await asyncio.to_thread(self.process.stderr.readline)
            except asyncio.CancelledError:
                raise
            except Exception as exc:
                logger.debug("LSP stderr reader stopped: %s", exc)
                break

            if not line:
                break

            text = line.decode("utf-8", errors="replace").strip()
            if text:
                logger.debug("pylsp stderr: %s", text)


class LSPBridgeManager:
    """Gestiona multiples bridges LSP."""

    def __init__(self):
        self._bridges: dict[int, LSPBridge] = {}
        self._lock = asyncio.Lock()

    async def create_bridge(self, client_id: int) -> Optional[LSPBridge]:
        """Crea un nuevo bridge para un cliente."""
        async with self._lock:
            bridge = LSPBridge()
            if await bridge.start():
                self._bridges[client_id] = bridge
                return bridge
            return None

    async def remove_bridge(self, client_id: int) -> None:
        """Elimina y detiene un bridge."""
        async with self._lock:
            bridge = self._bridges.pop(client_id, None)
            if bridge:
                await bridge.stop()

    async def shutdown_all(self) -> None:
        """Detiene todos los bridges."""
        async with self._lock:
            for bridge in self._bridges.values():
                await bridge.stop()
            self._bridges.clear()

    @property
    def active_count(self) -> int:
        """Numero de bridges activos."""
        return len(self._bridges)


lsp_bridge_manager = LSPBridgeManager()
