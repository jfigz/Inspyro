from __future__ import annotations

import base64
import io
from pathlib import Path
import sys
import zipfile
import xml.etree.ElementTree as ET

import pytest
from lxml import etree

sys.path.append(str(Path(__file__).resolve().parents[1]))

from app.services.pdf_converter import PDF_CONVERT_AVAILABLE, convert_docx_with_diagnostics
from librerias_propias.docx_builder.api import build_doc
from librerias_propias.docx_builder.latex_math import (
    LatexMathConverter,
    LatexMathInlineError,
    LatexMathScopeError,
)
from librerias_propias.docx_builder.session import get_session, reset_session_cache


DOCX_NS = {
    "m": "http://schemas.openxmlformats.org/officeDocument/2006/math",
    "w": "http://schemas.openxmlformats.org/wordprocessingml/2006/main",
}
M_VAL_ATTR = "{http://schemas.openxmlformats.org/officeDocument/2006/math}val"


@pytest.fixture(autouse=True)
def _reset_docx_sessions() -> None:
    reset_session_cache()
    yield
    reset_session_cache()


def _document_root(namespace: dict) -> ET.Element:
    session = get_session(namespace)
    raw = base64.b64decode(session.export_docx_base64())
    with zipfile.ZipFile(io.BytesIO(raw), "r") as zf:
        document_xml = zf.read("word/document.xml")
    return ET.fromstring(document_xml)


def _document_bytes(namespace: dict) -> bytes:
    session = get_session(namespace)
    return base64.b64decode(session.export_docx_base64())


def _paragraph_for_bookmark(root: ET.Element, bookmark_name: str) -> ET.Element | None:
    for paragraph in root.findall(".//w:p", DOCX_NS):
        for bookmark in paragraph.findall("./w:bookmarkStart", DOCX_NS):
            if bookmark.get("{http://schemas.openxmlformats.org/wordprocessingml/2006/main}name") == bookmark_name:
                return paragraph
    return None


def _omml_delimiter_operands(omml_element) -> list[list[str]]:
    namespace = {"m": DOCX_NS["m"]}
    root = etree.fromstring(etree.tostring(omml_element))
    return [
        ["".join(operand.itertext()) for operand in delimiter.findall("./m:e", namespace)]
        for delimiter in root.findall(".//m:d", namespace)
    ]


def test_math_latex_runtime_is_self_contained() -> None:
    runtime = LatexMathConverter().describe_runtime(force_refresh=True)
    assert runtime.available is True
    assert runtime.engine == "latex2mathml"
    assert runtime.version


def test_math_latex_supports_core_and_ams_expressions() -> None:
    namespace: dict = {}
    expressions = [
        r"\frac{a}{b}",
        r"\sqrt{x}",
        r"x_i^2",
        r"\int_0^\pi \sin(x)\,dx",
        r"\sum_{i=1}^{n} x_i",
        r"\begin{bmatrix}a & b\\c & d\end{bmatrix}",
        r"\begin{cases}x^2 & x > 0\\0 & x \le 0\end{cases}",
        r"\begin{aligned}M &= \frac{wL^2}{8}\\V &= \frac{wL}{2}\end{aligned}",
        r"F = \frac{qL}{2}\,\text{kN}",
        r"\begin{gather}a=b\\c=d\end{gather}",
    ]

    with build_doc(order=1, namespace=namespace, block_id="cell-latex-support") as builder:
        for expression in expressions:
            builder.math_latex(expression)

    document_root = _document_root(namespace)
    equations = document_root.findall(".//m:oMath", DOCX_NS)
    assert len(equations) == len(expressions)

    text = "".join(node.text or "" for node in document_root.findall(".//w:t", DOCX_NS))
    assert "[equation_latex error]" not in text


def test_math_latex_numbering_and_references() -> None:
    namespace: dict = {}

    with build_doc(order=1, namespace=namespace, block_id="cell-eq") as builder:
        builder.math_latex(r"\frac{a}{b}", label="eq:frac", number=True)

    with build_doc(order=2, namespace=namespace, block_id="cell-ref") as builder:
        builder.reference("eq:frac")

    document_root = _document_root(namespace)

    bookmark = document_root.find(".//w:bookmarkStart[@w:name='eq:frac']", DOCX_NS)
    assert bookmark is not None

    text = "".join(node.text or "" for node in document_root.findall(".//w:t", DOCX_NS))
    assert "(1)" in text

    ref_field = document_root.find(".//w:fldSimple[@w:instr='REF eq:frac \\h']", DOCX_NS)
    assert ref_field is not None


def test_math_latex_uses_stretchy_delimiters_for_matrices_and_cases() -> None:
    namespace: dict = {}

    with build_doc(order=1, namespace=namespace, block_id="cell-delims") as builder:
        builder.math_latex(
            r"\begin{bmatrix}a & b\\c & d\end{bmatrix}",
            label="eq:matrix",
            number=True,
        )
        builder.math_latex(
            r"\begin{cases}x^2 & x > 0\\0 & x \le 0\end{cases}",
            label="eq:cases",
            number=True,
        )

    document_root = _document_root(namespace)
    matrix_paragraph = _paragraph_for_bookmark(document_root, "eq:matrix")
    cases_paragraph = _paragraph_for_bookmark(document_root, "eq:cases")

    assert matrix_paragraph is not None
    assert cases_paragraph is not None

    matrix_delims = matrix_paragraph.findall(".//m:d", DOCX_NS)
    assert matrix_delims
    assert any(
        delim.find("./m:dPr/m:begChr", DOCX_NS) is not None
        and delim.find("./m:dPr/m:begChr", DOCX_NS).get(M_VAL_ATTR) == "["
        and delim.find("./m:dPr/m:endChr", DOCX_NS) is not None
        and delim.find("./m:dPr/m:endChr", DOCX_NS).get(M_VAL_ATTR) == "]"
        for delim in matrix_delims
    )

    cases_delims = cases_paragraph.findall(".//m:d", DOCX_NS)
    assert cases_delims
    assert any(
        delim.find("./m:dPr/m:begChr", DOCX_NS) is not None
        and delim.find("./m:dPr/m:begChr", DOCX_NS).get(M_VAL_ATTR) == "{"
        and delim.find("./m:dPr/m:endChr", DOCX_NS) is not None
        and delim.find("./m:dPr/m:endChr", DOCX_NS).get(M_VAL_ATTR) == ""
        for delim in cases_delims
    )


def test_math_latex_uses_stretchy_delimiters_for_left_right_unicode_fences() -> None:
    namespace: dict = {}

    with build_doc(order=1, namespace=namespace, block_id="cell-left-right") as builder:
        builder.math_latex(
            r"\left\langle \frac{a}{b}, \frac{c}{d} \right\rangle",
            label="eq:angles",
            number=True,
        )

    document_root = _document_root(namespace)
    angle_paragraph = _paragraph_for_bookmark(document_root, "eq:angles")

    assert angle_paragraph is not None

    angle_delims = angle_paragraph.findall(".//m:d", DOCX_NS)
    assert angle_delims
    assert any(
        delim.find("./m:dPr/m:begChr", DOCX_NS) is not None
        and delim.find("./m:dPr/m:begChr", DOCX_NS).get(M_VAL_ATTR) == "⟨"
        and delim.find("./m:dPr/m:endChr", DOCX_NS) is not None
        and delim.find("./m:dPr/m:endChr", DOCX_NS).get(M_VAL_ATTR) == "⟩"
        for delim in angle_delims
    )


def test_math_latex_left_right_keeps_grouped_expression_as_single_omml_operand() -> None:
    converter = LatexMathConverter()

    shear = converter.create_omml_element(
        r"\phi V_n=\phi\left(\min(V_{ci},V_{cw})+V_s\right)",
        inline=False,
    )
    shear_operands = _omml_delimiter_operands(shear)
    assert shear_operands
    assert shear_operands[0] == ["min(Vci,Vcw)+Vs"]

    flexure = converter.create_omml_element(
        r"\phi M_n=\phi A_{ps}f_{ps}\left(d_p-\frac{a}{2}\right)",
        inline=False,
    )
    flexure_operands = _omml_delimiter_operands(flexure)
    assert flexure_operands
    assert len(flexure_operands[0]) == 1
    assert "dp" in flexure_operands[0][0]
    assert "−" in flexure_operands[0][0]
    assert "a2" in flexure_operands[0][0]


def test_math_latex_left_right_matches_outer_close_after_nested_plain_parentheses() -> None:
    converter = LatexMathConverter()

    expression = converter.create_omml_element(r"\left(a+(b+c)+d\right)", inline=False)
    operands = _omml_delimiter_operands(expression)

    assert operands
    assert operands[0] == ["a+(b+c)+d"]


def test_math_latex_populates_nary_operands_in_omml() -> None:
    converter = LatexMathConverter()
    namespace = {"m": DOCX_NS["m"]}

    gauss = converter.create_omml_element(r"\sum_{i=1}^{n} i = \frac{n(n+1)}{2}", inline=False)
    gauss_root = etree.fromstring(etree.tostring(gauss))
    gauss_nary_operand = gauss_root.find(".//m:nary/m:e", namespace)
    assert gauss_nary_operand is not None
    assert len(gauss_nary_operand) > 0
    gauss_equals = gauss_root.xpath(".//m:nary/following-sibling::m:r[m:t='=']", namespaces=namespace)
    assert gauss_equals

    product = converter.create_omml_element(r"\prod_{i=1}^{n} \lambda_i = \det(\mathbf{K})", inline=False)
    product_root = etree.fromstring(etree.tostring(product))
    product_nary_operand = product_root.find(".//m:nary/m:e", namespace)
    assert product_nary_operand is not None
    assert len(product_nary_operand) > 0

    energy = converter.create_omml_element(r"U = \int_0^L \frac{M(x)^2}{2EI}\,dx", inline=False)
    energy_root = etree.fromstring(etree.tostring(energy))
    energy_nary_operand = energy_root.find(".//m:nary/m:e", namespace)
    assert energy_nary_operand is not None
    assert len(energy_nary_operand) > 0

    bracketed_sum = converter.create_omml_element(
        r"\left[ \frac{1}{1+x^2} + \sum_{k=1}^{n} \frac{1}{k^2} \right]",
        inline=False,
    )
    bracketed_sum_root = etree.fromstring(etree.tostring(bracketed_sum))
    bracketed_sum_nary_operand = bracketed_sum_root.find(".//m:nary/m:e", namespace)
    assert bracketed_sum_nary_operand is not None
    assert len(bracketed_sum_nary_operand) > 0
    assert bracketed_sum_nary_operand.find(".//m:f", namespace) is not None


def test_create_math_latex_element_supports_inline_paragraphs_and_tables() -> None:
    namespace: dict = {}

    with build_doc(order=1, namespace=namespace, block_id="cell-inline") as builder:
        paragraph = builder.document.add_paragraph("Formula: ")
        paragraph._p.append(builder.create_math_latex_element(r"\sqrt{x}"))
        table = builder.document.add_table(rows=1, cols=1)
        table.cell(0, 0).paragraphs[0]._p.append(builder.create_math_latex_element(r"x_i^2"))

    document_root = _document_root(namespace)
    equations = document_root.findall(".//m:oMath", DOCX_NS)
    assert len(equations) == 2


def test_math_latex_strips_math_delimiters() -> None:
    namespace: dict = {}

    with build_doc(order=1, namespace=namespace, block_id="cell-delimiters") as builder:
        builder.math_latex(r"$$\frac{a}{b}$$")
        builder.math_latex(r"\(\sqrt{x}\)")

    document_root = _document_root(namespace)
    equations = document_root.findall(".//m:oMath", DOCX_NS)
    assert len(equations) == 2


def test_math_latex_rejects_non_math_latex() -> None:
    namespace: dict = {}

    with build_doc(order=1, namespace=namespace, block_id="cell-scope") as builder:
        with pytest.raises(LatexMathScopeError):
            builder.create_math_latex_element(r"\section{Resultados}")


def test_create_math_latex_element_rejects_display_input() -> None:
    namespace: dict = {}

    with build_doc(order=1, namespace=namespace, block_id="cell-inline-display") as builder:
        with pytest.raises(LatexMathInlineError):
            builder.create_math_latex_element(r"\begin{aligned}M &= \frac{wL^2}{8}\\V &= \frac{wL}{2}\end{aligned}")


def test_math_legacy_still_generates_omml() -> None:
    namespace: dict = {}

    with build_doc(order=1, namespace=namespace, block_id="cell-legacy") as builder:
        builder.math("frac(a, b)")

    document_root = _document_root(namespace)
    equations = document_root.findall(".//m:oMath", DOCX_NS)
    assert len(equations) == 1
    assert document_root.find(".//m:f", DOCX_NS) is not None


@pytest.mark.skipif(not PDF_CONVERT_AVAILABLE, reason="Conversor PDF no disponible en este host.")
def test_pdf_converter_accepts_docx_with_latex_math() -> None:
    namespace: dict = {}

    with build_doc(order=1, namespace=namespace, block_id="cell-pdf") as builder:
        builder.math_latex(r"\frac{m c^2}{\sqrt{1 - \frac{v^2}{c^2}}}", label="eq:rel", number=True)

    result = convert_docx_with_diagnostics(base64.b64encode(_document_bytes(namespace)).decode("utf-8"), timeout_s=60)
    assert result.get("pdf_b64"), result
