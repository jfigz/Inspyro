from __future__ import annotations

import ast
import re
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Any


@dataclass(frozen=True)
class ContractMeta:
    handler: str
    sync_mode: str


def _extract_name(node: ast.AST | None) -> str | None:
    if isinstance(node, ast.Name):
        return node.id
    if isinstance(node, ast.Attribute):
        parts: list[str] = []
        cursor: ast.AST | None = node
        while isinstance(cursor, ast.Attribute):
            parts.append(cursor.attr)
            cursor = cursor.value
        if isinstance(cursor, ast.Name):
            parts.append(cursor.id)
        parts.reverse()
        return ".".join(parts)
    return None


def _extract_str(node: ast.AST | None) -> str | None:
    if isinstance(node, ast.Constant) and isinstance(node.value, str):
        return node.value
    return None


def _extract_handler_map(dict_node: ast.AST | None) -> dict[str, str]:
    if not isinstance(dict_node, ast.Dict):
        return {}
    contracts: dict[str, str] = {}
    for key_node, value_node in zip(dict_node.keys, dict_node.values):
        key = _extract_str(key_node)
        handler_name = _extract_name(value_node)
        if key and handler_name:
            contracts[key] = handler_name
    return contracts


def _find_assign_value_by_target(fn_node: ast.AsyncFunctionDef, target_name: str) -> ast.AST | None:
    for node in ast.walk(fn_node):
        if not isinstance(node, ast.Assign):
            if isinstance(node, ast.AnnAssign):
                if isinstance(node.target, ast.Name) and node.target.id == target_name:
                    return node.value
            continue
        for target in node.targets:
            if isinstance(target, ast.Name) and target.id == target_name:
                return node.value
    return None


def _extract_inline_msg_types(fn_node: ast.AsyncFunctionDef) -> set[str]:
    inline_types: set[str] = set()
    for node in ast.walk(fn_node):
        if not isinstance(node, ast.Compare):
            continue
        if len(node.ops) != 1 or not isinstance(node.ops[0], ast.Eq):
            continue
        if not isinstance(node.left, ast.Name) or node.left.id != "msg_type":
            continue
        if len(node.comparators) != 1:
            continue
        value = _extract_str(node.comparators[0])
        if value:
            inline_types.add(value)
    return inline_types


def extract_runtime_contracts_from_source(source: str) -> dict[str, ContractMeta]:
    tree = ast.parse(source)
    ws_fn: ast.AsyncFunctionDef | None = None
    for node in tree.body:
        if isinstance(node, ast.AsyncFunctionDef) and node.name == "websocket_endpoint":
            ws_fn = node
            break

    if ws_fn is None:
        raise ValueError("No se encontró 'websocket_endpoint' en backend/main.py")

    direct_dict = _find_assign_value_by_target(ws_fn, "direct_handlers")
    background_dict = _find_assign_value_by_target(ws_fn, "background_handlers")

    direct_handlers = _extract_handler_map(direct_dict)
    background_handlers = _extract_handler_map(background_dict)
    inline_types = _extract_inline_msg_types(ws_fn)

    contracts: dict[str, ContractMeta] = {}
    for name, handler in direct_handlers.items():
        contracts[name] = ContractMeta(handler=handler, sync_mode="direct")
    for name, handler in background_handlers.items():
        contracts[name] = ContractMeta(handler=handler, sync_mode="background")
    for name in sorted(inline_types):
        if name not in contracts:
            contracts[name] = ContractMeta(handler="dispatcher_inline", sync_mode="direct")

    return contracts


_CATALOG_ROW_RE = re.compile(
    r"^\|\s*`(?P<name>[^`]+)`\s*\|\s*(?P<direction>[^|]+)\|\s*(?P<handler>[^|]+)\|\s*(?P<sync>[^|]+)\|"
)


def _normalize_catalog_handler(raw_handler: str) -> str:
    clean = raw_handler.strip().strip("`").strip()
    lower = clean.lower()
    if "in-line" in lower or "in line" in lower:
        return "dispatcher_inline"
    return clean


def _direction_is_client_to_server(direction: str) -> bool:
    compact = direction.replace(" ", "")
    return compact in {"C→S", "C->S"}


def extract_catalog_contracts_from_text(text: str) -> dict[str, ContractMeta]:
    contracts: dict[str, ContractMeta] = {}
    for raw_line in text.splitlines():
        line = raw_line.strip()
        if not line.startswith("| `"):
            continue
        match = _CATALOG_ROW_RE.match(line)
        if not match:
            continue
        if not _direction_is_client_to_server(match.group("direction").strip()):
            continue
        name = match.group("name").strip()
        handler = _normalize_catalog_handler(match.group("handler"))
        sync_mode = match.group("sync").strip().lower()
        if sync_mode not in {"direct", "background"}:
            continue
        contracts[name] = ContractMeta(handler=handler, sync_mode=sync_mode)
    return contracts


_LLM_ITEM_RE = re.compile(r"-\s*\{(?P<body>[^}]*)\}")
_LLM_FIELD_RE = re.compile(r'(?P<key>[a-zA-Z_][a-zA-Z0-9_]*)\s*:\s*"(?P<value>[^"]*)"')


def _parse_inline_yaml_map(body: str) -> dict[str, str]:
    fields: dict[str, str] = {}
    for field in _LLM_FIELD_RE.finditer(body):
        fields[field.group("key")] = field.group("value")
    return fields


def extract_llm_index_contracts_from_text(text: str) -> dict[str, ContractMeta]:
    contracts: dict[str, ContractMeta] = {}
    in_ws_section = False
    for raw_line in text.splitlines():
        line = raw_line.rstrip()
        stripped = line.strip()
        if stripped.startswith("websocket_ws:"):
            in_ws_section = True
            continue
        if in_ws_section and stripped.startswith("websocket_lsp:"):
            break
        if not in_ws_section:
            continue
        item_match = _LLM_ITEM_RE.search(stripped)
        if not item_match:
            continue
        data = _parse_inline_yaml_map(item_match.group("body"))
        direction = data.get("direction", "")
        if direction != "C->S":
            continue
        name = data.get("name")
        handler = data.get("handler")
        sync_mode = data.get("sync_mode", "").lower()
        if not name or not handler or sync_mode not in {"direct", "background"}:
            continue
        contracts[name] = ContractMeta(handler=handler, sync_mode=sync_mode)
    return contracts


def _missing_entries(reference: dict[str, ContractMeta], candidate: dict[str, ContractMeta]) -> list[str]:
    return sorted(set(reference.keys()) - set(candidate.keys()))


def _extra_entries(reference: dict[str, ContractMeta], candidate: dict[str, ContractMeta]) -> list[str]:
    return sorted(set(candidate.keys()) - set(reference.keys()))


def compare_contract_sets(
    runtime_contracts: dict[str, ContractMeta],
    catalog_contracts: dict[str, ContractMeta],
    llm_index_contracts: dict[str, ContractMeta],
) -> list[str]:
    errors: list[str] = []

    missing_in_catalog = _missing_entries(runtime_contracts, catalog_contracts)
    if missing_in_catalog:
        errors.append(f"[catalog] Faltan contratos: {', '.join(missing_in_catalog)}")

    extra_in_catalog = _extra_entries(runtime_contracts, catalog_contracts)
    if extra_in_catalog:
        errors.append(f"[catalog] Contratos extra: {', '.join(extra_in_catalog)}")

    missing_in_index = _missing_entries(runtime_contracts, llm_index_contracts)
    if missing_in_index:
        errors.append(f"[llm-index] Faltan contratos: {', '.join(missing_in_index)}")

    extra_in_index = _extra_entries(runtime_contracts, llm_index_contracts)
    if extra_in_index:
        errors.append(f"[llm-index] Contratos extra: {', '.join(extra_in_index)}")

    for name in sorted(set(runtime_contracts.keys()) & set(catalog_contracts.keys())):
        runtime = runtime_contracts[name]
        catalog = catalog_contracts[name]
        if runtime.handler != catalog.handler:
            errors.append(
                f"[catalog] Handler distinto en '{name}': runtime='{runtime.handler}' vs catalog='{catalog.handler}'"
            )
        if runtime.sync_mode != catalog.sync_mode:
            errors.append(
                f"[catalog] sync_mode distinto en '{name}': runtime='{runtime.sync_mode}' vs catalog='{catalog.sync_mode}'"
            )

    for name in sorted(set(runtime_contracts.keys()) & set(llm_index_contracts.keys())):
        runtime = runtime_contracts[name]
        index = llm_index_contracts[name]
        if runtime.handler != index.handler:
            errors.append(
                f"[llm-index] Handler distinto en '{name}': runtime='{runtime.handler}' vs index='{index.handler}'"
            )
        if runtime.sync_mode != index.sync_mode:
            errors.append(
                f"[llm-index] sync_mode distinto en '{name}': runtime='{runtime.sync_mode}' vs index='{index.sync_mode}'"
            )

    return errors


def run_contract_sync_check(
    main_path: Path,
    contracts_catalog_path: Path,
    llm_index_path: Path,
) -> list[str]:
    runtime_contracts = extract_runtime_contracts_from_source(main_path.read_text(encoding="utf-8"))
    catalog_contracts = extract_catalog_contracts_from_text(contracts_catalog_path.read_text(encoding="utf-8"))
    llm_index_contracts = extract_llm_index_contracts_from_text(llm_index_path.read_text(encoding="utf-8"))
    return compare_contract_sets(runtime_contracts, catalog_contracts, llm_index_contracts)


def _default_paths() -> tuple[Path, Path, Path]:
    repo_root = Path(__file__).resolve().parents[2]
    return (
        repo_root / "backend" / "main.py",
        repo_root / "docs" / "architecture" / "contracts-catalog.md",
        repo_root / "docs" / "llm-index.yaml",
    )


def main(argv: list[str] | None = None) -> int:
    main_path, catalog_path, index_path = _default_paths()
    errors = run_contract_sync_check(main_path, catalog_path, index_path)
    if errors:
        print("[contracts-check] FAILED")
        for err in errors:
            print(f" - {err}")
        return 1
    print("[contracts-check] OK - runtime y documentación sincronizados")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
