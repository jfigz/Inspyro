"""Manual websocket check for PDF conversion diagnostics."""

import asyncio
import json
import os

import pytest
import websockets


pytestmark = [pytest.mark.integration, pytest.mark.manual]
WS_URL = os.getenv("INSPYRO_TEST_WS_URL", "ws://localhost:8000/ws")


async def _run_pdf_debug_session() -> None:
    async with websockets.connect(WS_URL) as ws:
        await ws.send(json.dumps({"type": "notebook_create", "cwd": r"c:\CalcPyro\P1"}))

        kernel_id = None
        cell_id = None
        while True:
            response = json.loads(await ws.recv())
            if response.get("type") == "notebook_created":
                kernel_id = response.get("kernel_id")
                cell_id = (response.get("notebook", {}).get("cells", [{}])[0]).get("id")
                break

        assert kernel_id and cell_id

        code = (
            "from librerias_propias.math_to_docx import doc_begin, Text\n"
            "doc_begin(order=1)\n"
            "Text('Test PDF Conversion')\n"
            "print('Done')"
        )
        await ws.send(
            json.dumps(
                {
                    "type": "notebook_execute_cell",
                    "kernel_id": kernel_id,
                    "cell_id": cell_id,
                    "source": code.split("\n"),
                    "emit_docx": True,
                }
            )
        )

        saw_result = False
        for _ in range(30):
            try:
                response = json.loads(await asyncio.wait_for(ws.recv(), 3))
            except asyncio.TimeoutError:
                continue

            msg_type = response.get("type")
            if msg_type == "notebook_cell_executed":
                saw_result = True
            if msg_type == "notebook_pdf_ready":
                saw_result = True
                break

        assert saw_result, "Expected execution or PDF diagnostic messages were not received"
        await ws.send(json.dumps({"type": "notebook_shutdown_kernel", "kernel_id": kernel_id}))


@pytest.mark.asyncio
async def test_pdf_debug_manual() -> None:
    if os.getenv("INSPYRO_RUN_MANUAL_WS_TESTS") != "1":
        pytest.skip("Manual integration test. Set INSPYRO_RUN_MANUAL_WS_TESTS=1 to run.")
    await _run_pdf_debug_session()


if __name__ == "__main__":
    asyncio.run(_run_pdf_debug_session())
