from __future__ import annotations

import hashlib
import re
from collections import Counter
from typing import Any

from lxml import etree

from app.services.docx_core.findings import make_finding, score_from_counts, section_status

from .content_controls import inspect_content_controls
from .fields import extract_fields_from_root, report_fields
from .ooxml import NS, iter_story_parts, read_zip, summarize_findings, visible_text
from .redlines import report_tracked_changes

NONDESCRIPTIVE_LINK_TEXT = {"click here", "here", "link", "this link", "aqui", "aquí"}
URL_RE = re.compile(r"https?://\S+", re.IGNORECASE)
LITERAL_FIELD_RE = re.compile(r"\{(?:PAGE|NUMPAGES|DATE|TIME|TOC|REF|PAGEREF)\}", re.IGNORECASE)
AUDIT_PROFILES = {"quick", "agent", "delivery", "visual", "publishing"}


def _finding(
    section: str,
    severity: str,
    message: str,
    *,
    code: str | None = None,
    suggestion: str | None = None,
    source: str | None = None,
    fixable: bool = False,
    **context: Any,
) -> dict[str, Any]:
    return make_finding(
        section,
        severity,
        message,
        code=code,
        suggestion=suggestion,
        source=source,
        fixable=fixable,
        **context,
    )


def _heading_level(style_val: str | None) -> int | None:
    if not style_val:
        return None
    match = re.match(r"Heading\s*(\d+)$", style_val, re.IGNORECASE)
    if match:
        return int(match.group(1))
    match = re.match(r"T[i\u00ed]tulo\s*(\d+)$", style_val, re.IGNORECASE)
    if match:
        return int(match.group(1))
    return None


def _extract_fields(root: etree._Element) -> list[str]:
    return [str(item.get("instruction") or "") for item in extract_fields_from_root(root)]


def _audit_story_part(part_name: str, root: etree._Element) -> tuple[list[dict[str, Any]], Counter[str]]:
    findings: list[dict[str, Any]] = []
    field_counts: Counter[str] = Counter()
    last_heading: int | None = None

    for para in root.xpath(".//w:p", namespaces=NS):
        pstyle = para.xpath("string(./w:pPr/w:pStyle/@w:val)", namespaces=NS) or None
        level = _heading_level(pstyle)
        if level is not None:
            if last_heading is not None and level > last_heading + 1:
                findings.append(
                    _finding(
                        "accessibility",
                        "warning",
                        "Salto de jerarquia de encabezados",
                        code="accessibility.heading_level_skip",
                        suggestion="Ajusta los estilos de encabezado para no saltar niveles.",
                        part=part_name,
                        from_level=last_heading,
                        to_level=level,
                        text=visible_text(para)[:120],
                    )
                )
            last_heading = level

    for docpr in root.xpath(".//wp:docPr", namespaces=NS):
        descr = (docpr.get("descr") or "").strip()
        title = (docpr.get("title") or "").strip()
        if not descr and not title:
            findings.append(
                _finding(
                    "accessibility",
                    "error",
                    "Imagen sin texto alternativo",
                    code="accessibility.image_missing_alt_text",
                    suggestion="Agrega alt_text en el builder o texto alternativo en la plantilla.",
                    part=part_name,
                    name=docpr.get("name"),
                    id=docpr.get("id"),
                )
            )

    for table in root.xpath(".//w:tbl", namespaces=NS):
        rows = table.xpath("./w:tr", namespaces=NS)
        if not rows:
            continue
        has_header = rows[0].find("w:trPr/w:tblHeader", namespaces=NS) is not None
        if not has_header:
            findings.append(
                _finding(
                    "accessibility",
                    "warning",
                    "Tabla sin primera fila marcada como encabezado",
                    code="accessibility.table_missing_header_row",
                    suggestion="Marca la primera fila como encabezado repetible.",
                    fixable=True,
                    part=part_name,
                )
            )

    for hyperlink in root.xpath(".//w:hyperlink", namespaces=NS):
        text = visible_text(hyperlink).strip()
        lowered = text.lower()
        if lowered in NONDESCRIPTIVE_LINK_TEXT:
            findings.append(_finding("accessibility", "warning", "Hipervinculo con texto poco descriptivo", code="accessibility.link_text_generic", part=part_name, text=text))
        if URL_RE.fullmatch(text):
            findings.append(_finding("accessibility", "info", "Hipervinculo muestra la URL cruda", code="accessibility.link_shows_raw_url", part=part_name, text=text[:120]))

    for literal in LITERAL_FIELD_RE.findall(visible_text(root)):
        findings.append(
            _finding(
                "fields",
                "warning",
                "Placeholder de campo Word escrito como texto literal",
                code="fields.literal_word_field",
                suggestion="Reemplaza el texto literal por un campo Word real o por contenido final.",
                fixable=True,
                part=part_name,
                placeholder=literal,
            )
        )

    for instr in _extract_fields(root):
        field_type = (instr.split() or ["unknown"])[0].upper()
        field_counts[field_type] += 1

    direct_runs = 0
    direct_paragraphs = 0
    for run in root.xpath(".//w:r", namespaces=NS):
        rpr = run.find("w:rPr", namespaces=NS)
        if rpr is not None and list(rpr):
            direct_runs += 1
    for para in root.xpath(".//w:p", namespaces=NS):
        ppr = para.find("w:pPr", namespaces=NS)
        if ppr is not None:
            non_style_children = [child for child in ppr if child.tag != f"{{{NS['w']}}}pStyle"]
            if non_style_children:
                direct_paragraphs += 1
    if direct_runs:
        findings.append(_finding("styles", "info", "Runs con formato directo detectados", code="styles.direct_run_formatting", fixable=True, part=part_name, count=direct_runs))
    if direct_paragraphs:
        findings.append(_finding("styles", "info", "Parrafos con formato directo detectados", code="styles.direct_paragraph_formatting", fixable=True, part=part_name, count=direct_paragraphs))

    return findings, field_counts


def _audit_package(docx_bytes: bytes) -> tuple[list[dict[str, Any]], dict[str, Any], str | None]:
    findings: list[dict[str, Any]] = []
    package_error = None
    inventory: dict[str, Any] = {
        "has_comments": False,
        "has_core_props": False,
        "has_custom_props": False,
        "header_footer_parts": 0,
        "media_parts": 0,
        "footnote_parts": 0,
        "malformed_rels": [],
    }
    try:
        with read_zip(docx_bytes) as archive:
            names = set(archive.namelist())
            if "word/document.xml" not in names:
                package_error = "Falta word/document.xml"
            if "[Content_Types].xml" not in names:
                package_error = "Falta [Content_Types].xml"
            inventory["has_comments"] = "word/comments.xml" in names
            inventory["has_core_props"] = "docProps/core.xml" in names
            inventory["has_custom_props"] = "docProps/custom.xml" in names
            inventory["header_footer_parts"] = len([name for name in names if name.startswith("word/header") or name.startswith("word/footer")])
            inventory["media_parts"] = len([name for name in names if name.startswith("word/media/")])
            inventory["footnote_parts"] = len([name for name in names if name in {"word/footnotes.xml", "word/endnotes.xml"}])
            for rels_name in [name for name in names if name.endswith(".rels")]:
                try:
                    archive.read(rels_name)
                except Exception:
                    inventory["malformed_rels"].append(rels_name)
    except Exception as exc:
        package_error = f"DOCX invalido: {type(exc).__name__}"
    if package_error:
        findings.append(_finding("package", "error", package_error, code="package.invalid_docx"))
    if inventory["malformed_rels"]:
        findings.append(_finding("package", "error", "Relationships OOXML malformadas", code="package.malformed_relationships", rels=inventory["malformed_rels"]))
    return findings, inventory, package_error


def _safe_comments_count(docx_bytes: bytes) -> int:
    try:
        with read_zip(docx_bytes) as archive:
            if "word/comments.xml" not in archive.namelist():
                return 0
            root = etree.fromstring(archive.read("word/comments.xml"))
        return len(root.xpath(".//w:comment", namespaces=NS))
    except Exception:
        return 0


def _audit_publication(docx_bytes: bytes) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    findings: list[dict[str, Any]] = []
    privacy: dict[str, Any] = {"metadata_present": False, "custom_properties": False}
    with read_zip(docx_bytes) as archive:
        names = set(archive.namelist())
        if "docProps/core.xml" in names:
            core = etree.fromstring(archive.read("docProps/core.xml"))
            for expr in (".//*[local-name()='creator']", ".//*[local-name()='lastModifiedBy']"):
                for node in core.xpath(expr):
                    if (node.text or "").strip():
                        privacy["metadata_present"] = True
        if "docProps/custom.xml" in names:
            privacy["custom_properties"] = True

    if privacy["metadata_present"]:
        findings.append(_finding("publication", "warning", "Metadata de autor/editor presente", code="publication.metadata_present", suggestion="Genera una copia limpia antes de entregar.", source="publishing", fixable=True))
    if privacy["custom_properties"]:
        findings.append(_finding("publication", "info", "Propiedades personalizadas presentes", code="publication.custom_properties_present", suggestion="Evalua si las propiedades personalizadas deben conservarse.", source="publishing", fixable=True))

    comments = _safe_comments_count(docx_bytes)
    if comments:
        findings.append(_finding("review", "warning", "Comentarios pendientes en el documento", code="review.comments_pending", suggestion="Resuelve o elimina comentarios antes de publicar.", source="review", fixable=True, count=comments))

    redlines = report_tracked_changes(docx_bytes)
    if redlines["tracked_change_count"]:
        findings.append(_finding("review", "warning", "Cambios controlados pendientes", code="review.tracked_changes_pending", suggestion="Acepta o rechaza redlines antes de entregar.", source="review", fixable=True, count=redlines["tracked_change_count"]))

    return findings, {"privacy": privacy, "redlines": redlines, "comments": comments}


def audit_docx_bytes(docx_bytes: bytes, *, artifact_id: str | None = None, profile: str = "quick") -> dict[str, Any]:
    normalized_profile = str(profile or "quick").strip().lower()
    if normalized_profile not in AUDIT_PROFILES:
        normalized_profile = "quick"

    findings: list[dict[str, Any]] = []
    field_counts: Counter[str] = Counter()
    package_findings, inventory, package_error = _audit_package(docx_bytes)
    findings.extend(package_findings)
    publication = {"privacy": {}, "redlines": {}, "comments": 0}

    if not package_error:
        for part in iter_story_parts(docx_bytes):
            part_findings, part_fields = _audit_story_part(part.name, part.root)
            findings.extend(part_findings)
            field_counts.update(part_fields)
        if normalized_profile in {"agent", "delivery", "publishing", "visual"}:
            publication_findings, publication = _audit_publication(docx_bytes)
            findings.extend(publication_findings)

    controls = inspect_content_controls(docx_bytes) if not package_error else {"controls": [], "placeholders": [], "control_count": 0, "placeholder_count": 0, "unwrapped_placeholder_count": 0}
    if controls["unwrapped_placeholder_count"]:
        findings.append(
            _finding(
                "content_controls",
                "warning",
                "Placeholders {{TAG}} sin control de contenido",
                code="content_controls.unwrapped_placeholders",
                suggestion="Envuelve placeholders en controles de contenido SDT para plantillas reutilizables.",
                source="content_controls",
                fixable=True,
                count=controls["unwrapped_placeholder_count"],
            )
        )

    field_report = report_fields(docx_bytes) if not package_error else {"items": [], "counts": {}, "field_count": 0}
    section_ids = ["package", "layout", "accessibility", "fields", "styles", "review", "publication", "content_controls"]
    sections = []
    for section_id in section_ids:
        section_findings = [item for item in findings if item.get("section") == section_id]
        sections.append(
            {
                "id": section_id,
                "status": section_status(section_findings),
                "findings": section_findings,
                "counts": summarize_findings(section_findings),
            }
        )

    counts = summarize_findings(findings)
    score = score_from_counts(counts)
    status = "error" if counts["error"] else ("warning" if counts["warning"] else "ok")
    return {
        "schema_version": 2,
        "artifact_id": artifact_id,
        "binary_hash": hashlib.sha256(docx_bytes).hexdigest(),
        "status": status,
        "quality_status": status,
        "score": score,
        "counts": counts,
        "findings": findings,
        "sections": sections,
        "profile": normalized_profile,
        "fields": dict(field_counts),
        "field_report": field_report,
        "content_controls": controls,
        "publication": publication,
        "package": inventory,
        "pages_rendered": None,
        "workbench_ready": True,
    }
