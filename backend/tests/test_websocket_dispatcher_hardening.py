import json
import time

from fastapi.testclient import TestClient

from main import app


def test_ws_ping_pong():
    client = TestClient(app)
    with client.websocket_connect("/ws") as ws:
        ws.send_json({"type": "ping"})
        response = ws.receive_json()
    assert response["type"] == "pong"


def test_notebook_ws_ping_pong():
    client = TestClient(app)
    with client.websocket_connect("/ws/notebook") as ws:
        ws.send_json({"type": "ping"})
        response = ws.receive_json()
    assert response["type"] == "pong"


def test_ws_unknown_message_type_returns_structured_error():
    client = TestClient(app)
    with client.websocket_connect("/ws") as ws:
        ws.send_json({"type": "unknown_event", "request_id": "rid-123"})
        response = ws.receive_json()
    assert response["type"] == "error"
    assert response["error_code"] == "unknown_message_type"
    assert response["request_id"] == "rid-123"
    assert "supported_types" in response.get("details", {})


def test_ws_missing_message_type_returns_structured_error():
    client = TestClient(app)
    with client.websocket_connect("/ws") as ws:
        ws.send_json({"request_id": "rid-xyz"})
        response = ws.receive_json()
    assert response["type"] == "error"
    assert response["error_code"] == "missing_message_type"
    assert response["request_id"] == "rid-xyz"


def test_ws_invalid_payload_returns_structured_error():
    client = TestClient(app)
    with client.websocket_connect("/ws") as ws:
        ws.send_text(json.dumps(["not", "an", "object"]))
        response = ws.receive_json()
    assert response["type"] == "error"
    assert response["error_code"] == "invalid_payload"


def test_ws_invalid_json_returns_structured_error():
    client = TestClient(app)
    with client.websocket_connect("/ws") as ws:
        ws.send_text("{invalid-json")
        response = ws.receive_json()
    assert response["type"] == "error"
    assert response["error_code"] == "invalid_json"


def test_ws_invalid_message_payload_returns_typed_error():
    client = TestClient(app)
    with client.websocket_connect("/ws") as ws:
        ws.send_json({"type": "notebook_execute_cell", "cell_id": "cell-1"})
        response = ws.receive_json()
    assert response["type"] == "error"
    assert response["error_code"] == "invalid_message_payload"
    assert response["details"]["message_type"] == "notebook_execute_cell"
    assert isinstance(response["details"]["validation_errors"], list)
    assert response["details"]["validation_errors"]


def test_metrics_include_ws_counters():
    client = TestClient(app)
    response = client.get("/metrics")
    assert response.status_code == 200
    payload = response.json()
    assert "ws_connections_active" in payload
    assert "ws_connections_total" in payload


def test_notebook_reconnect_rebind_keeps_kernel_alive_across_execute_requests():
    client = TestClient(app)
    notebook_path = "C:\\workspace\\reconnect-report.ipynb"

    with client.websocket_connect("/ws/notebook") as ws1:
        ws1.send_json({"type": "notebook_create", "path": notebook_path})
        created = ws1.receive_json()

    assert created["type"] == "notebook_created"
    kernel_id = created["kernel_id"]

    with client.websocket_connect("/ws/notebook") as ws2:
        ws2.send_json({
            "type": "notebook_execute_cell",
            "kernel_id": kernel_id,
            "cell_id": "cell-1",
            "execution_id": "exec-1",
            "path": notebook_path,
            "source": "print('first')",
        })

        first_terminal = None
        deadline = time.time() + 15.0
        while time.time() < deadline:
            message = ws2.receive_json()
            if message.get("type") in {"notebook_cell_executed", "notebook_cell_error"}:
                first_terminal = message
                break

        assert first_terminal is not None
        assert first_terminal["type"] == "notebook_cell_executed"
        assert first_terminal["execution_id"] == "exec-1"

        time.sleep(0.2)

        ws2.send_json({
            "type": "notebook_execute_cell",
            "kernel_id": kernel_id,
            "cell_id": "cell-2",
            "execution_id": "exec-2",
            "path": notebook_path,
            "source": "print('second')",
        })

        second_terminal = None
        deadline = time.time() + 15.0
        while time.time() < deadline:
            message = ws2.receive_json()
            if message.get("type") in {"notebook_cell_executed", "notebook_cell_error"}:
                second_terminal = message
                break

        assert second_terminal is not None
        assert second_terminal["type"] == "notebook_cell_executed"
        assert second_terminal["execution_id"] == "exec-2"
