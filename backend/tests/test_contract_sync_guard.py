import importlib.util
import sys
from pathlib import Path


def _load_contract_checker():
    repo_root = Path(__file__).resolve().parents[2]
    checker_path = repo_root / "docs" / "tools" / "check_contract_sync.py"
    spec = importlib.util.spec_from_file_location("check_contract_sync", checker_path)
    module = importlib.util.module_from_spec(spec)
    assert spec is not None and spec.loader is not None
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


def test_extract_runtime_contracts_includes_direct_background_and_inline():
    checker = _load_contract_checker()
    source = """
async def websocket_endpoint(websocket):
    direct_handlers = {
        "notebook_create": handle_notebook_create,
    }
    background_handlers = {
        "template_preview_style": handle_template_preview_style,
    }
    while True:
        msg_type = "noop"
        if msg_type == "clear_mdoc":
            pass
        elif msg_type == "ping":
            pass
"""
    contracts = checker.extract_runtime_contracts_from_source(source)
    assert contracts["notebook_create"].handler == "handle_notebook_create"
    assert contracts["notebook_create"].sync_mode == "direct"
    assert contracts["template_preview_style"].handler == "handle_template_preview_style"
    assert contracts["template_preview_style"].sync_mode == "background"
    assert contracts["clear_mdoc"].handler == "dispatcher_inline"
    assert contracts["clear_mdoc"].sync_mode == "direct"
    assert contracts["ping"].handler == "dispatcher_inline"
    assert contracts["ping"].sync_mode == "direct"


def test_compare_contract_sets_detects_missing_contracts():
    checker = _load_contract_checker()
    runtime = {
        "ping": checker.ContractMeta(handler="dispatcher_inline", sync_mode="direct"),
        "notebook_create": checker.ContractMeta(handler="handle_notebook_create", sync_mode="direct"),
    }
    catalog = {
        "ping": checker.ContractMeta(handler="dispatcher_inline", sync_mode="direct"),
    }
    llm_index = dict(catalog)
    errors = checker.compare_contract_sets(runtime, catalog, llm_index)
    assert any("Faltan contratos" in err and "notebook_create" in err for err in errors)


def test_compare_contract_sets_detects_sync_mode_drift():
    checker = _load_contract_checker()
    runtime = {
        "template_preview_style": checker.ContractMeta(
            handler="handle_template_preview_style",
            sync_mode="background",
        )
    }
    catalog = {
        "template_preview_style": checker.ContractMeta(
            handler="handle_template_preview_style",
            sync_mode="direct",
        )
    }
    llm_index = {
        "template_preview_style": checker.ContractMeta(
            handler="handle_template_preview_style",
            sync_mode="direct",
        )
    }
    errors = checker.compare_contract_sets(runtime, catalog, llm_index)
    assert any("sync_mode distinto" in err for err in errors)


def test_repository_contracts_are_in_sync():
    checker = _load_contract_checker()
    repo_root = Path(__file__).resolve().parents[2]
    errors = checker.run_contract_sync_check(
        repo_root / "backend" / "main.py",
        repo_root / "docs" / "architecture" / "contracts-catalog.md",
        repo_root / "docs" / "llm-index.yaml",
    )
    assert errors == []
