from __future__ import annotations

import re
from typing import Any


_SOURCE_BY_SECTION = {
    "accessibility": "audit",
    "layout": "audit",
    "package": "audit",
    "fields": "fields",
    "styles": "styles",
    "publication": "publishing",
    "content_controls": "content_controls",
    "review": "review",
    "redlines": "review",
    "privacy": "publishing",
    "protection": "publishing",
    "diff": "diff",
}


def _slug_code(text: str) -> str:
    slug = re.sub(r"[^a-z0-9]+", "_", text.lower()).strip("_")
    return slug[:80] or "finding"


def _location_from_context(context: dict[str, Any]) -> str | None:
    parts: list[str] = []
    for key in ("part", "style", "placeholder", "tag", "name", "id", "page", "paragraph", "row", "column"):
        value = context.get(key)
        if value is not None and str(value).strip():
            parts.append(f"{key}={str(value).strip()[:120]}")
    text = context.get("text")
    if text:
        parts.append(f"text={str(text).strip()[:120]}")
    if context.get("from_level") is not None and context.get("to_level") is not None:
        parts.append(f"heading={context.get('from_level')}->{context.get('to_level')}")
    return "; ".join(parts) or None


def normalize_finding(raw: dict[str, Any]) -> dict[str, Any]:
    section = str(raw.get("section") or "general").strip() or "general"
    message = str(raw.get("message") or raw.get("title") or "").strip()
    context = raw.get("context") if isinstance(raw.get("context"), dict) else {}
    code = str(raw.get("code") or f"{section}.{_slug_code(message)}").strip()
    source = raw.get("source") or _SOURCE_BY_SECTION.get(section, "audit")
    finding = {
        "severity": str(raw.get("severity") or "info").strip().lower() or "info",
        "section": section,
        "code": code,
        "message": message,
        "location": raw.get("location") or _location_from_context(context),
        "suggestion": raw.get("suggestion"),
        "source": source,
        "fixable": bool(raw.get("fixable", False)),
        "context": context,
    }
    return {key: value for key, value in finding.items() if value not in (None, "")}


def make_finding(
    section: str,
    severity: str,
    message: str,
    *,
    code: str | None = None,
    suggestion: str | None = None,
    source: str | None = None,
    fixable: bool = False,
    location: str | None = None,
    **context: Any,
) -> dict[str, Any]:
    return normalize_finding(
        {
            "section": section,
            "severity": severity,
            "message": message,
            "code": code,
            "suggestion": suggestion,
            "source": source,
            "fixable": fixable,
            "location": location,
            "context": context,
        }
    )


def section_status(findings: list[dict[str, Any]]) -> str:
    severities = {str(item.get("severity")) for item in findings}
    if "error" in severities:
        return "error"
    if "warning" in severities:
        return "warning"
    return "ok"


def score_from_counts(counts: dict[str, int]) -> int:
    penalty = counts.get("error", 0) * 25 + counts.get("warning", 0) * 8 + counts.get("info", 0) * 2
    return max(0, min(100, 100 - penalty))
