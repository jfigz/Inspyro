import base64
import json
import os
from pathlib import Path

import pytest

from app.services import template_binding
from app.services import template_service, workspace_service
from app.services.home_compact import home_compact_store


@pytest.fixture(autouse=True)
def _reset_template_binding_bank_state():
    with template_binding._binding_lock:
        template_binding._kernel_bindings.clear()
    home_compact_store.reset()
    yield
    with template_binding._binding_lock:
        template_binding._kernel_bindings.clear()
    home_compact_store.reset()


def _notebook() -> dict:
    return {
        "cells": [],
        "metadata": {},
        "nbformat": 4,
        "nbformat_minor": 5,
    }


def _package(docx_bytes: bytes = b"docx-bytes", slots: dict | None = None) -> dict:
    semantic_slots = slots or {"body": {"style_id": "BodyText", "name": "Body Text"}}
    return {
        "schema_version": "1.1",
        "exported_at": "2026-05-08T00:00:00+00:00",
        "kernel_id": "kernel-a",
        "template": {
            "file_name": "template.docx",
            "semantic_style_slots": semantic_slots,
        },
        "docx_base64": base64.b64encode(docx_bytes).decode("ascii"),
        "file_name": "template.docx",
        "semantic_style_slots": semantic_slots,
    }


def _write_notebook(path: Path, payload: dict) -> None:
    path.write_text(json.dumps(payload), encoding="utf-8")


def test_template_binding_uses_safe_relative_json_path(tmp_path):
    notebook_path = tmp_path / "report.ipynb"
    _write_notebook(notebook_path, _notebook())

    binding, json_path = template_binding.build_template_binding(notebook_path)

    assert binding == {
        "schema_version": 1,
        "type": "template_export_json",
        "path_base": "notebook_dir",
        "path": "report.inspyro-template.json",
    }
    assert json_path == tmp_path / "report.inspyro-template.json"


def test_template_binding_rejects_path_traversal(tmp_path):
    notebook_path = tmp_path / "report.ipynb"
    _write_notebook(notebook_path, _notebook())

    with pytest.raises(template_binding.TemplateBindingError) as exc_info:
        template_binding.build_template_binding(notebook_path, "../escape.inspyro-template.json")

    assert exc_info.value.code == "template_json_path_traversal"


def test_template_binding_rejects_non_json_extension(tmp_path):
    notebook_path = tmp_path / "report.ipynb"
    _write_notebook(notebook_path, _notebook())

    with pytest.raises(template_binding.TemplateBindingError) as exc_info:
        template_binding.build_template_binding(notebook_path, "report.inspyro-template.docx")

    assert exc_info.value.code == "invalid_template_json_extension"


def test_template_binding_rejects_symlink_escape_when_supported(tmp_path):
    workspace = tmp_path / "workspace"
    outside = tmp_path / "outside"
    workspace.mkdir()
    outside.mkdir()
    notebook_path = workspace / "report.ipynb"
    _write_notebook(notebook_path, _notebook())
    symlink_path = workspace / "linked"
    try:
        os.symlink(outside, symlink_path, target_is_directory=True)
    except (OSError, NotImplementedError) as exc:
        pytest.skip(f"symlink no disponible en este entorno: {exc}")

    with pytest.raises(template_binding.TemplateBindingError) as exc_info:
        template_binding.build_template_binding(notebook_path, "linked/escape.inspyro-template.json")

    assert exc_info.value.code == "template_json_path_traversal"


def test_template_binding_metadata_rejects_absolute_path(tmp_path):
    notebook_path = tmp_path / "report.ipynb"
    absolute_json = tmp_path / "absolute.inspyro-template.json"
    binding, _ = template_binding.build_template_binding(notebook_path)
    binding["path"] = str(absolute_json)
    notebook = template_binding.set_notebook_template_binding(_notebook(), binding)
    _write_notebook(notebook_path, notebook)

    status = template_binding.inspect_notebook_template_binding(notebook_path, notebook)

    assert status["status"] == "error"
    assert status["error_code"] == "absolute_template_binding_path"


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("payload", "expected_error"),
    [
        ("{not-json", "invalid_template_json"),
        (
            {"schema_version": "9.9", "template": {}, "docx_base64": base64.b64encode(b"x").decode("ascii")},
            "unsupported_template_json_schema",
        ),
        (
            {"schema_version": "1.1", "template": {}, "docx_base64": "not-base64"},
            "invalid_docx_base64",
        ),
        (
            {
                "schema_version": "1.1",
                "template": {},
                "docx_base64": base64.b64encode(b"x").decode("ascii"),
                "semantic_style_slots": ["body"],
            },
            "invalid_semantic_style_slots",
        ),
    ],
)
async def test_template_binding_invalid_packages_are_non_blocking(tmp_path, payload, expected_error):
    notebook_path = tmp_path / f"{expected_error}.ipynb"
    binding, json_path = template_binding.build_template_binding(notebook_path)
    if isinstance(payload, str):
        json_path.write_text(payload, encoding="utf-8")
    else:
        json_path.write_text(json.dumps(payload), encoding="utf-8")
    notebook = template_binding.set_notebook_template_binding(_notebook(), binding)
    _write_notebook(notebook_path, notebook)

    status = await template_binding.apply_notebook_template_binding_to_kernel(
        kernel_id=f"kernel-{expected_error}",
        notebook_path=notebook_path,
        notebook=notebook,
    )

    assert status["status"] == "error"
    assert status["error_code"] == expected_error
    assert status["notebook_path"] == str(notebook_path)


@pytest.mark.asyncio
async def test_notebook_load_binding_missing_json_is_non_blocking(tmp_path):
    notebook_path = tmp_path / "report.ipynb"
    binding, _ = template_binding.build_template_binding(notebook_path)
    notebook = template_binding.set_notebook_template_binding(_notebook(), binding)
    _write_notebook(notebook_path, notebook)

    status = await template_binding.apply_notebook_template_binding_to_kernel(
        kernel_id="kernel-missing",
        notebook_path=notebook_path,
        notebook=notebook,
    )

    assert status["status"] == "missing"
    assert status["error_code"] == "template_json_missing"
    assert status["binding"]["path"] == "report.inspyro-template.json"


@pytest.mark.asyncio
async def test_notebook_load_binding_applies_package_and_semantic_slots(monkeypatch, tmp_path):
    notebook_path = tmp_path / "report.ipynb"
    binding, json_path = template_binding.build_template_binding(notebook_path)
    slots = {"heading_1": {"style_id": "Heading1", "name": "Heading 1"}}
    json_path.write_text(json.dumps(_package(b"abc", slots=slots)), encoding="utf-8")
    notebook = template_binding.set_notebook_template_binding(_notebook(), binding)
    _write_notebook(notebook_path, notebook)
    applied: dict[str, object] = {}

    async def fake_apply_template_bytes_to_kernel(*, kernel_id, docx_bytes):
        applied["kernel_id"] = kernel_id
        applied["docx_bytes"] = docx_bytes
        return {"file_name": "template.docx"}

    async def fake_apply_slots(kernel_id, semantic_slots):
        applied["slots"] = semantic_slots
        return {"file_name": "template.docx", "semantic_style_slots": semantic_slots}

    monkeypatch.setattr(template_binding.template_logic, "apply_template_bytes_to_kernel", fake_apply_template_bytes_to_kernel)
    monkeypatch.setattr(template_binding, "_apply_semantic_slots_to_kernel", fake_apply_slots)

    status = await template_binding.apply_notebook_template_binding_to_kernel(
        kernel_id="kernel-bound",
        notebook_path=notebook_path,
        notebook=notebook,
    )

    assert status["status"] == "applied"
    assert applied["kernel_id"] == "kernel-bound"
    assert applied["docx_bytes"] == b"abc"
    assert applied["slots"] == slots


@pytest.mark.asyncio
async def test_bind_active_template_writes_json_and_patches_notebook(monkeypatch, tmp_path):
    notebook_path = tmp_path / "report.ipynb"
    notebook = _notebook()
    _write_notebook(notebook_path, notebook)
    docx_path = tmp_path / "template.docx"
    docx_path.write_bytes(b"active-docx")
    template_payload = {
        "file_name": "template.docx",
        "semantic_style_slots": {"body": {"style_id": "Normal"}},
    }

    monkeypatch.setattr(template_binding.template_storage, "get_template", lambda kernel_id: template_payload)
    monkeypatch.setattr(template_binding.template_storage, "get_template_docx_path", lambda kernel_id: str(docx_path))

    result = await template_binding.bind_active_template_to_notebook(
        kernel_id="kernel-bind",
        notebook_path=notebook_path,
        notebook=notebook,
    )

    json_path = tmp_path / "report.inspyro-template.json"
    written_json = json.loads(json_path.read_text(encoding="utf-8"))
    written_notebook = json.loads(notebook_path.read_text(encoding="utf-8"))
    assert result["template_binding"]["status"] == "bound"
    assert written_json["schema_version"] == "1.1"
    assert base64.b64decode(written_json["docx_base64"]) == b"active-docx"
    assert written_json["semantic_style_slots"] == {"body": {"style_id": "Normal"}}
    assert written_notebook["metadata"]["inspyro"]["template_binding"]["path"] == "report.inspyro-template.json"


@pytest.mark.asyncio
async def test_bind_endpoint_exports_json_and_patches_notebook(monkeypatch, tmp_path):
    from app.routers import templates as templates_router

    notebook_path = tmp_path / "route-report.ipynb"
    _write_notebook(notebook_path, _notebook())
    docx_path = tmp_path / "route-template.docx"
    docx_path.write_bytes(b"route-docx")
    template_payload = {
        "file_name": "route-template.docx",
        "semantic_style_slots": {"heading_1": {"style_id": "Heading1"}},
    }
    monkeypatch.setattr(template_binding.template_storage, "get_template", lambda kernel_id: template_payload)
    monkeypatch.setattr(template_binding.template_storage, "get_template_docx_path", lambda kernel_id: str(docx_path))

    result = await templates_router.bind_template_to_notebook(
        templates_router.TemplateBindRequest(
            kernel_id="kernel-route",
            notebook_path=str(notebook_path),
            notebook=_notebook(),
        )
    )

    json_path = tmp_path / "route-report.inspyro-template.json"
    assert result["binding"]["path"] == "route-report.inspyro-template.json"
    assert result["template_binding"]["status"] == "bound"
    assert json.loads(json_path.read_text(encoding="utf-8"))["schema_version"] == "1.1"
    assert json.loads(notebook_path.read_text(encoding="utf-8"))["metadata"]["inspyro"]["template_binding"] == result["binding"]


def test_workspace_default_template_is_copied_as_sibling_binding(tmp_path):
    workspace_root = tmp_path / "workspace"
    workspace_root.mkdir()
    workspace_service.set_active_workspace(str(workspace_root), create_if_missing=True)
    default_json = workspace_root / ".inspyro" / "templates" / "default.inspyro-template.json"
    default_json.parent.mkdir(parents=True)
    default_json.write_text(json.dumps(_package(b"default-docx")), encoding="utf-8")
    notebook_path = workspace_root / "new-report.ipynb"

    next_notebook, inherited = template_binding.inherit_workspace_default_template_binding(
        _notebook(),
        notebook_path,
    )

    sibling_json = workspace_root / "new-report.inspyro-template.json"
    assert inherited is not None
    assert inherited["status"] == "inherited"
    assert sibling_json.exists()
    assert json.loads(sibling_json.read_text(encoding="utf-8"))["docx_base64"] == json.loads(default_json.read_text(encoding="utf-8"))["docx_base64"]
    assert next_notebook["metadata"]["inspyro"]["template_binding"]["path"] == "new-report.inspyro-template.json"


@pytest.mark.asyncio
async def test_refresh_bound_template_export_overwrites_json(monkeypatch, tmp_path):
    notebook_path = tmp_path / "report.ipynb"
    binding, json_path = template_binding.build_template_binding(notebook_path)
    notebook = template_binding.set_notebook_template_binding(_notebook(), binding)
    _write_notebook(notebook_path, notebook)
    json_path.write_text(json.dumps(_package(b"old-docx")), encoding="utf-8")
    docx_path = tmp_path / "template.docx"
    docx_path.write_bytes(b"new-docx")
    template_binding.register_kernel_template_binding("kernel-refresh", notebook_path, binding)

    monkeypatch.setattr(template_binding.template_storage, "get_template_docx_path", lambda kernel_id: str(docx_path))

    status = await template_binding.refresh_bound_template_export(
        "kernel-refresh",
        template={"file_name": "template.docx", "semantic_style_slots": {"body": {"style_id": "Body"}}},
    )

    written_json = json.loads(json_path.read_text(encoding="utf-8"))
    assert status["status"] == "updated"
    assert base64.b64decode(written_json["docx_base64"]) == b"new-docx"
    assert written_json["semantic_style_slots"] == {"body": {"style_id": "Body"}}


@pytest.mark.asyncio
async def test_refresh_bound_template_export_isolated_by_kernel(monkeypatch, tmp_path):
    notebook_a = tmp_path / "a.ipynb"
    notebook_b = tmp_path / "b.ipynb"
    binding_a, json_a = template_binding.build_template_binding(notebook_a)
    binding_b, json_b = template_binding.build_template_binding(notebook_b)
    _write_notebook(notebook_a, template_binding.set_notebook_template_binding(_notebook(), binding_a))
    _write_notebook(notebook_b, template_binding.set_notebook_template_binding(_notebook(), binding_b))
    json_a.write_text(json.dumps(_package(b"old-a")), encoding="utf-8")
    json_b.write_text(json.dumps(_package(b"old-b")), encoding="utf-8")
    docx_a = tmp_path / "a-template.docx"
    docx_b = tmp_path / "b-template.docx"
    docx_a.write_bytes(b"a-v1")
    docx_b.write_bytes(b"b-v1")
    docx_paths = {"kernel-a": str(docx_a), "kernel-b": str(docx_b)}
    template_binding.register_kernel_template_binding("kernel-a", notebook_a, binding_a)
    template_binding.register_kernel_template_binding("kernel-b", notebook_b, binding_b)
    monkeypatch.setattr(template_binding.template_storage, "get_template_docx_path", lambda kernel_id: docx_paths[kernel_id])

    await template_binding.refresh_bound_template_export(
        "kernel-a",
        template={"file_name": "template-a.docx", "semantic_style_slots": {"body": {"style_id": "A"}}},
    )
    await template_binding.refresh_bound_template_export(
        "kernel-b",
        template={"file_name": "template-b.docx", "semantic_style_slots": {"body": {"style_id": "B"}}},
    )
    docx_a.write_bytes(b"a-v2")
    await template_binding.refresh_bound_template_export(
        "kernel-a",
        template={"file_name": "template-a.docx", "semantic_style_slots": {"body": {"style_id": "A2"}}},
    )

    package_a = json.loads(json_a.read_text(encoding="utf-8"))
    package_b = json.loads(json_b.read_text(encoding="utf-8"))
    assert base64.b64decode(package_a["docx_base64"]) == b"a-v2"
    assert package_a["semantic_style_slots"]["body"]["style_id"] == "A2"
    assert base64.b64decode(package_b["docx_base64"]) == b"b-v1"
    assert package_b["semantic_style_slots"]["body"]["style_id"] == "B"


def test_home_inventory_promotes_ipynb_binding_over_legacy_mirror(monkeypatch, tmp_path):
    workspace_root = tmp_path / "workspace"
    workspace_root.mkdir()
    notebook_path = workspace_root / "reports" / "bound.ipynb"
    notebook_path.parent.mkdir(parents=True)
    binding, json_path = template_binding.build_template_binding(notebook_path)
    json_path.write_text(json.dumps(_package(b"bound-docx")), encoding="utf-8")
    _write_notebook(notebook_path, template_binding.set_notebook_template_binding(_notebook(), binding))
    workspace_service.set_active_workspace(str(workspace_root), create_if_missing=True)
    home_compact_store.register_notebook_runtime(
        kernel_id="kernel-home",
        notebook_path=str(notebook_path),
        source_kind="notebook",
        state="idle",
    )
    legacy_docx = tmp_path / "legacy.docx"
    legacy_docx.write_bytes(b"legacy-docx")
    monkeypatch.setattr(template_service, "get_template_docx_path", lambda kernel_id: str(legacy_docx))
    monkeypatch.setattr(template_service, "get_template", lambda kernel_id: {"styles": [{"name": "Normal"}]})
    home_compact_store.persist_template_association_for_kernel("kernel-home", template_token="legacy-token")

    inventory = home_compact_store.build_template_inventory(workspace_root)
    entry = next(item for item in inventory["items"] if item["notebook_path"] == str(notebook_path.resolve()))

    assert entry["template_attached"] is True
    assert entry["template_binding_status"] == "available"
    assert entry["template_legacy"] is False
    assert entry["template_token"] == "legacy-token"
    assert entry["template_json_relpath"] == "bound.inspyro-template.json"


@pytest.mark.asyncio
async def test_mcp_bind_template_to_notebook_calls_rest(monkeypatch, tmp_path):
    from mcp_server import activity as mcp_activity

    monkeypatch.setattr(mcp_activity.mcp, "tool", lambda **_kwargs: (lambda fn: fn))
    from mcp_server.tools import templates as mcp_templates

    notebook_path = str(tmp_path / "report.ipynb")
    calls: list[tuple[str, dict | None]] = []

    class FakeBridge:
        async def rest_post(self, path, *, json_data=None):
            calls.append((path, json_data))
            return {
                "binding": {"path": "report.inspyro-template.json"},
                "template_binding": {
                    "status": "bound",
                    "notebook_path": notebook_path,
                    "template": {"file_name": "template.docx"},
                },
                "notebook": _notebook(),
            }

    async def fake_emit_open_resource(*args, **kwargs):
        return None

    async def fake_emit_template_snapshot(*args, **kwargs):
        return None

    monkeypatch.setattr(mcp_templates.InspyroBridge, "get", classmethod(lambda cls: FakeBridge()))
    monkeypatch.setattr(mcp_templates, "emit_open_resource", fake_emit_open_resource)
    monkeypatch.setattr(mcp_templates, "emit_template_snapshot", fake_emit_template_snapshot)

    result = await mcp_templates.bind_template_to_notebook.__wrapped__(
        "kernel-mcp",
        path=notebook_path,
    )

    assert calls == [
        (
            "/api/templates/bind",
            {
                "kernel_id": "kernel-mcp",
                "notebook_path": notebook_path,
            },
        )
    ]
    assert result["status"] == "bound"
    assert result["template_binding"]["status"] == "bound"
