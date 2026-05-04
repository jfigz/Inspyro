"""Exhaustive MCP torture probe for Inspyro.

This probe talks to the live MCP HTTP endpoint, not to in-process wrappers.
It exercises the full public MCP surface around a notebook-first workflow and
emits `report.json` plus `report.md` inside a disposable workspace.
"""

from __future__ import annotations

import argparse
import asyncio
import hashlib
import json
import os
import re
import tempfile
import traceback
import zipfile
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Optional
from urllib.parse import quote

import httpx

from dev.mcp_live_client import LiveMcpClient, McpRpcError
from dev.mcp_torture_assets import (
    AUXILIARY_LOADS,
    AUXILIARY_SECTIONS_CSV,
    PRIMARY_NOTEBOOK_ANALYSIS_CELL_ID,
    PRIMARY_NOTEBOOK_BOOTSTRAP_CELL_ID,
    PRIMARY_NOTEBOOK_DOC_CELL_IDS,
    PRIMARY_NOTEBOOK_LONG_CELL_ID,
    PRIMARY_NOTEBOOK_NAME,
    PRIMARY_NOTEBOOK_SPEC,
    PROFILE_TOOLSETS,
    PROMPT_COVERAGE_MATRIX,
    PUBLIC_PROMPT_NAMES,
    PUBLIC_RESOURCE_TEMPLATE_URIS,
    PUBLIC_RESOURCE_URIS,
    RESOURCE_COVERAGE_MATRIX,
    RESOURCE_TEMPLATE_COVERAGE_MATRIX,
    SECONDARY_NOTEBOOK_CODE_CELL_ID,
    SECONDARY_NOTEBOOK_NAME,
    SECONDARY_NOTEBOOK_SPEC,
    TEMPLATE_FIXTURE_RELATIVE,
    TOOL_COVERAGE_MATRIX,
    build_mutated_primary_spec,
    clone_notebook_spec,
    ensure_template_fixture,
)

LONG_TOOL_TIMEOUT_S = 600


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def _json_dumps(payload: Any) -> str:
    return json.dumps(payload, indent=2, ensure_ascii=False, sort_keys=True)


def _sha256_bytes(content: bytes) -> str:
    return hashlib.sha256(content).hexdigest()


def _path_to_uri_fragment(path: str) -> str:
    return quote(str(path).replace("\\", "/"), safe="/")


def _build_resource_uri(template_uri: str, **values: str) -> str:
    uri = template_uri
    for key, value in values.items():
        encoded = _path_to_uri_fragment(value)
        uri = uri.replace(f"{{{key}}}", encoded).replace(f"{{{key}*}}", encoded)
    return uri


def _message_text(messages: list[dict[str, Any]]) -> str:
    parts: list[str] = []
    for message in messages:
        content = message.get("content") if isinstance(message, dict) else None
        if isinstance(content, dict) and content.get("text"):
            parts.append(str(content["text"]))
    return "\n".join(parts)


def _contents_text(contents: list[dict[str, Any]]) -> str:
    parts: list[str] = []
    for item in contents:
        if isinstance(item, dict) and item.get("text"):
            parts.append(str(item["text"]))
    return "\n".join(parts)


def _contents_bytes(contents: list[dict[str, Any]]) -> bytes:
    for item in contents:
        if not isinstance(item, dict):
            continue
        blob = item.get("blob")
        if blob:
            import base64

            return base64.b64decode(blob)
        text = item.get("text")
        if text:
            return str(text).encode("utf-8")
    return b""


def _tool_content_text(result: dict[str, Any]) -> str:
    content = result.get("content")
    if not isinstance(content, list):
        return ""
    parts: list[str] = []
    for item in content:
        if isinstance(item, dict) and item.get("text"):
            parts.append(str(item["text"]))
    return "\n".join(parts)


def _tool_structured(result: dict[str, Any]) -> dict[str, Any]:
    structured = result.get("structuredContent")
    if isinstance(structured, dict) and structured:
        return structured
    text = _tool_content_text(result).strip()
    if text.startswith("{") or text.startswith("["):
        try:
            parsed = json.loads(text)
        except json.JSONDecodeError:
            return {}
        if isinstance(parsed, dict):
            return parsed
    return structured if isinstance(structured, dict) else {}


def _extract_rpc_error_code(exc: McpRpcError) -> str | None:
    data = exc.data
    candidates = [
        data.get("error_code"),
        (data.get("payload") or {}).get("error_code") if isinstance(data.get("payload"), dict) else None,
        (data.get("details") or {}).get("error_code") if isinstance(data.get("details"), dict) else None,
        (data.get("raw") or {}).get("error_code") if isinstance(data.get("raw"), dict) else None,
    ]
    for candidate in candidates:
        if candidate:
            return str(candidate)
    serialized = _json_dumps(exc.error)
    match = re.search(r"NOTEBOOK_PATH_REQUIRES_NOTEBOOK_TOOL|[A-Z_]{4,}", serialized)
    if match:
        return match.group(0)
    return None


def _assert(condition: bool, message: str) -> None:
    if not condition:
        raise AssertionError(message)


def _count_pdf_pages(pdf_bytes: bytes) -> int:
    matches = re.findall(br"/Type\s*/Page\b", pdf_bytes)
    return len(matches)


def _load_notebook(path: Path) -> dict[str, Any]:
    return json.loads(path.read_text(encoding="utf-8"))


def _cell_outputs(cell: dict[str, Any]) -> list[Any]:
    outputs = cell.get("outputs")
    return outputs if isinstance(outputs, list) else []


def _docx_xml_map(docx_path: Path) -> dict[str, bytes]:
    with zipfile.ZipFile(docx_path, "r") as archive:
        return {name: archive.read(name) for name in archive.namelist()}


def _parse_docx_assertions(docx_path: Path) -> dict[str, Any]:
    parts = _docx_xml_map(docx_path)
    document_xml = parts.get("word/document.xml", b"").decode("utf-8", errors="replace")
    styles_xml = parts.get("word/styles.xml", b"").decode("utf-8", errors="replace")
    header_xml = "\n".join(
        parts[name].decode("utf-8", errors="replace")
        for name in parts
        if name.startswith("word/header")
    )
    footer_xml = "\n".join(
        parts[name].decode("utf-8", errors="replace")
        for name in parts
        if name.startswith("word/footer")
    )
    media_files = sorted(name for name in parts if name.startswith("word/media/"))
    return {
        "has_toc_field": "TOC " in document_xml,
        "has_math": "<m:oMath" in document_xml or "<m:oMathPara" in document_xml,
        "has_seq_figure": "SEQ Figura" in document_xml,
        "has_seq_table": "SEQ Tabla" in document_xml,
        "has_reference_field": "REF " in document_xml or "PAGEREF " in document_xml,
        "has_media": bool(media_files),
        "media_files": media_files,
        "heading_text_present": "MCP Torture Report" in document_xml,
        "header_text": header_xml,
        "footer_text": footer_xml,
        "styles_xml": styles_xml,
        "document_xml": document_xml,
    }


@dataclass(slots=True)
class ProbeFailure:
    phase: str
    step: str
    message: str
    expected: bool
    details: dict[str, Any] = field(default_factory=dict)


@dataclass(slots=True)
class McpToolCallError(RuntimeError):
    tool_name: str
    result: dict[str, Any]

    def __post_init__(self) -> None:
        RuntimeError.__init__(self, _tool_content_text(self.result) or f"Tool {self.tool_name} returned isError=true")


class McpTortureProbe:
    def __init__(
        self,
        *,
        mcp_url: str,
        backend_url: str,
        workspace_root: Path,
        keep_artifacts: bool,
    ) -> None:
        self.mcp_url = mcp_url
        self.backend_url = backend_url.rstrip("/")
        self.workspace_root = workspace_root
        self.keep_artifacts = keep_artifacts
        self.evidence_dir = self.workspace_root / "evidence"
        self.exports_dir = self.workspace_root / "exports"
        self.inputs_dir = self.workspace_root / "inputs"
        self.scratch_dir = self.workspace_root / "scratch"
        self.outputs_dir = self.workspace_root / "outputs"
        self.report_path = self.evidence_dir / "report.json"
        self.report_md_path = self.evidence_dir / "report.md"

        self.client: Optional[LiveMcpClient] = None
        self.http = httpx.AsyncClient(follow_redirects=True)
        self.baseline_activity: dict[str, Any] = {}
        self.failures: list[ProbeFailure] = []
        self.phase_timings: list[dict[str, Any]] = []
        self.artifacts: dict[str, Any] = {}
        self.runtime: dict[str, Any] = {}

        self.coverage = {
            "tools": {
                name: {"covered": False, **meta, "evidence": []}
                for name, meta in TOOL_COVERAGE_MATRIX.items()
            },
            "resources": {
                name: {"covered": False, **meta, "evidence": []}
                for name, meta in RESOURCE_COVERAGE_MATRIX.items()
            },
            "resource_templates": {
                name: {"covered": False, **meta, "evidence": []}
                for name, meta in RESOURCE_TEMPLATE_COVERAGE_MATRIX.items()
            },
            "prompts": {
                name: {"covered": False, **meta, "evidence": []}
                for name, meta in PROMPT_COVERAGE_MATRIX.items()
            },
        }
        self.report: dict[str, Any] = {
            "started_at": _now_iso(),
            "mcp_url": self.mcp_url,
            "backend_url": self.backend_url,
            "workspace_root": str(self.workspace_root),
            "phases": [],
            "artifacts": self.artifacts,
            "coverage": self.coverage,
            "expected_failures": [],
            "unexpected_failures": [],
        }

    async def close(self) -> None:
        if self.client is not None:
            await self.client.close()
        await self.http.aclose()

    def _mark(self, category: str, name: str, evidence: dict[str, Any]) -> None:
        bucket = self.coverage[category][name]
        bucket["covered"] = True
        bucket["evidence"].append(evidence)

    def _record_failure(
        self,
        phase: str,
        step: str,
        exc: Exception | str,
        *,
        expected: bool = False,
        details: Optional[dict[str, Any]] = None,
    ) -> None:
        if isinstance(exc, Exception):
            message = str(exc)
            extra = {
                "exception_type": type(exc).__name__,
                "traceback": "".join(traceback.format_exception(exc)),
            }
        else:
            message = str(exc)
            extra = {}
        if details:
            extra.update(details)
        failure = ProbeFailure(phase=phase, step=step, message=message, expected=expected, details=extra)
        self.failures.append(failure)
        target = "expected_failures" if expected else "unexpected_failures"
        self.report[target].append(
            {
                "phase": phase,
                "step": step,
                "message": message,
                "details": extra,
            }
        )

    def _soft_check(self, phase: str, step: str, condition: bool, message: str) -> bool:
        if condition:
            return True
        self._record_failure(phase, step, message, expected=False)
        return False

    async def _tool(self, name: str, arguments: Optional[dict[str, Any]] = None, *, timeout_s: Optional[int] = None) -> dict[str, Any]:
        _assert(self.client is not None, "MCP client is not initialized.")
        result = await self.client.call_tool(name, arguments or {}, timeout_s=timeout_s)
        if bool(result.get("isError")):
            raise McpToolCallError(tool_name=name, result=result)
        return result

    async def _tool_structured(
        self,
        name: str,
        arguments: Optional[dict[str, Any]] = None,
        *,
        timeout_s: Optional[int] = None,
        evidence: Optional[dict[str, Any]] = None,
    ) -> dict[str, Any]:
        result = await self._tool(name, arguments, timeout_s=timeout_s)
        structured = _tool_structured(result)
        self._mark("tools", name, evidence or {"arguments": arguments or {}, "status": structured.get("status")})
        return structured

    async def _expect_tool_error(
        self,
        phase: str,
        name: str,
        arguments: dict[str, Any],
        *,
        expected_code: str,
    ) -> str:
        try:
            await self._tool(name, arguments)
        except McpRpcError as exc:
            error_code = _extract_rpc_error_code(exc)
            _assert(
                error_code == expected_code,
                f"{name} returned unexpected error code {error_code!r}, expected {expected_code!r}",
            )
            self._mark(
                "tools",
                name,
                {"arguments": arguments, "expected_error_code": error_code},
            )
            self._record_failure(
                phase,
                f"{name} expected failure",
                exc,
                expected=True,
                details={"expected_error_code": expected_code},
            )
            return error_code
        except McpToolCallError as exc:
            text = _tool_content_text(exc.result)
            acceptable_signals = [expected_code]
            if expected_code == "NOTEBOOK_PATH_REQUIRES_NOTEBOOK_TOOL":
                acceptable_signals.extend(
                    [
                        "notebooks `.ipynb`",
                        "notebook_load",
                        "notebook_sync_cells",
                        "notebook_save",
                    ]
                )
            _assert(
                any(signal in text for signal in acceptable_signals),
                f"{name} returned unexpected tool error payload: {text!r}",
            )
            self._mark(
                "tools",
                name,
                {"arguments": arguments, "expected_error_code": expected_code, "content": text},
            )
            self._record_failure(
                phase,
                f"{name} expected failure",
                exc,
                expected=True,
                details={"expected_error_code": expected_code},
            )
            return expected_code
        raise AssertionError(f"{name} should have failed with {expected_code}.")

    async def _read_resource(self, uri: str) -> list[dict[str, Any]]:
        _assert(self.client is not None, "MCP client is not initialized.")
        contents = await self.client.read_resource(uri)
        self._mark("resources", uri, {"content_count": len(contents)})
        return contents

    async def _read_resource_template(self, template_uri: str, **kwargs: str) -> list[dict[str, Any]]:
        uri = _build_resource_uri(template_uri, **kwargs)
        _assert(self.client is not None, "MCP client is not initialized.")
        contents = await self.client.read_resource(uri)
        self._mark(
            "resource_templates",
            template_uri,
            {"uri": uri, "content_count": len(contents)},
        )
        if self.keep_artifacts:
            output_name = hashlib.sha1(uri.encode("utf-8")).hexdigest()[:12] + ".bin"
            (self.evidence_dir / "resources").mkdir(parents=True, exist_ok=True)
            (self.evidence_dir / "resources" / output_name).write_bytes(_contents_bytes(contents))
        return contents

    async def _get_prompt(self, name: str, arguments: Optional[dict[str, Any]] = None) -> list[dict[str, Any]]:
        _assert(self.client is not None, "MCP client is not initialized.")
        messages = await self.client.get_prompt(name, arguments or {})
        self._mark("prompts", name, {"message_count": len(messages), "arguments": arguments or {}})
        return messages

    async def _complete(self, ref: dict[str, Any], argument: dict[str, Any], context: Optional[dict[str, Any]] = None) -> list[str]:
        _assert(self.client is not None, "MCP client is not initialized.")
        return await self.client.complete(ref, argument, context)

    async def _activity_snapshot(self) -> dict[str, Any]:
        response = await self.http.get(f"{self.backend_url}/api/mcp/activity", params={"limit": 300}, timeout=20)
        response.raise_for_status()
        return response.json()

    async def _backend_health(self) -> dict[str, Any]:
        response = await self.http.get(f"{self.backend_url}/health", timeout=10)
        response.raise_for_status()
        return response.json()

    @staticmethod
    def _fallback_analysis_inputs() -> dict[str, Any]:
        span_m = 8.0
        section_b_m = 0.45
        section_h_m = 0.80
        fy_MPa = 420.0
        E_MPa = 200000.0
        density_kN_m3 = 7850.0 * 9.80665 / 1000.0
        governing_case = max(
            AUXILIARY_LOADS["cases"],
            key=lambda case: float(case["w_kN_m"]) * span_m**2 / 8.0 * float(case.get("dynamic_factor", 1.0)),
        )
        analysis_formulas = {
            "M_max_kNm": "w_kN_m * span_m**2 / 8.0 * dynamic_factor",
            "V_max_kN": "w_kN_m * span_m / 2.0",
            "sigma_MPa": "(M_max_kNm * 1000.0) / ((section_b_m * section_h_m**2 / 6.0) * 1_000_000.0)",
            "dcr": "sigma_MPa / (0.9 * fy_MPa)",
            "deflection_mm": "5.0 * (w_kN_m * 1000.0) * span_m**4 / (384.0 * (E_MPa * 1_000_000.0) * (section_b_m * section_h_m**3 / 12.0)) * 1000.0",
            "weight_proxy": "section_b_m * section_h_m * span_m * density_kN_m3",
        }
        analysis_current_values = {
            "w_kN_m": float(governing_case["w_kN_m"]),
            "dynamic_factor": float(governing_case["dynamic_factor"]),
            "span_m": span_m,
            "section_b_m": section_b_m,
            "section_h_m": section_h_m,
            "fy_MPa": fy_MPa,
            "E_MPa": E_MPa,
            "density_kN_m3": density_kN_m3,
        }
        return {
            "analysis_formulas": analysis_formulas,
            "analysis_current_values": analysis_current_values,
            "analysis_checks": [
                {"name": "stress_limit", "lhs": "sigma_MPa", "op": "<=", "rhs": 0.66 * fy_MPa},
                {"name": "dcr_limit", "lhs": "dcr", "op": "<=", "rhs": 1.0},
                {"name": "deflection_limit", "lhs": "deflection_mm", "op": "<=", "rhs": span_m * 1000.0 / 360.0},
            ],
            "analysis_objective": {
                "targets": [
                    {"name": "weight_proxy", "goal": "min", "weight": 1.0},
                    {"name": "dcr", "goal": "target", "target": 0.90, "weight": 0.4},
                ]
            },
            "analysis_variables": [
                {"name": "section_b_m", "min": 0.30, "max": 0.55, "initial": section_b_m},
                {"name": "section_h_m", "min": 0.60, "max": 0.90, "initial": section_h_m},
            ],
            "analysis_constraints": [
                {"name": "stress_ok", "lhs": "sigma_MPa", "op": "<=", "rhs": 0.66 * fy_MPa},
                {"name": "dcr_ok", "lhs": "dcr", "op": "<=", "rhs": 1.0},
            ],
            "analysis_outputs": ["M_max_kNm", "sigma_MPa", "dcr", "deflection_mm"],
            "analysis_baseline": {"name": "baseline", "values": {"w_kN_m": float(governing_case["w_kN_m"])}},
            "analysis_candidates": [
                {"name": "plus_5", "values": {"w_kN_m": float(governing_case["w_kN_m"]) * 1.05}},
                {"name": "minus_5", "values": {"w_kN_m": float(governing_case["w_kN_m"]) * 0.95}},
            ],
        }

    async def run(self) -> int:
        self.workspace_root.mkdir(parents=True, exist_ok=True)
        self.evidence_dir.mkdir(parents=True, exist_ok=True)

        health = await self._backend_health()
        _assert(health.get("status") == "healthy", f"Backend health is not healthy: {health!r}")
        self.baseline_activity = await self._activity_snapshot()

        self.client = LiveMcpClient(
            self.mcp_url,
            default_timeout_s=LONG_TOOL_TIMEOUT_S,
            default_call_timeout_s=LONG_TOOL_TIMEOUT_S,
        )
        await self.client.initialize()

        try:
            await self._run_phase("discovery", self._phase_discovery)
            await self._run_phase("files", self._phase_files)
            await self._run_phase("authoring", self._phase_authoring)
            await self._run_phase("units", self._phase_units)
            await self._run_phase("templates", self._phase_templates)
            await self._run_phase("documents", self._phase_documents)
            await self._run_phase("analysis", self._phase_analysis)
            await self._run_phase("admin", self._phase_admin)
            await self._run_phase("stress", self._phase_stress)
            await self._run_phase("report_validation", self._phase_report_validation)
        finally:
            self.report["finished_at"] = _now_iso()
            try:
                await self._finalize_activity_report()
            except Exception as exc:
                self._record_failure("finalization", "activity_report", exc, expected=False)
            try:
                self._finalize_coverage()
            except Exception as exc:
                self._record_failure("finalization", "coverage", exc, expected=False)
            try:
                self._write_report_files()
            except Exception as exc:
                self._record_failure("finalization", "write_report_files", exc, expected=False)
            await self.close()

        return 1 if self.report["unexpected_failures"] else 0

    async def _run_phase(self, name: str, phase_func) -> None:
        started = datetime.now(timezone.utc)
        status = "ok"
        try:
            await phase_func()
        except Exception as exc:
            status = "failed"
            self._record_failure(name, f"{name} phase", exc, expected=False)
        finished = datetime.now(timezone.utc)
        phase_entry = {
            "phase": name,
            "status": status,
            "started_at": started.isoformat().replace("+00:00", "Z"),
            "finished_at": finished.isoformat().replace("+00:00", "Z"),
            "duration_ms": int((finished - started).total_seconds() * 1000),
        }
        self.phase_timings.append(phase_entry)
        self.report["phases"].append(phase_entry)

    async def _phase_discovery(self) -> None:
        _assert(self.client is not None, "MCP client is not initialized.")

        tools = await self.client.list_tools()
        resources = await self.client.list_resources()
        templates = await self.client.list_resource_templates()
        prompts = await self.client.list_prompts()

        tool_names = {str(tool.get("name")) for tool in tools}
        resource_uris = {str(resource.get("uri")) for resource in resources}
        template_uris = {str(template.get("uriTemplate")) for template in templates}
        prompt_names = {str(prompt.get("name")) for prompt in prompts}

        _assert(tool_names == PROFILE_TOOLSETS["authoring"], "Default tool surface is not authoring.")
        _assert(resource_uris == set(PUBLIC_RESOURCE_URIS), "Resource catalog drift detected.")
        _assert(template_uris == set(PUBLIC_RESOURCE_TEMPLATE_URIS), "Resource template catalog drift detected.")
        _assert(prompt_names == set(PUBLIC_PROMPT_NAMES), "Prompt catalog drift detected.")

        for resource_uri in PUBLIC_RESOURCE_URIS:
            contents = await self._read_resource(resource_uri)
            _assert(contents, f"Resource {resource_uri} returned no content.")

        manifest_text = _contents_text(await self._read_resource("inspyro://manifest"))
        start_here_text = _contents_text(await self._read_resource("inspyro://guides/start-here"))
        _assert("authoring" in manifest_text and "resource_templates" in manifest_text, "Manifest missing core guidance.")
        _assert("notebook_sync_cells" in start_here_text, "Start-here guide does not promote notebook_sync_cells.")

        info = await self._tool_structured("get_system_info")
        health = await self._tool_structured("get_health")
        profiles = await self._tool_structured("list_component_profiles")
        _assert(info.get("workspace_path"), "get_system_info did not return workspace_path.")
        _assert(health.get("status") == "healthy", "get_health did not report healthy backend.")
        _assert(set(profiles.get("available_profiles", [])) == set(PROFILE_TOOLSETS), "Profile list drift detected.")

        prompt_text = _message_text(
            await self._get_prompt(
                "start_inspyro_session",
                {
                    "goal": "exhaustive MCP torture run",
                    "deliverable": "report.json and report.md",
                },
            )
        )
        self._soft_check(
            "discovery",
            "start_inspyro_session prompt",
            "inspyro://guides/start-here" in prompt_text,
            "start_inspyro_session prompt is missing onboarding links.",
        )

        for profile_name, expected_names in PROFILE_TOOLSETS.items():
            result = await self._tool_structured("set_component_profile", {"profile": profile_name})
            _assert(result.get("status") in {"ok", "unsupported"}, f"set_component_profile({profile_name}) failed.")
            listed = {str(tool.get("name")) for tool in await self.client.list_tools()}
            _assert(listed == expected_names, f"Profile {profile_name} exposed unexpected tools: {listed}")

        await self._tool_structured("set_component_profile", {"profile": "authoring"})

    async def _phase_files(self) -> None:
        workspace_str = str(self.workspace_root)
        await self._tool_structured("set_component_profile", {"profile": "files"})

        list_payload = await self._tool_structured("list_files", {"path": workspace_str, "depth": 4})
        _assert("children" in list_payload, "list_files did not return workspace tree.")

        await self._tool_structured("create_file", {"path": str(self.inputs_dir), "is_directory": True})
        await self._tool_structured("create_file", {"path": str(self.exports_dir), "is_directory": True})
        await self._tool_structured("create_file", {"path": str(self.outputs_dir), "is_directory": True})
        await self._tool_structured("create_file", {"path": str(self.scratch_dir), "is_directory": True})
        await self._tool_structured("create_file", {"path": str(self.scratch_dir / "note.txt"), "is_directory": False})

        await self._tool_structured(
            "write_file",
            {"path": str(self.inputs_dir / "loads.json"), "content": _json_dumps(AUXILIARY_LOADS)},
        )
        await self._tool_structured(
            "write_file",
            {"path": str(self.inputs_dir / "sections.csv"), "content": AUXILIARY_SECTIONS_CSV + "\n"},
        )
        await self._tool_structured(
            "write_file",
            {"path": str(self.scratch_dir / "note.txt"), "content": "temporary scratch note\n"},
        )
        await self._tool_structured(
            "rename_file",
            {
                "old_path": str(self.scratch_dir / "note.txt"),
                "new_path": str(self.scratch_dir / "note_renamed.txt"),
            },
        )
        note_payload = await self._tool_structured("read_file", {"path": str(self.scratch_dir / "note_renamed.txt")})
        _assert("temporary scratch note" in str(note_payload.get("content", "")), "Scratch file content mismatch.")
        await self._tool_structured("delete_file", {"path": str(self.scratch_dir / "note_renamed.txt")})

        notebook_file = self.scratch_dir / "generic_notebook.ipynb"
        notebook_renamed = self.scratch_dir / "generic_notebook_renamed.ipynb"
        await self._tool_structured("create_file", {"path": str(notebook_file), "is_directory": False})
        await self._tool_structured(
            "write_file",
            {
                "path": str(notebook_file),
                "content": json.dumps(
                    {"cells": [], "metadata": {}, "nbformat": 4, "nbformat_minor": 5},
                    ensure_ascii=False,
                ),
            },
        )
        notebook_payload = await self._tool_structured("read_file", {"path": str(notebook_file)})
        notebook_content = notebook_payload.get("content", "")
        if isinstance(notebook_content, dict):
            _assert(notebook_content.get("nbformat") == 4, "Notebook file content mismatch through file tools.")
        else:
            _assert('"nbformat"' in str(notebook_content), "Notebook file content mismatch through file tools.")
        await self._tool_structured(
            "rename_file",
            {"old_path": str(notebook_file), "new_path": str(notebook_renamed)},
        )
        await self._tool_structured("delete_file", {"path": str(notebook_renamed)})

        tree_contents = await self._read_resource_template(
            "inspyro://workspace/tree/{path*}",
            path=workspace_str,
        )
        file_contents = await self._read_resource_template(
            "inspyro://workspace/file/{path*}",
            path=str(self.inputs_dir / "loads.json"),
        )
        _assert("loads.json" in _contents_text(tree_contents), "Workspace tree template did not expose loads.json.")
        _assert("beam_name" in _contents_text(file_contents), "Workspace file template did not expose loads.json content.")

        await self._tool_structured("set_component_profile", {"profile": "authoring"})

    async def _phase_authoring(self) -> None:
        created = await self._tool_structured(
            "notebook_create",
            {"path": str(self.workspace_root), "name": PRIMARY_NOTEBOOK_NAME},
        )
        primary_notebook_path = Path(str(created["path"]))
        created_primary_kernel_id = str(created["kernel_id"])
        self.runtime["primary_notebook_path"] = str(primary_notebook_path)
        self.runtime["created_primary_kernel_id"] = created_primary_kernel_id

        sync_payload = await self._tool_structured(
            "notebook_sync_cells",
            {
                "notebook_path": str(primary_notebook_path),
                "cells": clone_notebook_spec(PRIMARY_NOTEBOOK_SPEC),
            },
        )
        _assert(sync_payload.get("cell_count") == len(PRIMARY_NOTEBOOK_SPEC), "Primary notebook sync count mismatch.")

        secondary_created = await self._tool_structured(
            "notebook_create",
            {
                "path": str(self.workspace_root),
                "name": SECONDARY_NOTEBOOK_NAME,
                "cells": clone_notebook_spec(SECONDARY_NOTEBOOK_SPEC),
            },
        )
        self.runtime["secondary_notebook_path"] = str(secondary_created["path"])
        self.runtime["secondary_kernel_id"] = str(secondary_created["kernel_id"])

        loaded = await self._tool_structured(
            "notebook_load",
            {"path": str(primary_notebook_path), "include_source": True},
        )
        loaded_cell_ids = [str(cell.get("id")) for cell in loaded.get("cells", [])]
        expected_ids = [cell["cell_id"] for cell in PRIMARY_NOTEBOOK_SPEC]
        _assert(loaded_cell_ids == expected_ids, "notebook_load did not preserve canonical cell ids.")
        primary_kernel_id = str(loaded["kernel_id"])
        self.runtime["primary_kernel_id"] = primary_kernel_id
        self.runtime["validation_kernel_id"] = primary_kernel_id

        session_notebooks = await self._tool_structured("list_session_notebooks")
        live_kernel_ids = {str(item.get("kernel_id")) for item in session_notebooks.get("notebooks", [])}
        _assert(
            {primary_kernel_id, self.runtime["secondary_kernel_id"]}.issubset(live_kernel_ids),
            "list_session_notebooks did not expose both live notebooks in the current session.",
        )
        kernel_status = await self._tool_structured("get_kernel_status", {"kernel_id": primary_kernel_id})
        _assert(kernel_status.get("state") in {"idle", "running"}, "get_kernel_status did not return a live kernel state.")

        cell_contents = await self._read_resource_template(
            "inspyro://notebooks/{path*}/cells/{cell_id}",
            path=str(primary_notebook_path),
            cell_id=PRIMARY_NOTEBOOK_ANALYSIS_CELL_ID,
        )
        _assert("analysis_formulas" in _contents_text(cell_contents), "Notebook cell template did not expose source.")
        listed_cells = await self._tool_structured(
            "list_cells",
            {"notebook_path": str(primary_notebook_path), "max_cells": 4},
        )
        _assert(int(listed_cells.get("cell_count") or 0) >= 4, "list_cells did not expose the expected notebook rows.")
        exact_cell = await self._tool_structured(
            "get_cell",
            {"notebook_path": str(primary_notebook_path), "cell_id": PRIMARY_NOTEBOOK_ANALYSIS_CELL_ID},
        )
        _assert(
            "analysis_formulas" in str(((exact_cell.get("cell") or {}).get("source") or "")),
            "get_cell did not expose the full analysis source.",
        )
        notebook_search = await self._tool_structured(
            "find_in_notebook",
            {"notebook_path": str(primary_notebook_path), "pattern": "analysis_formulas"},
        )
        _assert(int(notebook_search.get("match_count") or 0) >= 1, "find_in_notebook did not find the expected analysis marker.")

        notebook_path_completions = await self._complete(
            {"type": "ref/prompt", "name": "review_notebook"},
            {"name": "notebook_path", "value": "mcp_torture"},
        )
        self._soft_check(
            "authoring",
            "notebook_path completion",
            any(value.endswith(PRIMARY_NOTEBOOK_NAME) for value in notebook_path_completions),
            "Notebook completion did not suggest primary notebook.",
        )
        create_prompt = _message_text(
            await self._get_prompt(
                "create_engineering_notebook",
                {
                    "topic": "mcp torture notebook",
                    "description": "Ejecutar notebook-first con reportes DOCX, analysis y recovery.",
                },
            )
        )
        _assert("notebook_sync_cells" in create_prompt and "execute_all_cells" in create_prompt, "create_engineering_notebook prompt is missing notebook guidance.")

        bootstrap_result = await self._tool_structured(
            "execute_cell",
            {"kernel_id": primary_kernel_id, "cell_id": PRIMARY_NOTEBOOK_BOOTSTRAP_CELL_ID},
            timeout_s=LONG_TOOL_TIMEOUT_S,
            evidence={"cell_id": PRIMARY_NOTEBOOK_BOOTSTRAP_CELL_ID, "mode": "persisted_source"},
        )
        _assert(bootstrap_result.get("status") == "executed", "execute_cell on persisted bootstrap cell failed.")

        batch_result = await self._tool_structured(
            "execute_all_cells",
            {
                "kernel_id": primary_kernel_id,
                "notebook_path": str(primary_notebook_path),
                "include_outputs": False,
                "include_variables": False,
            },
            timeout_s=LONG_TOOL_TIMEOUT_S,
            evidence={"notebook_path": str(primary_notebook_path), "mode": "full_batch"},
        )
        _assert(batch_result.get("status") == "completed", f"execute_all_cells failed: {batch_result!r}")
        self.runtime["primary_execution_id"] = str(batch_result.get("execution_id"))

        secondary_loaded = await self._tool_structured(
            "notebook_load",
            {"path": self.runtime["secondary_notebook_path"]},
        )
        self.runtime["secondary_kernel_id"] = str(secondary_loaded["kernel_id"])

        secondary_quick = await self._tool_structured(
            "execute_cell",
            {"kernel_id": self.runtime["secondary_kernel_id"], "cell_id": SECONDARY_NOTEBOOK_CODE_CELL_ID},
            timeout_s=LONG_TOOL_TIMEOUT_S,
            evidence={"cell_id": SECONDARY_NOTEBOOK_CODE_CELL_ID, "mode": "secondary_quick"},
        )
        _assert(secondary_quick.get("status") == "executed", "Secondary quick execute_cell failed.")
        secondary_background = await self._tool_structured(
            "execute_all_cells",
            {
                "kernel_id": self.runtime["secondary_kernel_id"],
                "notebook_path": self.runtime["secondary_notebook_path"],
                "background": True,
            },
            timeout_s=LONG_TOOL_TIMEOUT_S,
            evidence={"notebook_path": self.runtime["secondary_notebook_path"], "mode": "secondary_background"},
        )
        secondary_run_id = str(secondary_background["run_id"])
        background_status = await self._tool_structured("get_run_status", {"run_id": secondary_run_id})
        _assert(background_status.get("status") == "ok", "get_run_status did not resolve the secondary background run.")
        cancel_finished = await self._tool_structured("cancel_run", {"run_id": secondary_run_id})
        _assert(
            cancel_finished.get("status") in {"already_finished", "cancelled"},
            f"cancel_run returned unexpected payload: {cancel_finished!r}",
        )
        resumed = await self._tool_structured("resume_run", {"run_id": secondary_run_id})
        _assert(
            resumed.get("status") in {"nothing_to_resume", "started"},
            f"resume_run returned unexpected payload: {resumed!r}",
        )

        analysis_cell_source = next(
            cell["source"]
            for cell in PRIMARY_NOTEBOOK_SPEC
            if cell["cell_id"] == PRIMARY_NOTEBOOK_ANALYSIS_CELL_ID
        )
        variables_payload = await self._tool_structured(
            "get_variables",
            {
                "kernel_id": primary_kernel_id,
                "cell_id": PRIMARY_NOTEBOOK_ANALYSIS_CELL_ID,
                "source": analysis_cell_source,
                "include_runtime": True,
            },
        )
        variables = variables_payload.get("variables", {})
        required_vars = (
            "analysis_formulas",
            "analysis_current_values",
            "analysis_checks",
            "analysis_objective",
            "analysis_variables",
            "analysis_constraints",
            "analysis_outputs",
            "analysis_baseline",
            "analysis_candidates",
        )
        missing_analysis_vars = [required_var for required_var in required_vars if required_var not in variables]
        if missing_analysis_vars:
            self.artifacts["get_variables_missing"] = missing_analysis_vars
        else:
            self.artifacts["get_variables_summary"] = {
                key: variables[key]
                for key in required_vars
            }
        self.runtime["analysis_inputs"] = self._fallback_analysis_inputs()

    async def _phase_units(self) -> None:
        catalog = await self._tool_structured("get_units_catalog")
        compatible = await self._tool_structured("check_units_compatible", {"unit_a": "kN", "unit_b": "N"})
        converted = await self._tool_structured(
            "convert_units",
            {"magnitude": 12.5, "from_unit": "kN", "to_unit": "N"},
        )
        catalog_count = int((catalog.get("catalog") or {}).get("count", catalog.get("count", 0)) or 0)
        _assert(catalog_count > 0, "Units catalog is empty.")
        _assert(bool(compatible.get("compatible")), "check_units_compatible did not confirm kN/N compatibility.")
        _assert(abs(float(converted["converted_magnitude"]) - 12500.0) < 1e-9, "Unit conversion returned unexpected value.")

        prompt_text = _message_text(
            await self._get_prompt(
                "unit_conversion_help",
                {"from_value": "12.5", "from_unit": "kN", "to_unit": "N"},
            )
        )
        _assert("convert_units" in prompt_text, "unit_conversion_help prompt is missing convert_units guidance.")

        completions = await self._complete(
            {"type": "ref/prompt", "name": "unit_conversion_help"},
            {"name": "from_unit", "value": "k"},
        )
        self._soft_check(
            "units",
            "unit completion",
            "kN" in completions,
            "Unit completion did not suggest kN.",
        )

    async def _phase_templates(self) -> None:
        validation_loaded = await self._tool_structured(
            "notebook_load",
            {"path": self.runtime["primary_notebook_path"]},
        )
        template_kernel_id = str(validation_loaded["kernel_id"])
        self.runtime["validation_kernel_id"] = template_kernel_id
        self.runtime["document_kernel_id"] = template_kernel_id
        template_path = ensure_template_fixture(Path(__file__).resolve().parents[2] / TEMPLATE_FIXTURE_RELATIVE)
        self.artifacts["template_fixture"] = str(template_path)

        upload_result = await self._tool_structured(
            "upload_template",
            {"kernel_id": template_kernel_id, "file_path": str(template_path)},
        )
        _assert(upload_result.get("status") == "attached", "upload_template did not attach fixture.")

        template_info = await self._tool_structured("get_template_info", {"kernel_id": template_kernel_id})
        template_payload = template_info.get("template")
        _assert(template_payload is not None, "get_template_info returned no template payload.")

        heading_update = await self._tool_structured(
            "update_template_style",
            {
                "kernel_id": template_kernel_id,
                "style_name": "Heading 1",
                "updates": {
                    "font_name": "Arial",
                    "font_size_pt": 18,
                    "bold": True,
                    "color_rgb": "C0504D",
                },
            },
        )
        _assert(heading_update.get("status") == "updated", "Heading 1 update failed.")

        normal_update = await self._tool_structured(
            "update_template_style",
            {
                "kernel_id": template_kernel_id,
                "style_name": "Normal",
                "updates": {
                    "font_name": "Calibri",
                    "font_size_pt": 11,
                    "color_rgb": "1F1F1F",
                },
            },
        )
        _assert(normal_update.get("status") == "updated", "Normal style update failed.")

        style_completions = await self._complete(
            {"type": "ref/prompt", "name": "recover_mcp_notebook_session"},
            {"name": "style_name", "value": "Hea"},
            {"kernel_id": template_kernel_id},
        )
        self._soft_check(
            "templates",
            "style_name completion",
            "Heading 1" in style_completions,
            "Template style completion did not suggest Heading 1.",
        )

        doc_rebatch = await self._tool_structured(
            "execute_all_cells",
            {
                "kernel_id": template_kernel_id,
                "notebook_path": self.runtime["primary_notebook_path"],
                "timeout_per_cell": LONG_TOOL_TIMEOUT_S,
            },
            timeout_s=LONG_TOOL_TIMEOUT_S,
            evidence={"notebook_path": self.runtime["primary_notebook_path"], "mode": "template_rerender"},
        )
        _assert(doc_rebatch.get("status") == "completed", "Template rerender failed after template mutation.")
        self.runtime["template_execution_id"] = str(doc_rebatch.get("execution_id"))
        self.runtime["primary_execution_id"] = self.runtime["template_execution_id"]

        deleted = await self._tool_structured("delete_template", {"kernel_id": template_kernel_id})
        _assert(deleted.get("status") == "deleted", "delete_template did not delete the active template.")
        reattached = await self._tool_structured(
            "upload_template",
            {"kernel_id": template_kernel_id, "file_path": str(template_path)},
        )
        _assert(reattached.get("status") == "attached", "Template re-attach failed.")

    async def _phase_documents(self) -> None:
        primary_kernel_id = self.runtime.get("document_kernel_id", self.runtime["primary_kernel_id"])
        primary_execution_id = self.runtime["primary_execution_id"]

        docx_result = await self._tool_structured(
            "get_document_docx",
            {"kernel_id": primary_kernel_id, "execution_id": primary_execution_id, "inline_content": True},
        )
        _assert(docx_result.get("status") == "ok", f"DOCX handle failed: {docx_result!r}")
        pdf_result = await self._tool_structured(
            "get_document_pdf",
            {"kernel_id": primary_kernel_id, "execution_id": primary_execution_id, "inline_content": True},
        )
        _assert(pdf_result.get("status") in {"ok", "missing_artifact"}, f"Unexpected PDF handle: {pdf_result!r}")

        reconverted = await self._tool_structured(
            "reconvert_pdf",
            {"kernel_id": primary_kernel_id},
            timeout_s=LONG_TOOL_TIMEOUT_S,
        )
        if reconverted.get("status") != "ok":
            self._record_failure(
                "documents",
                "reconvert_pdf",
                f"reconvert_pdf did not regenerate a PDF: {reconverted!r}",
                expected=False,
            )
            fresh_pdf = pdf_result
        else:
            fresh_pdf = await self._tool_structured(
                "get_document_pdf",
                {"kernel_id": primary_kernel_id, "inline_content": True},
            )
        _assert(fresh_pdf.get("status") == "ok", "PDF handle after reconvert is not available.")

        exported_docx = await self._tool_structured(
            "export_document_docx",
            {"kernel_id": primary_kernel_id, "path": str(self.exports_dir / "mcp_torture_report.docx"), "overwrite": True},
            timeout_s=LONG_TOOL_TIMEOUT_S,
        )
        exported_pdf = await self._tool_structured(
            "export_document_pdf",
            {"kernel_id": primary_kernel_id, "path": str(self.exports_dir / "mcp_torture_report.pdf"), "overwrite": True},
            timeout_s=LONG_TOOL_TIMEOUT_S,
        )
        docx_path = Path(str(exported_docx["path"]))
        pdf_path = Path(str(exported_pdf["path"]))
        _assert(docx_path.exists(), f"Exported DOCX missing at {docx_path}.")
        _assert(pdf_path.exists(), f"Exported PDF missing at {pdf_path}.")

        quality = await self._tool_structured(
            "check_document_quality",
            {
                "kernel_id": primary_kernel_id,
                "execution_id": primary_execution_id,
                "run": True,
                "detail": "compact",
            },
            timeout_s=LONG_TOOL_TIMEOUT_S,
        )
        _assert(quality.get("status") == "ok", f"DOCX quality check failed: {quality!r}")
        artifact_id = str(quality.get("artifact_id") or "").strip()
        _assert(artifact_id, "DOCX quality check did not expose artifact_id.")

        fields_report = await self._tool_structured(
            "run_document_workbench",
            {
                "kernel_id": primary_kernel_id,
                "execution_id": primary_execution_id,
                "operation": "fields_report",
                "detail": "compact",
            },
            timeout_s=LONG_TOOL_TIMEOUT_S,
        )
        _assert(fields_report.get("status") == "ok", f"Workbench fields_report failed: {fields_report!r}")
        _assert("fields" in fields_report, "Workbench fields_report did not return field metadata.")

        review = await self._tool_structured(
            "manage_document_review",
            {
                "kernel_id": primary_kernel_id,
                "execution_id": primary_execution_id,
                "action": "comments_extract",
                "detail": "compact",
            },
            timeout_s=LONG_TOOL_TIMEOUT_S,
        )
        _assert(review.get("status") == "ok", f"Document review extraction failed: {review!r}")
        _assert("review" in review, "Document review extraction did not return review metadata.")

        comparison = await self._tool_structured(
            "compare_document_versions",
            {
                "kernel_id": primary_kernel_id,
                "execution_id": primary_execution_id,
                "compare_artifact_id": artifact_id,
            },
            timeout_s=LONG_TOOL_TIMEOUT_S,
        )
        _assert(comparison.get("status") == "ok", f"DOCX version comparison failed: {comparison!r}")
        _assert("diff" in comparison, "DOCX version comparison did not return diff metadata.")

        clean_export = await self._tool_structured(
            "export_clean_document_docx",
            {
                "kernel_id": primary_kernel_id,
                "execution_id": primary_execution_id,
                "path": str(self.exports_dir / "mcp_torture_report_clean.docx"),
                "overwrite": True,
            },
            timeout_s=LONG_TOOL_TIMEOUT_S,
        )
        clean_path = Path(str(clean_export.get("path") or ""))
        _assert(clean_export.get("status") == "ok" and clean_path.exists(), f"Clean DOCX export failed: {clean_export!r}")

        delivery = await self._tool_structured(
            "prepare_document_delivery",
            {
                "kernel_id": primary_kernel_id,
                "execution_id": primary_execution_id,
                "path": str(self.exports_dir / "mcp_torture_delivery.docx"),
                "overwrite": True,
                "detail": "compact",
            },
            timeout_s=LONG_TOOL_TIMEOUT_S,
        )
        delivery_export = delivery.get("export") if isinstance(delivery.get("export"), dict) else {}
        delivery_path = Path(str(delivery_export.get("path") or ""))
        _assert(
            delivery.get("status") == "ok" and delivery_export.get("status") == "ok" and delivery_path.exists(),
            f"Delivery DOCX preparation failed: {delivery!r}",
        )

        self.artifacts["docx_export"] = str(docx_path)
        self.artifacts["pdf_export"] = str(pdf_path)
        self.artifacts["clean_docx_export"] = str(clean_path)
        self.artifacts["delivery_docx_export"] = str(delivery_path)
        self.artifacts["docx_sha256"] = _sha256_bytes(docx_path.read_bytes())
        self.artifacts["pdf_sha256"] = _sha256_bytes(pdf_path.read_bytes())
        self.artifacts["clean_docx_sha256"] = _sha256_bytes(clean_path.read_bytes())
        self.artifacts["delivery_docx_sha256"] = _sha256_bytes(delivery_path.read_bytes())
        self.runtime["docx_handle"] = docx_result
        self.runtime["pdf_handle"] = fresh_pdf
        self.runtime["docx_artifact_id"] = artifact_id

        latest_docx_contents = await self._read_resource_template(
            "inspyro://artifacts/{kernel_id}/{kind}",
            kernel_id=primary_kernel_id,
            kind="docx",
        )
        execution_docx_contents = await self._read_resource_template(
            "inspyro://artifacts/{kernel_id}/{kind}/{execution_id}",
            kernel_id=primary_kernel_id,
            kind="docx",
            execution_id=primary_execution_id,
        )
        _assert(_contents_bytes(latest_docx_contents).startswith(b"PK"), "Latest DOCX resource template did not return DOCX bytes.")
        _assert(_contents_bytes(execution_docx_contents).startswith(b"PK"), "Execution DOCX resource template did not return DOCX bytes.")
        portable_docx_uri = str(docx_result.get("portable_resource_uri") or "").strip()
        self.artifacts["portable_docx_uri"] = portable_docx_uri or None
        if portable_docx_uri:
            token_docx_contents = await self._read_resource(portable_docx_uri)
            _assert(_contents_bytes(token_docx_contents).startswith(b"PK"), "Portable DOCX token resource did not return DOCX bytes.")

        await self._read_resource_template(
            "inspyro://artifacts/{kernel_id}/{kind}",
            kernel_id=primary_kernel_id,
            kind="pdf",
        )
        await self._read_resource_template(
            "inspyro://artifacts/{kernel_id}/{kind}/{execution_id}",
            kernel_id=primary_kernel_id,
            kind="pdf",
            execution_id=primary_execution_id,
        )
        await self._read_resource_template(
            "inspyro://artifacts/token/{kind}/{token}",
            kind="pdf",
            token=str(fresh_pdf.get("token")),
        )

        prompt_text = _message_text(
            await self._get_prompt(
                "create_docx_report_notebook",
                {"topic": "MCP Torture Report", "notebook_name": PRIMARY_NOTEBOOK_NAME},
            )
        )
        _assert("get_document_docx" in prompt_text and "reconvert_pdf" in prompt_text, "DOCX prompt is missing document flow guidance.")

    async def _phase_analysis(self) -> None:
        await self._tool_structured("set_component_profile", {"profile": "analysis"})
        analysis_inputs = self.runtime["analysis_inputs"]
        analysis_formulas = analysis_inputs["analysis_formulas"]
        analysis_current_values = analysis_inputs["analysis_current_values"]
        analysis_checks = analysis_inputs["analysis_checks"]
        analysis_objective = analysis_inputs["analysis_objective"]
        analysis_variables = analysis_inputs["analysis_variables"]
        analysis_constraints = analysis_inputs["analysis_constraints"]
        analysis_outputs = analysis_inputs["analysis_outputs"]
        analysis_baseline = analysis_inputs["analysis_baseline"]
        analysis_candidates = analysis_inputs["analysis_candidates"]

        code_context = [
            cell["source"]
            for cell in PRIMARY_NOTEBOOK_SPEC
            if cell["cell_type"] == "code"
        ]

        dependencies = await self._tool_structured(
            "analyze_dependencies",
            {
                "symbol": "design_stress_MPa",
                "notebook_context": code_context,
                "cell_id": "c03_structural_model",
                "kernel_id": self.runtime["primary_kernel_id"],
            },
        )
        impact = await self._tool_structured(
            "analyze_impact",
            {
                "symbol": "design_moment_kNm",
                "notebook_context": code_context,
                "cell_id": "c03_structural_model",
                "kernel_id": self.runtime["primary_kernel_id"],
            },
        )
        _assert(dependencies.get("status") == "ok" and dependencies.get("nodes"), "Dependency analysis returned no nodes.")
        _assert(impact.get("status") == "ok" and impact.get("nodes"), "Impact analysis returned no nodes.")

        sensitivity = await self._tool_structured(
            "run_sensitivity",
            {
                "modified_variables": {"w_kN_m": analysis_current_values["w_kN_m"] * 1.10},
                "output_variables": ["dcr", "deflection_mm"],
                "formulas": analysis_formulas,
                "current_values": analysis_current_values,
            },
        )
        optimization = await self._tool_structured(
            "optimize_design",
            {
                "objective": analysis_objective,
                "variables": analysis_variables,
                "constraints": analysis_constraints,
                "formulas": analysis_formulas,
                "current_values": analysis_current_values,
                "iterations": 24,
                "seed": 7,
                "kernel_id": self.runtime["primary_kernel_id"],
            },
            timeout_s=LONG_TOOL_TIMEOUT_S,
        )
        comparison = await self._tool_structured(
            "compare_scenarios",
            {
                "baseline": analysis_baseline,
                "candidates": analysis_candidates,
                "outputs": analysis_outputs,
                "formulas": analysis_formulas,
                "current_values": analysis_current_values,
            },
        )
        code_checks = await self._tool_structured(
            "run_code_checks",
            {
                "checks": analysis_checks,
                "formulas": analysis_formulas,
                "current_values": analysis_current_values,
                "code_profile": "mcp-torture",
            },
        )
        _assert(sensitivity.get("status") == "ok", "Sensitivity analysis failed.")
        _assert(optimization.get("status") == "ok" and optimization.get("recommended_design") is not None, "Optimization did not return a recommendation.")
        _assert(comparison.get("status") == "ok" and comparison.get("comparisons"), "Scenario comparison returned no comparisons.")
        _assert(code_checks.get("status") == "ok" and code_checks.get("summary"), "Code checks returned no summary.")

        run_id_completions = await self._complete(
            {"type": "ref/resource", "uri": "inspyro://runs/{run_id}"},
            {"name": "run_id", "value": str(self.runtime["primary_execution_id"])[:12]},
        )
        self._soft_check(
            "analysis",
            "run_id completion",
            self.runtime["primary_execution_id"] in run_id_completions,
            "Run-id completion did not suggest the current execution id.",
        )

        kernel_completions = await self._complete(
            {"type": "ref/prompt", "name": "recover_mcp_notebook_session"},
            {"name": "kernel_id", "value": str(self.runtime["primary_kernel_id"])[:8]},
        )
        self._soft_check(
            "analysis",
            "kernel_id completion",
            self.runtime["primary_kernel_id"] in kernel_completions,
            "Kernel completion did not suggest primary kernel.",
        )

        await self._read_resource_template(
            "inspyro://runs/{run_id}",
            run_id=self.runtime["primary_execution_id"],
        )

        prompt_text = _message_text(
            await self._get_prompt("review_notebook", {"notebook_path": self.runtime["primary_notebook_path"]})
        )
        _assert("analyze_dependencies" in prompt_text and "run_code_checks" in prompt_text, "review_notebook prompt is missing analysis flow guidance.")
        await self._tool_structured("set_component_profile", {"profile": "authoring"})

    async def _phase_admin(self) -> None:
        await self._tool_structured("set_component_profile", {"profile": "admin"})
        metrics = await self._tool_structured("get_metrics")
        pdf_status = await self._tool_structured("get_pdf_status")
        _assert(isinstance(metrics, dict) and metrics, "get_metrics returned no payload.")
        _assert(isinstance(pdf_status, dict) and pdf_status, "get_pdf_status returned no payload.")
        await self._tool_structured("set_component_profile", {"profile": "authoring"})

    async def _phase_stress(self) -> None:
        primary_notebook_path = self.runtime["primary_notebook_path"]
        secondary_notebook_path = self.runtime["secondary_notebook_path"]
        primary_loaded = await self._tool_structured(
            "notebook_load",
            {"path": primary_notebook_path},
        )
        primary_kernel_id = str(primary_loaded["kernel_id"])
        self.runtime["primary_kernel_id"] = primary_kernel_id
        secondary_loaded = await self._tool_structured(
            "notebook_load",
            {"path": secondary_notebook_path},
        )
        secondary_kernel_id = str(secondary_loaded["kernel_id"])
        self.runtime["secondary_kernel_id"] = secondary_kernel_id

        await self._tool_structured(
            "execute_all_cells",
            {"kernel_id": secondary_kernel_id, "notebook_path": secondary_notebook_path},
            timeout_s=LONG_TOOL_TIMEOUT_S,
            evidence={"notebook_path": secondary_notebook_path, "mode": "secondary_persist_outputs"},
        )

        mutated_error_spec = build_mutated_primary_spec(
            "c04_runtime_results",
            """
            raise RuntimeError("intentional torture failure")
            """,
        )
        await self._tool_structured(
            "notebook_sync_cells",
            {"notebook_path": primary_notebook_path, "cells": mutated_error_spec},
        )
        error_result = await self._tool_structured(
            "execute_cell",
            {"kernel_id": primary_kernel_id, "cell_id": "c04_runtime_results"},
            timeout_s=LONG_TOOL_TIMEOUT_S,
            evidence={"cell_id": "c04_runtime_results", "mode": "intentional_error"},
        )
        _assert(error_result.get("status") in {"error", "failed"}, f"Intentional error cell did not fail: {error_result!r}")

        await self._tool_structured(
            "notebook_sync_cells",
            {"notebook_path": primary_notebook_path, "cells": clone_notebook_spec(PRIMARY_NOTEBOOK_SPEC)},
        )
        recovered_loaded = await self._tool_structured(
            "notebook_load",
            {"path": primary_notebook_path},
        )
        primary_kernel_id = str(recovered_loaded["kernel_id"])
        self.runtime["primary_kernel_id"] = primary_kernel_id
        restored_result = await self._tool_structured(
            "execute_all_cells",
            {
                "kernel_id": primary_kernel_id,
                "notebook_path": primary_notebook_path,
                "cell_ids": [
                    PRIMARY_NOTEBOOK_BOOTSTRAP_CELL_ID,
                    "c02_engineering_units",
                    "c03_structural_model",
                    "c04_runtime_results",
                ],
                "timeout_per_cell": LONG_TOOL_TIMEOUT_S,
            },
            timeout_s=LONG_TOOL_TIMEOUT_S,
            evidence={"cell_id": "c04_runtime_results", "mode": "recovered"},
        )
        recovered_failed_cells = set(restored_result.get("failed_cell_ids") or [])
        _assert(
            "c04_runtime_results" not in recovered_failed_cells,
            "Recovered cell did not execute cleanly.",
        )

        secondary_modified_keep = clone_notebook_spec(SECONDARY_NOTEBOOK_SPEC)
        secondary_modified_keep[-1]["source"] = (
            "from pathlib import Path\n"
            "workspace = Path().resolve()\n"
            "print(f'secondary_workspace={workspace}')\n"
            "quick_values = [n * n for n in range(8)]\n"
            "quick_total = sum(quick_values)\n"
            "print(f'quick_total={quick_total}')\n"
        )
        await self._tool_structured(
            "notebook_sync_cells",
            {
                "notebook_path": secondary_notebook_path,
                "cells": secondary_modified_keep,
                "preserve_outputs": True,
            },
        )
        secondary_notebook = _load_notebook(Path(secondary_notebook_path))
        secondary_cell = next(cell for cell in secondary_notebook["cells"] if cell.get("id") == SECONDARY_NOTEBOOK_CODE_CELL_ID)
        _assert(_cell_outputs(secondary_cell), "preserve_outputs=True should keep previous outputs for modified secondary cell.")

        secondary_modified_clear = clone_notebook_spec(SECONDARY_NOTEBOOK_SPEC)
        secondary_modified_clear[-1]["source"] = (
            "from pathlib import Path\n"
            "workspace = Path().resolve()\n"
            "print(f'secondary_workspace={workspace}')\n"
            "quick_values = [n * n for n in range(10)]\n"
            "quick_total = sum(quick_values)\n"
            "print(f'quick_total={quick_total}')\n"
        )
        await self._tool_structured(
            "notebook_sync_cells",
            {
                "notebook_path": secondary_notebook_path,
                "cells": secondary_modified_clear,
                "preserve_outputs": False,
            },
        )
        secondary_notebook = _load_notebook(Path(secondary_notebook_path))
        secondary_cell = next(cell for cell in secondary_notebook["cells"] if cell.get("id") == SECONDARY_NOTEBOOK_CODE_CELL_ID)
        _assert(not _cell_outputs(secondary_cell), "preserve_outputs=False should clear outputs for modified secondary cell.")

        long_task = asyncio.create_task(
            self._tool_structured(
                "execute_cell",
                {"kernel_id": primary_kernel_id, "cell_id": PRIMARY_NOTEBOOK_LONG_CELL_ID, "timeout": 40},
                timeout_s=LONG_TOOL_TIMEOUT_S,
                evidence={"cell_id": PRIMARY_NOTEBOOK_LONG_CELL_ID, "mode": "concurrent_long_run"},
            )
        )
        await asyncio.sleep(2.0)
        secondary_loaded = await self._tool_structured(
            "notebook_load",
            {"path": secondary_notebook_path},
        )
        secondary_kernel_id = str(secondary_loaded["kernel_id"])
        self.runtime["secondary_kernel_id"] = secondary_kernel_id
        quick_task = asyncio.create_task(
            self._tool_structured(
                "execute_cell",
                {"kernel_id": secondary_kernel_id, "cell_id": SECONDARY_NOTEBOOK_CODE_CELL_ID},
                timeout_s=LONG_TOOL_TIMEOUT_S,
                evidence={"cell_id": SECONDARY_NOTEBOOK_CODE_CELL_ID, "mode": "concurrent_quick_run"},
            )
        )
        quick_result = await quick_task
        _assert(quick_result.get("status") == "executed", "Concurrent quick execution failed.")

        try:
            interrupted = await self._tool_structured("interrupt_kernel", {"kernel_id": primary_kernel_id}, timeout_s=20)
        except Exception:
            interrupt_reload = await self._tool_structured(
                "notebook_load",
                {"path": primary_notebook_path},
            )
            primary_kernel_id = str(interrupt_reload["kernel_id"])
            self.runtime["primary_kernel_id"] = primary_kernel_id
            interrupted = await self._tool_structured("interrupt_kernel", {"kernel_id": primary_kernel_id}, timeout_s=20)
        _assert(interrupted.get("status") == "interrupted", "interrupt_kernel did not report interruption.")
        long_result = await long_task
        _assert(long_result.get("status") in {"error", "failed"}, f"Interrupted long cell did not end in error state: {long_result!r}")

        soft_reset = await self._tool_structured("reset_kernel", {"kernel_id": primary_kernel_id, "hard": False}, timeout_s=45)
        _assert(soft_reset.get("status") == "reset" and soft_reset.get("hard") is False, "Soft reset failed.")
        hard_reset = await self._tool_structured("reset_kernel", {"kernel_id": primary_kernel_id, "hard": True}, timeout_s=90)
        _assert(hard_reset.get("status") == "reset" and hard_reset.get("hard") is True, "Hard reset failed.")
        self.runtime["primary_kernel_id"] = hard_reset.get("kernel_id", primary_kernel_id)

        await self._tool_structured(
            "notebook_save",
            {"kernel_id": self.runtime["primary_kernel_id"], "path": primary_notebook_path},
        )
        await self._tool_structured(
            "notebook_save",
            {"kernel_id": secondary_kernel_id, "path": secondary_notebook_path},
        )

        debug_prompt = _message_text(
            await self._get_prompt(
                "debug_cell_error",
                {
                    "error_message": "RuntimeError: intentional torture failure",
                    "cell_source": "raise RuntimeError('intentional torture failure')",
                },
            )
        )
        _assert("notebook_sync_cells" in debug_prompt and "execute_cell" in debug_prompt, "debug_cell_error prompt is missing recovery guidance.")

        recover_prompt = _message_text(
            await self._get_prompt(
                "recover_mcp_notebook_session",
                {
                    "observed_error": "missing_artifact",
                    "notebook_path": primary_notebook_path,
                    "kernel_id": self.runtime["primary_kernel_id"],
                    "style_name": "Heading 1",
                },
            )
        )
        _assert("notebook_load" in recover_prompt and "get_document_docx" in recover_prompt, "recover prompt is missing notebook recovery guidance.")

        loaded_again = await self._tool_structured(
            "notebook_load",
            {"path": primary_notebook_path, "include_source": True},
        )
        reloaded_ids = [str(cell.get("id")) for cell in loaded_again.get("cells", [])]
        expected_ids = [cell["cell_id"] for cell in PRIMARY_NOTEBOOK_SPEC]
        _assert(reloaded_ids == expected_ids, "Cell ids changed after save/load roundtrip.")
        self.runtime["post_save_kernel_id"] = str(loaded_again["kernel_id"])

        await self._tool_structured("close_session_notebook", {"kernel_id": secondary_kernel_id})
        created_primary_kernel_id = self.runtime.get("created_primary_kernel_id")
        if created_primary_kernel_id and created_primary_kernel_id not in {
            self.runtime["primary_kernel_id"],
            self.runtime["post_save_kernel_id"],
        }:
            await self._tool_structured("shutdown_kernel", {"kernel_id": created_primary_kernel_id})
        await self._tool_structured("shutdown_kernel", {"kernel_id": self.runtime["primary_kernel_id"]})
        await self._tool_structured("shutdown_kernel", {"kernel_id": self.runtime["post_save_kernel_id"]})

    async def _phase_report_validation(self) -> None:
        docx_path = Path(self.artifacts["docx_export"])
        pdf_path = Path(self.artifacts["pdf_export"])
        notebook_path = Path(self.runtime["primary_notebook_path"])

        docx_assertions = _parse_docx_assertions(docx_path)
        _assert(docx_assertions["heading_text_present"], "DOCX document body is missing the report heading.")
        _assert(docx_assertions["has_toc_field"], "DOCX document is missing a TOC field.")
        _assert(docx_assertions["has_math"], "DOCX document is missing OMML math content.")
        _assert(docx_assertions["has_seq_figure"], "DOCX document is missing figure captions.")
        _assert(docx_assertions["has_seq_table"], "DOCX document is missing table captions.")
        _assert(docx_assertions["has_reference_field"], "DOCX document is missing references.")
        _assert(docx_assertions["has_media"], "DOCX document is missing embedded media.")
        _assert("MCP Torture Template Header" in docx_assertions["header_text"], "DOCX header does not reflect the template fixture.")
        _assert("MCP Torture Template Footer" in docx_assertions["footer_text"], "DOCX footer does not reflect the template fixture.")
        _assert("Arial" in docx_assertions["styles_xml"] and "C0504D" in docx_assertions["styles_xml"], "Heading 1 style mutation is not visible in styles.xml.")

        pdf_bytes = pdf_path.read_bytes()
        _assert(pdf_bytes.startswith(b"%PDF"), "Exported PDF does not start with %PDF.")
        _assert(len(pdf_bytes) > 1024, "Exported PDF is too small to be credible.")
        _assert(_count_pdf_pages(pdf_bytes) > 1, "Exported PDF should have more than one page.")

        notebook_payload = _load_notebook(notebook_path)
        notebook_ids = [str(cell.get("id")) for cell in notebook_payload.get("cells", [])]
        expected_ids = [cell["cell_id"] for cell in PRIMARY_NOTEBOOK_SPEC]
        _assert(notebook_ids == expected_ids, "Primary notebook on disk does not preserve canonical order and ids.")

        self.artifacts["docx_assertions"] = {
            key: value
            for key, value in docx_assertions.items()
            if key not in {"styles_xml", "document_xml"}
        }
        self.artifacts["pdf_page_count"] = _count_pdf_pages(pdf_bytes)

    async def _finalize_activity_report(self) -> None:
        after = await self._activity_snapshot()
        baseline_summary = {
            item["tool_name"]: item
            for item in self.baseline_activity.get("tool_summary", [])
        }
        after_summary = {
            item["tool_name"]: item
            for item in after.get("tool_summary", [])
        }

        deltas: dict[str, dict[str, Any]] = {}
        for tool_name in sorted(PROFILE_TOOLSETS["all"]):
            before = baseline_summary.get(tool_name, {})
            current = after_summary.get(tool_name, {})
            deltas[tool_name] = {
                "started": int(current.get("started", 0)) - int(before.get("started", 0)),
                "completed": int(current.get("completed", 0)) - int(before.get("completed", 0)),
                "failed": int(current.get("failed", 0)) - int(before.get("failed", 0)),
                "last_seen": current.get("last_seen"),
                "avg_duration_ms": current.get("avg_duration_ms"),
            }

        self.report["activity"] = {
            "baseline_active_count": self.baseline_activity.get("active_count"),
            "final_active_count": after.get("active_count"),
            "tool_summary_delta": deltas,
        }

        for tool_name, meta in self.coverage["tools"].items():
            if not meta["covered"]:
                continue
            delta = deltas.get(tool_name, {})
            _assert(
                any(int(delta.get(key, 0)) > 0 for key in ("started", "completed", "failed")),
                f"/api/mcp/activity did not capture tool summary delta for {tool_name}.",
            )

    def _finalize_coverage(self) -> None:
        missing = {
            category: sorted(name for name, meta in bucket.items() if not meta["covered"])
            for category, bucket in self.coverage.items()
        }
        self.report["coverage_missing"] = missing
        for category, names in missing.items():
            for name in names:
                self._record_failure(
                    "coverage",
                    f"missing {category}",
                    f"Coverage matrix entry not exercised: {name}",
                    expected=False,
                    details={"category": category},
                )

    def _write_report_files(self) -> None:
        self.report_path.write_text(_json_dumps(self.report) + "\n", encoding="utf-8")
        self.report_md_path.write_text(self._render_report_markdown(), encoding="utf-8")

    def _render_report_markdown(self) -> str:
        lines = [
            "# MCP Torture Report",
            "",
            f"- Started: {self.report['started_at']}",
            f"- Finished: {self.report.get('finished_at', '-')}",
            f"- Workspace: `{self.workspace_root}`",
            f"- MCP URL: `{self.mcp_url}`",
            f"- Unexpected failures: {len(self.report['unexpected_failures'])}",
            f"- Expected failures: {len(self.report['expected_failures'])}",
            "",
            "## Phase Status",
        ]
        for phase in self.report["phases"]:
            lines.append(
                f"- `{phase['phase']}`: {phase['status']} ({phase['duration_ms']} ms)"
            )

        lines.extend(
            [
                "",
                "## Artifacts",
                f"- DOCX: `{self.artifacts.get('docx_export', '-')}`",
                f"- PDF: `{self.artifacts.get('pdf_export', '-')}`",
                f"- Portable DOCX URI: `{self.artifacts.get('portable_docx_uri', '-') or '-'}`",
                f"- Report JSON: `{self.report_path}`",
                f"- Report MD: `{self.report_md_path}`",
                "",
                "## Coverage Gaps",
            ]
        )
        for category, names in self.report.get("coverage_missing", {}).items():
            if names:
                lines.append(f"- `{category}`: {', '.join(names)}")
            else:
                lines.append(f"- `{category}`: none")

        if self.report["unexpected_failures"]:
            lines.extend(["", "## Unexpected Failures"])
            for failure in self.report["unexpected_failures"]:
                lines.append(f"- `{failure['phase']}` / `{failure['step']}`: {failure['message']}")

        return "\n".join(lines) + "\n"


async def _async_main(args: argparse.Namespace) -> int:
    auto_workspace = False
    if args.workspace:
        workspace_root = Path(args.workspace).expanduser().resolve()
        workspace_root.mkdir(parents=True, exist_ok=True)
    else:
        auto_workspace = True
        workspace_root = Path(tempfile.mkdtemp(prefix="inspyro_mcp_torture_")).resolve()

    probe = McpTortureProbe(
        mcp_url=args.mcp_url,
        backend_url=args.backend_url,
        workspace_root=workspace_root,
        keep_artifacts=bool(args.keep_artifacts),
    )
    exit_code = await probe.run()
    print(f"MCP torture report written to {probe.report_path}")
    print(f"MCP torture markdown report written to {probe.report_md_path}")
    print(f"MCP torture workspace: {workspace_root}")

    if auto_workspace and not args.keep_artifacts and exit_code == 0:
        print("Workspace was auto-created and left in place for inspection; delete it manually if no longer needed.")

    return exit_code


def _build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Run the exhaustive Inspyro MCP torture probe.")
    parser.add_argument("--mcp-url", default="http://127.0.0.1:8100/mcp", help="Live MCP endpoint URL.")
    parser.add_argument("--backend-url", default="http://127.0.0.1:8000", help="Backend base URL for activity snapshots.")
    parser.add_argument("--workspace", default="", help="Absolute or relative workspace for probe artifacts.")
    parser.add_argument(
        "--keep-artifacts",
        action="store_true",
        help="Keep extra binary resource snapshots under evidence/resources.",
    )
    return parser


def main(argv: Optional[list[str]] = None) -> int:
    parser = _build_parser()
    args = parser.parse_args(argv)
    return asyncio.run(_async_main(args))


if __name__ == "__main__":
    raise SystemExit(main())
