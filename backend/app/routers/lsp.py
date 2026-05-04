from fastapi import APIRouter, WebSocket, WebSocketDisconnect
import logging
import os
import asyncio

logger = logging.getLogger(__name__)

router = APIRouter()

# Global state for LSP availability
_lsp_available = False
LSPBridge = None
lsp_bridge_manager = None

try:
    from app.services.lsp_bridge import LSPBridge as _LSPBridge, lsp_bridge_manager as _lsp_bridge_manager
    LSPBridge = _LSPBridge
    lsp_bridge_manager = _lsp_bridge_manager
    _lsp_available = True
except ImportError as e:
    logger.warning("LSP Bridge import failed: %s", e)
except Exception as e:
    logger.warning("LSP Bridge unavailable: %s", e)

def _ws_log(msg: str):
    if os.getenv('INSPYRO_WS_DEBUG', '0') == '1':
        logger.debug("[WS-LSP] %s", msg)

@router.websocket("/ws/lsp")
async def lsp_websocket_endpoint(websocket: WebSocket):
    """
    WebSocket endpoint para Language Server Protocol.
    Conecta clientes Monaco con el Python Language Server (pylsp).
    """
    if not _lsp_available or LSPBridge is None:
        await websocket.close(code=1003, reason="LSP no disponible")
        return
    
    await websocket.accept()
    client_id = id(websocket)
    # Instantiate bridge for this connection
    bridge = LSPBridge()
    
    # Try to start pylsp process
    if not await bridge.start():
        await websocket.close(code=1011, reason="No se pudo iniciar pylsp")
        return
    
    # Pre-configure pylsp with stubs path so completions work from the start
    await bridge.configure()
    
    _ws_log(f"🔤 LSP: Nueva conexión establecida (client_id={client_id})")
    
    async def forward_to_client(msg: dict):
        """Callback para reenviar mensajes del LSP al cliente WebSocket."""
        try:
            await websocket.send_json(msg)
        except Exception as e:
            _ws_log(f"🔤 LSP: Error enviando a cliente: {e}")
    
    # Iniciar tarea de lectura desde pylsp
    await bridge.start_forwarding(forward_to_client)
    
    try:
        while True:
            # Recibir mensajes del cliente y enviar al LSP
            data = await websocket.receive_json()
            if not await bridge.send(data):
                _ws_log("🔤 LSP: Error enviando a pylsp, cerrando conexión")
                break
    except WebSocketDisconnect:
        _ws_log(f"🔤 LSP: Cliente desconectado (client_id={client_id})")
    except Exception as e:
        _ws_log(f"🔤 LSP: Error en conexión: {e}")
    finally:
        await bridge.stop()
        _ws_log(f"🔤 LSP: Conexión cerrada (client_id={client_id})")
