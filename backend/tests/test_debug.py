"""Manual websocket diagnostic for notebook execution and PDF conversion."""

import asyncio
import json
import os

import pytest
import websockets


pytestmark = [pytest.mark.integration, pytest.mark.manual]
WS_URL = os.getenv("INSPYRO_TEST_WS_URL", "ws://localhost:8000/ws")


async def _run_debug_session() -> None:
    async with websockets.connect(WS_URL) as ws:
        await ws.send(json.dumps({"type": "notebook_create", "cwd": r"C:\Inspyro\Workspace"}))

        kernel_id = None
        cell_id = None
        for _ in range(10):
            response = json.loads(await asyncio.wait_for(ws.recv(), 5))
            if response.get("type") == "notebook_created":
                kernel_id = response.get("kernel_id")
                cell_id = (response.get("notebook", {}).get("cells", [{}])[0]).get("id")
                break

        assert kernel_id, "Kernel was not created"
        assert cell_id, "Cell id missing in notebook_created payload"

        code = 'from librerias_propias.math_to_docx import doc_begin, Text; doc_begin(order=1); Text("Test")'
        await ws.send(
            json.dumps(
                {
                    "type": "notebook_execute_cell",
                    "kernel_id": kernel_id,
                    "cell_id": cell_id,
                    "source": [code],
                    "emit_docx": True,
                }
            )
        )

        saw_terminal_message = False
        for _ in range(30):
            try:
                response = json.loads(await asyncio.wait_for(ws.recv(), 2))
            except asyncio.TimeoutError:
                continue
            msg_type = response.get("type")
            if msg_type in {"notebook_pdf_ready", "notebook_error", "notebook_cell_error"}:
                saw_terminal_message = True
                break

        assert saw_terminal_message, "Did not receive terminal debug event"
        await ws.send(json.dumps({"type": "notebook_shutdown_kernel", "kernel_id": kernel_id}))


@pytest.mark.asyncio
async def test_websocket_debug_manual() -> None:
    if os.getenv("INSPYRO_RUN_MANUAL_WS_TESTS") != "1":
        pytest.skip("Manual integration test. Set INSPYRO_RUN_MANUAL_WS_TESTS=1 to run.")
    await _run_debug_session()


if __name__ == "__main__":
    asyncio.run(_run_debug_session())
