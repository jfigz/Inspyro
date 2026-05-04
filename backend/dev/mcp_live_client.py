"""Live MCP JSON-RPC helper.

This client mirrors the transport contract used by `agent_debug.ps1 mcp-smoke`:
initialize over Streamable HTTP, persist `Mcp-Session-Id` when present, send
`notifications/initialized`, and accept either JSON or SSE-wrapped JSON.
"""

from __future__ import annotations

import itertools
import json
from dataclasses import dataclass
from typing import Any, Optional

import httpx

MCP_PROTOCOL_VERSION = "2025-11-25"
MCP_ACCEPT_HEADER = "application/json, text/event-stream"
DEFAULT_TOOL_CALL_TIMEOUT_S = 600


class McpTransportError(RuntimeError):
    """Raised when the live MCP server returns an invalid transport payload."""


@dataclass(slots=True)
class McpRpcError(RuntimeError):
    """Raised when a JSON-RPC request returns an MCP error payload."""

    method: str
    error: dict[str, Any]

    def __post_init__(self) -> None:
        code = self.error.get("code", "unknown")
        message = self.error.get("message") or json.dumps(self.error, ensure_ascii=False)
        RuntimeError.__init__(self, f"MCP {self.method} failed ({code}): {message}")

    @property
    def data(self) -> dict[str, Any]:
        data = self.error.get("data")
        return data if isinstance(data, dict) else {}


class LiveMcpClient:
    """Small async client for Inspyro's live MCP HTTP endpoint."""

    def __init__(
        self,
        url: str,
        *,
        client_name: str = "mcp_torture_probe",
        client_version: str = "1.0",
        default_timeout_s: int = 30,
        default_call_timeout_s: int = DEFAULT_TOOL_CALL_TIMEOUT_S,
    ) -> None:
        self.url = str(url)
        self.client_name = client_name
        self.client_version = client_version
        self.default_timeout_s = int(default_timeout_s)
        self.default_call_timeout_s = int(default_call_timeout_s)
        self.protocol_version: Optional[str] = None
        self.session_id: Optional[str] = None
        self._counter = itertools.count(1)
        self._http = httpx.AsyncClient(follow_redirects=True)

    async def __aenter__(self) -> "LiveMcpClient":
        await self.initialize()
        return self

    async def __aexit__(self, exc_type, exc, tb) -> None:
        await self.close()

    async def close(self) -> None:
        await self._http.aclose()

    def _headers(self) -> dict[str, str]:
        headers = {"Accept": MCP_ACCEPT_HEADER}
        if self.protocol_version:
            headers["MCP-Protocol-Version"] = self.protocol_version
        if self.session_id:
            headers["Mcp-Session-Id"] = self.session_id
        return headers

    @staticmethod
    def _parse_payload(content: str) -> dict[str, Any]:
        if not content or not content.strip():
            raise McpTransportError("MCP response was empty.")

        stripped = content.strip()
        if stripped.startswith("{") or stripped.startswith("["):
            payload = json.loads(stripped)
        else:
            events: list[str] = []
            current_event: list[str] = []
            for raw_line in content.splitlines():
                if raw_line.startswith("data:"):
                    current_event.append(raw_line[5:].lstrip())
                    continue
                if not raw_line.strip() and current_event:
                    events.append("\n".join(current_event))
                    current_event = []
            if current_event:
                events.append("\n".join(current_event))
            if not events:
                raise McpTransportError("MCP response did not contain JSON or SSE data payload.")

            parsed_events: list[dict[str, Any]] = []
            for event_text in events:
                try:
                    parsed = json.loads(event_text)
                except json.JSONDecodeError:
                    continue
                if isinstance(parsed, dict):
                    parsed_events.append(parsed)
            if not parsed_events:
                raise McpTransportError("MCP SSE payload did not contain a JSON object event.")
            payload = parsed_events[-1]

        if not isinstance(payload, dict):
            raise McpTransportError(f"MCP response was not an object: {type(payload)!r}")
        return payload

    async def request(
        self,
        method: str,
        params: Optional[dict[str, Any]] = None,
        *,
        timeout_s: Optional[int] = None,
        notify_only: bool = False,
    ) -> dict[str, Any]:
        request_id = None if notify_only else next(self._counter)
        payload: dict[str, Any] = {"jsonrpc": "2.0", "method": method}
        if request_id is not None:
            payload["id"] = request_id
        if params is not None:
            payload["params"] = params

        response = await self._http.post(
            self.url,
            headers=self._headers(),
            json=payload,
            timeout=timeout_s or self.default_timeout_s,
        )
        response.raise_for_status()

        session_id = response.headers.get("Mcp-Session-Id")
        if session_id:
            self.session_id = session_id

        if notify_only:
            return {}

        message = self._parse_payload(response.text)
        if message.get("error"):
            raise McpRpcError(method=method, error=message["error"])
        return message

    async def initialize(self) -> dict[str, Any]:
        message = await self.request(
            "initialize",
            {
                "protocolVersion": MCP_PROTOCOL_VERSION,
                "capabilities": {},
                "clientInfo": {
                    "name": self.client_name,
                    "version": self.client_version,
                },
            },
            timeout_s=max(self.default_timeout_s, 15),
        )
        result = message.get("result") or {}
        protocol_version = str(result.get("protocolVersion") or "").strip()
        if not protocol_version:
            raise McpTransportError("MCP initialize did not return protocolVersion.")
        self.protocol_version = protocol_version

        try:
            await self.request(
                "notifications/initialized",
                {},
                timeout_s=10,
                notify_only=True,
            )
        except Exception:
            if self.session_id:
                raise
        return message

    async def list_tools(self) -> list[dict[str, Any]]:
        tools: list[dict[str, Any]] = []
        cursor: Optional[str] = None
        while True:
            params = {"cursor": cursor} if cursor else {}
            message = await self.request("tools/list", params, timeout_s=15)
            result = message.get("result") or {}
            tools.extend(result.get("tools") or [])
            next_cursor = str(result.get("nextCursor") or "").strip() or None
            if not next_cursor:
                return tools
            cursor = next_cursor

    async def list_resources(self) -> list[dict[str, Any]]:
        message = await self.request("resources/list", {}, timeout_s=15)
        return list((message.get("result") or {}).get("resources") or [])

    async def list_resource_templates(self) -> list[dict[str, Any]]:
        message = await self.request("resources/templates/list", {}, timeout_s=15)
        return list((message.get("result") or {}).get("resourceTemplates") or [])

    async def list_prompts(self) -> list[dict[str, Any]]:
        message = await self.request("prompts/list", {}, timeout_s=15)
        return list((message.get("result") or {}).get("prompts") or [])

    async def read_resource(self, uri: str) -> list[dict[str, Any]]:
        message = await self.request("resources/read", {"uri": uri}, timeout_s=30)
        return list((message.get("result") or {}).get("contents") or [])

    async def get_prompt(
        self,
        name: str,
        arguments: Optional[dict[str, Any]] = None,
    ) -> list[dict[str, Any]]:
        message = await self.request(
            "prompts/get",
            {"name": name, "arguments": arguments or {}},
            timeout_s=20,
        )
        return list((message.get("result") or {}).get("messages") or [])

    async def complete(
        self,
        ref: dict[str, Any],
        argument: dict[str, Any],
        context: Optional[dict[str, Any]] = None,
    ) -> list[str]:
        params: dict[str, Any] = {"ref": ref, "argument": argument}
        if context:
            if "arguments" in context:
                params["context"] = context
            else:
                params["context"] = {"arguments": context}
        message = await self.request("completion/complete", params, timeout_s=20)
        completion = (message.get("result") or {}).get("completion") or {}
        return [str(value) for value in completion.get("values") or []]

    async def call_tool(
        self,
        name: str,
        arguments: Optional[dict[str, Any]] = None,
        *,
        timeout_s: Optional[int] = None,
    ) -> dict[str, Any]:
        message = await self.request(
            "tools/call",
            {"name": name, "arguments": arguments or {}},
            timeout_s=timeout_s or self.default_call_timeout_s,
        )
        return dict(message.get("result") or {})
