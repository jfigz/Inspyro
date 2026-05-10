from __future__ import annotations

import argparse
import hashlib
import io
import json
import time
import uuid
import zipfile
import xml.etree.ElementTree as ET
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Any


W_NS = "http://schemas.openxmlformats.org/wordprocessingml/2006/main"
DOCX_NS = {"w": W_NS}
CONTENT_TYPE_DOCX = "application/vnd.openxmlformats-officedocument.wordprocessingml.document"


def _qn(tag: str) -> str:
    return f"{{{W_NS}}}{tag}"


def _sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def _write_zip_with_updates(docx_bytes: bytes, updates: dict[str, bytes]) -> bytes:
    buffer = io.BytesIO()
    with zipfile.ZipFile(io.BytesIO(docx_bytes), "r") as source:
        infos = source.infolist()
        with zipfile.ZipFile(buffer, "w", compression=zipfile.ZIP_DEFLATED) as target:
            written: set[str] = set()
            for info in infos:
                name = info.filename
                target.writestr(info, updates.get(name, source.read(name)))
                written.add(name)
            for name, payload in updates.items():
                if name not in written:
                    target.writestr(name, payload)
    return buffer.getvalue()


def read_docx_part(docx_bytes: bytes, part_name: str) -> bytes | None:
    try:
        with zipfile.ZipFile(io.BytesIO(docx_bytes), "r") as archive:
            return archive.read(part_name)
    except (KeyError, zipfile.BadZipFile):
        return None


def _serialize_xml(root: ET.Element) -> bytes:
    return ET.tostring(root, encoding="utf-8", xml_declaration=True)


def _w_element(tag: str, attrs: dict[str, Any] | None = None, text: str | None = None) -> ET.Element:
    element = ET.Element(_qn(tag))
    for key, value in (attrs or {}).items():
        element.set(_qn(key), str(value))
    if text is not None:
        element.text = text
    return element


def _append_if_missing(parent: ET.Element, tag: str, attrs: dict[str, Any] | None = None) -> ET.Element:
    child = parent.find(f"w:{tag}", DOCX_NS)
    if child is None:
        child = _w_element(tag, attrs)
        parent.append(child)
    elif attrs:
        for key, value in attrs.items():
            child.set(_qn(key), str(value))
    return child


def _remove_style(root: ET.Element, style_id: str) -> None:
    for style in list(root.findall("w:style", DOCX_NS)):
        if style.get(_qn("styleId")) == style_id:
            root.remove(style)


def _style_base(
    style_id: str,
    name: str,
    *,
    style_type: str = "paragraph",
    based_on: str | None = None,
    next_style: str | None = None,
    linked_style: str | None = None,
    ui_priority: int | None = None,
    q_format: bool = False,
    hidden: bool = False,
    semi_hidden: bool = False,
    unhide_when_used: bool = False,
) -> ET.Element:
    style = _w_element("style", {"type": style_type, "styleId": style_id})
    style.append(_w_element("name", {"val": name}))
    if based_on:
        style.append(_w_element("basedOn", {"val": based_on}))
    if next_style:
        style.append(_w_element("next", {"val": next_style}))
    if linked_style:
        style.append(_w_element("link", {"val": linked_style}))
    if ui_priority is not None:
        style.append(_w_element("uiPriority", {"val": ui_priority}))
    if hidden:
        style.append(_w_element("hidden"))
    if semi_hidden:
        style.append(_w_element("semiHidden"))
    if unhide_when_used:
        style.append(_w_element("unhideWhenUsed"))
    if q_format:
        style.append(_w_element("qFormat"))
    return style


def _run_props(
    *,
    font: str = "Aptos",
    color: str = "1B4965",
    size_half_points: int = 22,
    bold: bool = False,
    italic: bool = False,
    lang: str = "es-CL",
    kern: int = 16,
    spacing: int = 8,
    position: int = 0,
) -> ET.Element:
    rpr = _w_element("rPr")
    rpr.append(_w_element("rFonts", {"ascii": font, "hAnsi": font, "cs": font, "eastAsia": font}))
    rpr.append(_w_element("color", {"val": color}))
    rpr.append(_w_element("sz", {"val": size_half_points}))
    rpr.append(_w_element("szCs", {"val": size_half_points}))
    rpr.append(_w_element("lang", {"val": lang, "eastAsia": "es-CL", "bidi": "es-CL"}))
    rpr.append(_w_element("kern", {"val": kern}))
    rpr.append(_w_element("spacing", {"val": spacing}))
    rpr.append(_w_element("position", {"val": position}))
    if bold:
        rpr.append(_w_element("b"))
    if italic:
        rpr.append(_w_element("i"))
    return rpr


def _paragraph_props(
    *,
    alignment: str = "both",
    before: int = 120,
    after: int = 120,
    line: int = 276,
    first_line: int = 360,
    keep_next: bool = False,
    keep_lines: bool = False,
    contextual: bool = False,
) -> ET.Element:
    ppr = _w_element("pPr")
    ppr.append(_w_element("jc", {"val": alignment}))
    ppr.append(_w_element("spacing", {"before": before, "after": after, "line": line, "lineRule": "auto"}))
    ppr.append(_w_element("ind", {"firstLine": first_line}))
    tabs = _w_element("tabs")
    tabs.append(_w_element("tab", {"val": "right", "leader": "dot", "pos": 8640}))
    ppr.append(tabs)
    if keep_next:
        ppr.append(_w_element("keepNext"))
    if keep_lines:
        ppr.append(_w_element("keepLines"))
    if contextual:
        ppr.append(_w_element("contextualSpacing"))
    return ppr


def _table_style_props() -> ET.Element:
    style = _style_base(
        "BankTableAccent",
        "Bank Table Accent",
        style_type="table",
        based_on="TableGrid",
        ui_priority=42,
        q_format=True,
    )
    tbl_pr = _w_element("tblPr")
    tbl_pr.append(_w_element("tblStyleColBandSize", {"val": 1}))
    tbl_pr.append(_w_element("tblStyleRowBandSize", {"val": 1}))
    tbl_pr.append(_w_element("tblW", {"w": 0, "type": "auto"}))
    tbl_pr.append(_w_element("jc", {"val": "center"}))
    borders = _w_element("tblBorders")
    for side in ("top", "left", "bottom", "right", "insideH", "insideV"):
        borders.append(_w_element(side, {"val": "single", "sz": 8, "space": 0, "color": "1B4965"}))
    tbl_pr.append(borders)
    tbl_pr.append(_w_element("shd", {"val": "clear", "fill": "F4F8FB"}))
    tbl_pr.append(_w_element("tblLook", {"firstRow": 1, "lastRow": 0, "firstColumn": 1, "lastColumn": 0, "noHBand": 0, "noVBand": 1, "val": "04A0"}))
    style.append(tbl_pr)
    first_row = _w_element("tblStylePr", {"type": "firstRow"})
    first_row_rpr = _run_props(font="Aptos Display", color="FFFFFF", bold=True, size_half_points=21)
    first_row_ppr = _paragraph_props(alignment="center", before=80, after=80, first_line=0)
    first_row_tblpr = _w_element("tcPr")
    first_row_tblpr.append(_w_element("shd", {"val": "clear", "fill": "1B4965"}))
    first_row.append(first_row_ppr)
    first_row.append(first_row_rpr)
    first_row.append(first_row_tblpr)
    style.append(first_row)
    return style


def _ensure_doc_defaults(root: ET.Element) -> None:
    defaults = root.find("w:docDefaults", DOCX_NS)
    if defaults is None:
        defaults = _w_element("docDefaults")
        root.insert(0, defaults)
    r_default = _append_if_missing(defaults, "rPrDefault")
    rpr = r_default.find("w:rPr", DOCX_NS)
    if rpr is None:
        rpr = _w_element("rPr")
        r_default.append(rpr)
    _append_if_missing(rpr, "rFonts", {"ascii": "Aptos", "hAnsi": "Aptos", "cs": "Aptos"})
    _append_if_missing(rpr, "sz", {"val": 22})
    _append_if_missing(rpr, "lang", {"val": "es-CL", "eastAsia": "es-CL", "bidi": "es-CL"})
    p_default = _append_if_missing(defaults, "pPrDefault")
    ppr = p_default.find("w:pPr", DOCX_NS)
    if ppr is None:
        ppr = _w_element("pPr")
        p_default.append(ppr)
    _append_if_missing(ppr, "spacing", {"after": 160, "line": 276, "lineRule": "auto"})


def _inject_styles(
    docx_bytes: bytes,
    *,
    localized: bool = False,
    word_complete: bool = False,
    duplicate_styles: bool = True,
    hidden_styles: bool = True,
) -> bytes:
    styles_payload = read_docx_part(docx_bytes, "word/styles.xml")
    if not styles_payload:
        return docx_bytes
    root = ET.fromstring(styles_payload)
    _ensure_doc_defaults(root)

    for style_id in (
        "BankBody",
        "BankHeading",
        "BankHiddenInternal",
        "BankDuplicateA",
        "BankDuplicateB",
        "BankTableAccent",
        "BancoTextoBase",
        "BancoTitulo",
        "BankWordComplete",
        "Code",
        "Caption",
    ):
        _remove_style(root, style_id)

    body = _style_base("BankBody", "Bank Body", based_on="Normal", next_style="BankBody", ui_priority=10, q_format=True)
    body.append(_paragraph_props(alignment="both", contextual=True))
    body.append(_run_props(font="Aptos", color="243447", size_half_points=22))
    root.append(body)

    caption = _style_base("Caption", "Caption", based_on="Normal", ui_priority=35, q_format=True)
    caption.append(_paragraph_props(alignment="center", before=60, after=100, first_line=0))
    caption.append(_run_props(font="Aptos", color="5C677D", size_half_points=20, italic=True))
    root.append(caption)

    heading = _style_base(
        "BankHeading",
        "Bank Heading",
        based_on="Heading1",
        next_style="BankBody",
        linked_style="BankHeadingChar",
        ui_priority=4,
        q_format=True,
    )
    heading.append(_paragraph_props(alignment="left", before=240, after=120, first_line=0, keep_next=True, keep_lines=True))
    heading.append(_run_props(font="Aptos Display", color="0B5563", size_half_points=32, bold=True))
    root.append(heading)

    if hidden_styles:
        hidden = _style_base(
            "BankHiddenInternal",
            "Bank Hidden Internal",
            based_on="Normal",
            ui_priority=99,
            hidden=True,
            semi_hidden=True,
            unhide_when_used=True,
        )
        hidden.append(_run_props(font="Courier New", color="666666", size_half_points=18))
        root.append(hidden)

    if duplicate_styles:
        duplicate_a = _style_base("BankDuplicateA", "Bank Duplicate", based_on="Normal", ui_priority=61)
        duplicate_a.append(_run_props(font="Aptos", color="5C677D"))
        root.append(duplicate_a)
        duplicate_b = _style_base("BankDuplicateB", "Bank Duplicate", based_on="Normal", ui_priority=62)
        duplicate_b.append(_run_props(font="Aptos", color="9B2226", italic=True))
        root.append(duplicate_b)

    root.append(_table_style_props())

    code = _style_base("Code", "Code", based_on="Normal", ui_priority=33, q_format=True)
    code.append(_paragraph_props(alignment="left", before=80, after=80, first_line=0))
    code.append(_run_props(font="Consolas", color="2D3748", size_half_points=20))
    root.append(code)

    if localized:
        localized_body = _style_base("BancoTextoBase", "Texto independiente banco", based_on="Normal", ui_priority=22, q_format=True)
        localized_body.append(_paragraph_props(alignment="left", before=0, after=100, first_line=240))
        localized_body.append(_run_props(font="Arial", color="264653", lang="es-CL"))
        root.append(localized_body)
        localized_heading = _style_base("BancoTitulo", "Titulo Banco", based_on="Heading2", next_style="BancoTextoBase", ui_priority=12, q_format=True)
        localized_heading.append(_paragraph_props(alignment="left", before=200, after=100, first_line=0, keep_next=True))
        localized_heading.append(_run_props(font="Arial", color="2A9D8F", size_half_points=28, bold=True))
        root.append(localized_heading)

    if word_complete:
        advanced = _style_base(
            "BankWordComplete",
            "Bank Word Complete",
            based_on="BankBody",
            next_style="BankBody",
            linked_style="BankWordCompleteChar",
            ui_priority=3,
            q_format=True,
            unhide_when_used=True,
        )
        advanced_rpr = _run_props(
            font="Aptos",
            color="3A0CA3",
            size_half_points=23,
            bold=True,
            lang="es-CL",
            kern=24,
            spacing=18,
            position=2,
        )
        advanced_rpr.append(_w_element("u", {"val": "single"}))
        advanced_ppr = _paragraph_props(
            alignment="both",
            before=160,
            after=180,
            line=300,
            first_line=360,
            keep_next=True,
            keep_lines=True,
            contextual=True,
        )
        advanced_ppr.append(_w_element("textAlignment", {"val": "center"}))
        advanced_ppr.append(_w_element("bidi", {"val": 0}))
        advanced_ppr.append(_w_element("shd", {"val": "clear", "color": "auto", "fill": "F2F2F2"}))
        p_bdr = _w_element("pBdr")
        p_bdr.append(_w_element("bottom", {"val": "single", "sz": 8, "space": 1, "color": "1B4965"}))
        advanced_ppr.append(p_bdr)
        advanced.append(advanced_ppr)
        advanced.append(advanced_rpr)
        advanced.append(_w_element("rsid", {"val": "00E12ABC"}))
        root.append(advanced)

    return _write_zip_with_updates(docx_bytes, {"word/styles.xml": _serialize_xml(root)})


def _inject_content_control(docx_bytes: bytes) -> bytes:
    document_payload = read_docx_part(docx_bytes, "word/document.xml")
    if not document_payload:
        return docx_bytes
    root = ET.fromstring(document_payload)
    body = root.find("w:body", DOCX_NS)
    if body is None:
        return docx_bytes
    if root.find(".//w:sdt", DOCX_NS) is not None:
        return docx_bytes

    sdt = _w_element("sdt")
    sdt_pr = _w_element("sdtPr")
    sdt_pr.append(_w_element("alias", {"val": "Client Name"}))
    sdt_pr.append(_w_element("tag", {"val": "CLIENT_NAME"}))
    sdt.append(sdt_pr)
    content = _w_element("sdtContent")
    paragraph = _w_element("p")
    run = _w_element("r")
    text = _w_element("t", text="{{CLIENT_NAME}}")
    run.append(text)
    paragraph.append(run)
    content.append(paragraph)
    sdt.append(content)

    sect_pr = body.find("w:sectPr", DOCX_NS)
    insert_at = list(body).index(sect_pr) if sect_pr is not None else len(list(body))
    body.insert(insert_at, sdt)
    return _write_zip_with_updates(docx_bytes, {"word/document.xml": _serialize_xml(root)})


def _base_document_bytes(*, title: str, localized: bool = False, multipage: bool = False) -> bytes:
    docx = __import__("docx")
    document = docx.Document()
    section = document.sections[0]
    section.header.paragraphs[0].text = f"{title} header"
    section.footer.paragraphs[0].text = f"{title} footer"

    document.add_heading(title, level=1)
    document.add_paragraph("Cliente: {{CLIENT_NAME}}")
    document.add_paragraph("Parrafo base para estilos de texto, listas, captions y tablas.")
    list_style = "List Bullet" if not localized else "List Bullet"
    for item in ("Carga permanente", "Sobrecarga", "Combinacion mayorada"):
        document.add_paragraph(item, style=list_style)
    table = document.add_table(rows=4, cols=3)
    table.style = "Table Grid"
    for row_idx, row in enumerate(table.rows):
        for col_idx, cell in enumerate(row.cells):
            cell.text = f"R{row_idx + 1}C{col_idx + 1}"
    document.add_paragraph("Tabla 1: Resumen de cargas", style="Caption")
    if multipage:
        for idx in range(32):
            document.add_paragraph(
                f"Bloque multipagina {idx + 1}: contenido repetido para forzar saltos y validar headers/footers."
            )
    buffer = io.BytesIO()
    document.save(buffer)
    return buffer.getvalue()


def build_minimal_template() -> bytes:
    return _base_document_bytes(title="Template Bank Minimal")


def build_complete_template() -> bytes:
    docx_bytes = _base_document_bytes(title="Template Bank Complete", multipage=True)
    docx_bytes = _inject_styles(docx_bytes, duplicate_styles=True, hidden_styles=True)
    return _inject_content_control(docx_bytes)


def build_localized_template() -> bytes:
    docx_bytes = _base_document_bytes(title="Banco de Plantillas Localizado", localized=True)
    docx_bytes = _inject_styles(docx_bytes, localized=True, duplicate_styles=True, hidden_styles=True)
    return _inject_content_control(docx_bytes)


def build_word_complete_template() -> bytes:
    docx_bytes = _base_document_bytes(title="Template Bank Word Complete", multipage=True)
    docx_bytes = _inject_styles(docx_bytes, localized=True, word_complete=True, duplicate_styles=True, hidden_styles=True)
    return _inject_content_control(docx_bytes)


def build_corrupt_docx_bytes() -> bytes:
    return b"not-a-docx-template-bank"


def inspect_docx_ooxml(docx_bytes: bytes) -> dict[str, Any]:
    result: dict[str, Any] = {
        "is_zip": False,
        "parts": [],
        "style_ids": [],
        "style_names": [],
        "hidden_style_ids": [],
        "semi_hidden_style_ids": [],
        "q_format_style_ids": [],
        "has_doc_defaults": False,
        "has_numbering": False,
        "header_parts": [],
        "footer_parts": [],
        "table_count": 0,
        "sdt_count": 0,
        "placeholder_count": 0,
        "has_table_style": False,
        "has_word_complete_style": False,
        "has_duplicate_style_names": False,
        "errors": [],
    }
    try:
        with zipfile.ZipFile(io.BytesIO(docx_bytes), "r") as archive:
            names = archive.namelist()
            result["is_zip"] = True
            result["parts"] = names
            result["has_numbering"] = "word/numbering.xml" in names
            result["header_parts"] = sorted(name for name in names if name.startswith("word/header") and name.endswith(".xml"))
            result["footer_parts"] = sorted(name for name in names if name.startswith("word/footer") and name.endswith(".xml"))

            if "word/styles.xml" in names:
                styles_root = ET.fromstring(archive.read("word/styles.xml"))
                result["has_doc_defaults"] = styles_root.find("w:docDefaults", DOCX_NS) is not None
                style_names: list[str] = []
                for style in styles_root.findall("w:style", DOCX_NS):
                    style_id = style.get(_qn("styleId")) or ""
                    name = style.find("w:name", DOCX_NS)
                    style_name = name.get(_qn("val")) if name is not None else ""
                    if style_id:
                        result["style_ids"].append(style_id)
                    if style_name:
                        style_names.append(style_name)
                        result["style_names"].append(style_name)
                    if style.find("w:hidden", DOCX_NS) is not None:
                        result["hidden_style_ids"].append(style_id)
                    if style.find("w:semiHidden", DOCX_NS) is not None:
                        result["semi_hidden_style_ids"].append(style_id)
                    if style.find("w:qFormat", DOCX_NS) is not None:
                        result["q_format_style_ids"].append(style_id)
                result["has_table_style"] = "BankTableAccent" in result["style_ids"]
                result["has_word_complete_style"] = "BankWordComplete" in result["style_ids"]
                result["has_duplicate_style_names"] = len(style_names) != len(set(style_names))

            if "word/document.xml" in names:
                document_root = ET.fromstring(archive.read("word/document.xml"))
                result["table_count"] = len(document_root.findall(".//w:tbl", DOCX_NS))
                result["sdt_count"] = len(document_root.findall(".//w:sdt", DOCX_NS))
                texts = [node.text or "" for node in document_root.findall(".//w:t", DOCX_NS)]
                result["placeholder_count"] = sum(text.count("{{") for text in texts)
    except zipfile.BadZipFile as exc:
        result["errors"].append(f"bad_zip:{exc}")
    except Exception as exc:  # pragma: no cover - diagnostics should not hide the cause.
        result["errors"].append(f"inspect_error:{exc}")
    return result


@dataclass(frozen=True)
class TemplateBankFixture:
    id: str
    kind: str
    file_name: str
    path: str
    sha256: str
    size_bytes: int
    expected: dict[str, Any]


def write_fixture_corpus(output_dir: Path) -> dict[str, Any]:
    output_dir.mkdir(parents=True, exist_ok=True)
    builders = [
        ("minimal", "minimal", "template-bank-minimal.docx", build_minimal_template),
        ("complete", "complete", "template-bank-complete.docx", build_complete_template),
        ("localized", "localized", "template-bank-localized.docx", build_localized_template),
        ("word_complete", "word_complete", "template-bank-word-complete.docx", build_word_complete_template),
        ("corrupt", "corrupt", "template-bank-corrupt.docx", build_corrupt_docx_bytes),
    ]
    fixtures: list[TemplateBankFixture] = []
    for fixture_id, kind, file_name, builder in builders:
        payload = builder()
        path = output_dir / file_name
        path.write_bytes(payload)
        inspection = inspect_docx_ooxml(payload)
        fixtures.append(
            TemplateBankFixture(
                id=fixture_id,
                kind=kind,
                file_name=file_name,
                path=str(path),
                sha256=_sha256(payload),
                size_bytes=len(payload),
                expected={
                    "ooxml": inspection,
                    "must_load": kind != "corrupt",
                    "has_hidden_styles": kind in {"complete", "localized", "word_complete"},
                    "has_duplicate_styles": kind in {"complete", "localized", "word_complete"},
                    "has_sdt": kind in {"complete", "localized", "word_complete"},
                    "has_headers_footers": kind != "corrupt",
                    "has_word_complete_style": kind == "word_complete",
                },
            )
        )

    manifest = {
        "schema_version": "template-editor-bank-fixtures@1",
        "generated_at": int(time.time()),
        "fixtures": [asdict(fixture) for fixture in fixtures],
    }
    (output_dir / "manifest.json").write_text(json.dumps(manifest, indent=2), encoding="utf-8")
    return manifest


class TemplateBankReport:
    def __init__(self, output_dir: Path, *, run_id: str | None = None, title: str = "Template Editor Bank") -> None:
        self.run_id = run_id or time.strftime("%Y%m%d-%H%M%S") + "-" + uuid.uuid4().hex[:8]
        self.output_dir = output_dir / self.run_id
        self.output_dir.mkdir(parents=True, exist_ok=True)
        self.title = title
        self.scenarios: list[dict[str, Any]] = []
        self.started_at = time.time()

    def add(
        self,
        name: str,
        status: str,
        *,
        fixture: str | None = None,
        details: dict[str, Any] | None = None,
        artifacts: dict[str, Any] | None = None,
    ) -> None:
        self.scenarios.append(
            {
                "name": name,
                "status": status,
                "fixture": fixture,
                "details": details or {},
                "artifacts": artifacts or {},
                "finished_at": int(time.time()),
            }
        )

    def write(self) -> dict[str, str]:
        status_counts: dict[str, int] = {}
        for scenario in self.scenarios:
            status = str(scenario.get("status") or "unknown")
            status_counts[status] = status_counts.get(status, 0) + 1
        payload = {
            "schema_version": "template-editor-bank-report@1",
            "title": self.title,
            "run_id": self.run_id,
            "started_at": int(self.started_at),
            "finished_at": int(time.time()),
            "status_counts": status_counts,
            "scenarios": self.scenarios,
        }
        summary_json = self.output_dir / "summary.json"
        summary_md = self.output_dir / "summary.md"
        summary_json.write_text(json.dumps(payload, indent=2, ensure_ascii=False), encoding="utf-8")
        lines = [
            f"# {self.title}",
            "",
            f"- Run id: `{self.run_id}`",
            f"- Scenarios: {len(self.scenarios)}",
            f"- Status: {', '.join(f'{key}={value}' for key, value in sorted(status_counts.items())) or 'none'}",
            "",
            "| Scenario | Fixture | Status | Artifact | Notes |",
            "|---|---:|---:|---|---|",
        ]
        for scenario in self.scenarios:
            artifact = scenario.get("artifacts", {}).get("artifact_id") or scenario.get("artifacts", {}).get("docx_path") or ""
            details = scenario.get("details") or {}
            note = details.get("reason") or details.get("summary") or details.get("message") or ""
            lines.append(
                "| {name} | {fixture} | {status} | {artifact} | {note} |".format(
                    name=str(scenario.get("name") or "").replace("|", "\\|"),
                    fixture=str(scenario.get("fixture") or "").replace("|", "\\|"),
                    status=str(scenario.get("status") or "").replace("|", "\\|"),
                    artifact=str(artifact).replace("|", "\\|"),
                    note=str(note).replace("|", "\\|"),
                )
            )
        summary_md.write_text("\n".join(lines) + "\n", encoding="utf-8")
        return {"summary_json": str(summary_json), "summary_md": str(summary_md)}


def _main() -> int:
    parser = argparse.ArgumentParser(description="Generate and inspect Template Editor bank fixtures.")
    parser.add_argument("--write", type=Path, help="Output directory for the synthetic DOCX corpus.")
    parser.add_argument("--inspect-docx", type=Path, help="Inspect one DOCX and print an OOXML JSON summary.")
    parser.add_argument("--quiet", action="store_true", help="Do not print the generated manifest for --write.")
    args = parser.parse_args()

    if args.write:
        manifest = write_fixture_corpus(args.write)
        if not args.quiet:
            print(json.dumps(manifest, indent=2))
        return 0

    if args.inspect_docx:
        print(json.dumps(inspect_docx_ooxml(args.inspect_docx.read_bytes()), indent=2))
        return 0

    parser.error("Use --write or --inspect-docx")
    return 2


if __name__ == "__main__":
    raise SystemExit(_main())
