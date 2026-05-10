"""Manual websocket check that notebook_pdf_ready includes expected keys."""

import asyncio
import json
import os

import pytest
import websockets


pytestmark = [pytest.mark.integration, pytest.mark.manual]
WS_URL = os.getenv("INSPYRO_TEST_WS_URL", "ws://localhost:8000/ws")


async def _run_full_message_check() -> None:
    async with websockets.connect(WS_URL) as ws:
        await ws.send(json.dumps({"type": "notebook_create", "cwd": r"C:\Inspyro\Workspace"}))

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
            "Text('Test PDF Conversion Full Debug')\n"
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

        pdf_ready_payload = None
        for _ in range(30):
            try:
                response = json.loads(await asyncio.wait_for(ws.recv(), 3))
            except asyncio.TimeoutError:
                continue
            if response.get("type") == "notebook_pdf_ready":
                pdf_ready_payload = response
                break

        assert pdf_ready_payload is not None, "notebook_pdf_ready was not received"
        for key in ("type", "kernel_id", "pdf_file_b64", "converter_used", "word_error"):
            assert key in pdf_ready_payload

        await ws.send(json.dumps({"type": "notebook_shutdown_kernel", "kernel_id": kernel_id}))


@pytest.mark.asyncio
async def test_full_pdf_message_manual() -> None:
    if os.getenv("INSPYRO_RUN_MANUAL_WS_TESTS") != "1":
        pytest.skip("Manual integration test. Set INSPYRO_RUN_MANUAL_WS_TESTS=1 to run.")
    await _run_full_message_check()


if __name__ == "__main__":
    asyncio.run(_run_full_message_check())
