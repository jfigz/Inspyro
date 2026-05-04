from __future__ import annotations

from typing import Any

from .ooxml import NS, iter_story_parts
from .publish import clean_docx_bytes


def report_tracked_changes(docx_bytes: bytes) -> dict[str, Any]:
    counts = {"insertions": 0, "deletions": 0, "moves_to": 0, "moves_from": 0}
    samples: list[dict[str, Any]] = []
    for part in iter_story_parts(docx_bytes, include_comments=True):
        for tag, key in (("ins", "insertions"), ("del", "deletions"), ("moveTo", "moves_to"), ("moveFrom", "moves_from")):
            for node in part.root.xpath(f".//w:{tag}", namespaces=NS):
                counts[key] += 1
                if len(samples) < 8:
                    samples.append({"part": part.name, "kind": tag, "text": "".join(node.xpath(".//w:t/text() | .//w:delText/text()", namespaces=NS))[:160]})
    return {"counts": counts, "tracked_change_count": sum(counts.values()), "samples": samples}


def accept_tracked_changes(docx_bytes: bytes) -> tuple[bytes, dict[str, int]]:
    return clean_docx_bytes(docx_bytes, scrub_metadata=False, strip_comments=False, tracked_changes="accept")


def reject_tracked_changes(docx_bytes: bytes) -> tuple[bytes, dict[str, int]]:
    return clean_docx_bytes(docx_bytes, scrub_metadata=False, strip_comments=False, tracked_changes="reject")
