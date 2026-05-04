from app.contracts.ws_models import validate_ws_message_payload


def test_validate_ws_message_payload_accepts_valid_execute_cell_message():
    ok, errors = validate_ws_message_payload(
        "notebook_execute_cell",
        {
            "type": "notebook_execute_cell",
            "kernel_id": "kernel-1",
            "cell_id": "cell-1",
            "source": ["print('ok')"],
            "execution_timeout_s": 90,
        },
    )
    assert ok is True
    assert errors == []


def test_validate_ws_message_payload_rejects_invalid_execute_cell_message():
    ok, errors = validate_ws_message_payload(
        "notebook_execute_cell",
        {
            "type": "notebook_execute_cell",
            "cell_id": "cell-1",
        },
    )
    assert ok is False
    assert isinstance(errors, list)
    assert errors
    assert any("kernel_id" in err.get("loc", "") for err in errors)


def test_validate_ws_message_payload_rejects_boolean_execute_timeout():
    ok, errors = validate_ws_message_payload(
        "notebook_execute_cell",
        {
            "type": "notebook_execute_cell",
            "kernel_id": "kernel-1",
            "cell_id": "cell-1",
            "execution_timeout_s": True,
        },
    )
    assert ok is False
    assert any("execution_timeout_s" in err.get("loc", "") for err in errors)


def test_validate_ws_message_payload_skips_unconfigured_message_types():
    ok, errors = validate_ws_message_payload(
        "ping",
        {"type": "ping"},
    )
    assert ok is True
    assert errors == []


def test_validate_ws_message_payload_accepts_template_attach():
    ok, errors = validate_ws_message_payload(
        "template_attach",
        {
            "type": "template_attach",
            "kernel_id": "kernel-1",
            "template_token": "token-123",
        },
    )
    assert ok is True
    assert errors == []


def test_validate_ws_message_payload_rejects_template_attach_without_token():
    ok, errors = validate_ws_message_payload(
        "template_attach",
        {
            "type": "template_attach",
            "kernel_id": "kernel-1",
        },
    )
    assert ok is False
    assert errors


def test_validate_ws_message_payload_accepts_template_update_semantic_slots():
    ok, errors = validate_ws_message_payload(
        "template_update_semantic_slots",
        {
            "type": "template_update_semantic_slots",
            "kernel_id": "kernel-1",
            "semantic_style_slots": {
                "body": {
                    "selection_key": "body|BodyText|Body Text",
                    "style_id": "BodyText",
                    "style_name": "Body Text",
                },
            },
        },
    )
    assert ok is True
    assert errors == []


def test_validate_ws_message_payload_accepts_notebook_attach_kernel():
    ok, errors = validate_ws_message_payload(
        "notebook_attach_kernel",
        {
            "type": "notebook_attach_kernel",
            "kernel_id": "kernel-1",
        },
    )
    assert ok is True
    assert errors == []


def test_validate_ws_message_payload_rejects_cancel_code_execution_without_target():
    ok, errors = validate_ws_message_payload(
        "cancel_code_execution",
        {
            "type": "cancel_code_execution",
        },
    )
    assert ok is False
    assert errors
