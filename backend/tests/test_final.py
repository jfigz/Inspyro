"""Manual websocket check for converter fields in notebook_pdf_ready."""

import asyncio
import json
import os

import pytest
import websockets


pytestmark = [pytest.mark.integration, pytest.mark.manual]
WS_URL = os.getenv("INSPYRO_TEST_WS_URL", "ws://localhost:8000/ws")


async def _run_converter_field_check() -> None:
    async with websockets.connect(WS_URL) as ws:
        await ws.send(json.dumps({"type": "notebook_create", "cwd": r"c:\CalcPyro\P1"}))

        kernel_id = None
        cell_id = None
        for _ in range(10):
            response = json.loads(await asyncio.wait_for(ws.recv(), 5))
            if response.get("type") == "notebook_created":
                kernel_id = response.get("kernel_id")
                cell_id = (response.get("notebook", {}).get("cells", [{}])[0]).get("id")
                break

        assert kernel_id and cell_id

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

        saw_pdf_ready = False
        for _ in range(60):
            try:
                response = json.loads(await asyncio.wait_for(ws.recv(), 1))
            except asyncio.TimeoutError:
                continue
            if response.get("type") == "notebook_pdf_ready":
                saw_pdf_ready = True
                assert "converter_used" in response
                assert "word_error" in response
                break

        assert saw_pdf_ready, "notebook_pdf_ready was not observed"
        await ws.send(json.dumps({"type": "notebook_shutdown_kernel", "kernel_id": kernel_id}))


@pytest.mark.asyncio
async def test_converter_fields_manual() -> None:
    if os.getenv("INSPYRO_RUN_MANUAL_WS_TESTS") != "1":
        pytest.skip("Manual integration test. Set INSPYRO_RUN_MANUAL_WS_TESTS=1 to run.")
    await _run_converter_field_check()


if __name__ == "__main__":
    asyncio.run(_run_converter_field_check())
