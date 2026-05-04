"""OOXML utility helpers extracted for template domain modules."""

from typing import Optional
import xml.etree.ElementTree as ET


DOCX_NS = {
    "w": "http://schemas.openxmlformats.org/wordprocessingml/2006/main",
    "a": "http://schemas.openxmlformats.org/drawingml/2006/main",
    "r": "http://schemas.openxmlformats.org/officeDocument/2006/relationships",
}


def qn(prefix: str, tag: str) -> str:
    return f"{{{DOCX_NS[prefix]}}}{tag}"


def local_name(tag: str) -> str:
    return tag.split("}", 1)[1] if "}" in tag else tag


def serialize_xml(element: Optional[ET.Element]) -> Optional[str]:
    if element is None:
        return None
    try:
        return ET.tostring(element, encoding="unicode")
    except Exception:
        return None
