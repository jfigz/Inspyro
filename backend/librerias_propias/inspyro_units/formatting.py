# -*- coding: utf-8 -*-
"""
Formateadores de ``pint.Quantity`` para distintos contextos de salida:
LaTeX, Unicode/plain text, HTML y DOCX (python-docx runs).
"""

from __future__ import annotations

import re

# Caracteres Unicode de superindice que pueden aparecer en unidades pint.
_SUPERSCRIPT_CHARS = {
    "\u2070": "0",
    "\u00b9": "1",
    "\u00b2": "2",
    "\u00b3": "3",
    "\u2074": "4",
    "\u2075": "5",
    "\u2076": "6",
    "\u2077": "7",
    "\u2078": "8",
    "\u2079": "9",
    "\u207b": "-",
}

_DIGIT_TO_SUPERSCRIPT = {
    "0": "\u2070",
    "1": "\u00b9",
    "2": "\u00b2",
    "3": "\u00b3",
    "4": "\u2074",
    "5": "\u2075",
    "6": "\u2076",
    "7": "\u2077",
    "8": "\u2078",
    "9": "\u2079",
    "-": "\u207b",
}

_CARET_EXP_RE = re.compile(r"\^(-?\d+)")


def format_quantity_latex(q) -> str:
    """
    Formatea una Quantity para renderizado LaTeX en el notebook.

    Ejemplo: ``14.5\\;\\mathrm{kN}``
    """
    mag = q.magnitude
    try:
        unit_latex = f"{q.units:~L}"
    except Exception:
        unit_latex = f"\\mathrm{{{q.units:~P}}}"
    return f"{mag}\\;{unit_latex}"


def format_quantity_unicode(q) -> str:
    """
    Formatea una Quantity para display text con Unicode (superindices).

    Ejemplo: ``14.5 kN``, ``3.2 m/s²``
    """
    return f"{q:~P}"


def format_quantity_html(q) -> str:
    """
    Formatea una Quantity en HTML con tags <sup> para exponentes.

    Ejemplo: ``14.5 m/s<sup>2</sup>``
    """
    mag = q.magnitude
    try:
        unit_html = f"{q.units:~H}"
    except Exception:
        unit_html = f"{q.units:~P}"
    return f"{mag} {unit_html}"


def format_quantity_docx(q) -> dict:
    """
    Retorna estructura para doc_block DOCX con formato tipografico.

    Retorna un dict con:
    - ``magnitude``: valor numerico
    - ``unit_runs``: lista de runs con text, italic, superscript
    """
    return {
        "magnitude": q.magnitude,
        "unit_runs": _build_docx_runs(q.units),
    }


def build_docx_unit_runs(unit_text: str) -> list[dict]:
    """
    Convierte una unidad textual en runs DOCX (italic + superscript).

    Soporta exponentes en notacion unicode (``m/s²``), caret (``m/s^2``)
    y python style (``m/s**2``).
    """
    if unit_text is None:
        return []

    normalized = str(unit_text).strip()
    if not normalized:
        return []

    normalized = normalized.replace("**", "^")

    def _caret_to_super(match: re.Match) -> str:
        exp = match.group(1)
        return "".join(_DIGIT_TO_SUPERSCRIPT.get(ch, ch) for ch in exp)

    normalized = _CARET_EXP_RE.sub(_caret_to_super, normalized)

    runs: list[dict] = []
    for ch in normalized:
        if ch in _SUPERSCRIPT_CHARS:
            _append_run(runs, text=_SUPERSCRIPT_CHARS[ch], italic=True, superscript=True)
        else:
            _append_run(runs, text=ch, italic=True, superscript=False)

    return runs if runs else [{"text": normalized, "italic": True}]


def _build_docx_runs(units) -> list[dict]:
    """
    Genera runs de python-docx para una unidad compuesta.
    """
    try:
        unit_str = f"{units:~P}"
    except Exception:
        unit_str = str(units)
    return build_docx_unit_runs(unit_str)


def _append_run(runs: list[dict], *, text: str, italic: bool, superscript: bool) -> None:
    if not text:
        return

    if runs:
        last = runs[-1]
        last_sup = bool(last.get("superscript"))
        if last_sup == superscript and bool(last.get("italic")) == italic:
            last["text"] += text
            return

    run = {"text": text, "italic": italic}
    if superscript:
        run["superscript"] = True
    runs.append(run)
