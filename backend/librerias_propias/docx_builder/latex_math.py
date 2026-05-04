"""LaTeX math to OMML conversion helpers for the DOCX builder."""

from __future__ import annotations

from collections import OrderedDict
from dataclasses import dataclass
import logging
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
import threading
from typing import Optional

try:
    from lxml import etree
    HAS_LXML = True
except Exception:  # pragma: no cover - defensive fallback
    etree = None  # type: ignore[assignment]
    HAS_LXML = False

try:
    import latex2mathml
    from latex2mathml.converter import convert as latex2mathml_convert
    HAS_LATEX2MATHML = True
except Exception:  # pragma: no cover - defensive fallback
    latex2mathml = None  # type: ignore[assignment]
    latex2mathml_convert = None  # type: ignore[assignment]
    HAS_LATEX2MATHML = False


_logger = logging.getLogger(__name__)

_TEXMATH_ENV = "INSPYRO_TEXMATH_PATH"
_TEXMATH_TIMEOUT_ENV = "INSPYRO_DOCX_LATEX_TIMEOUT"
_DEFAULT_TIMEOUT_S = 15.0
_DEFAULT_CACHE_SIZE = 256
_RESOURCE_DIR = Path(__file__).resolve().parent / "resources"
_MML2OMML_XSL = _RESOURCE_DIR / "mml2omml.xsl"
_MML2OMML_WRAPPER_XSL = _RESOURCE_DIR / "mml2omml_wrapper.xsl"
_BIN_DIR = Path(__file__).resolve().parent / "bin"
_BUNDLED_TEXMATH = _BIN_DIR / ("texmath.exe" if os.name == "nt" else "texmath")

_ALLOWED_ENVIRONMENTS = {
    "align",
    "align*",
    "alignat",
    "alignat*",
    "aligned",
    "alignedat",
    "array",
    "Bmatrix",
    "bmatrix",
    "cases",
    "displaymath",
    "eqnarray",
    "eqnarray*",
    "equation",
    "equation*",
    "flalign",
    "flalign*",
    "gather",
    "gather*",
    "matrix",
    "multline",
    "multline*",
    "pmatrix",
    "smallmatrix",
    "split",
    "subarray",
    "Vmatrix",
    "vmatrix",
}
_INLINE_BLOCK_ENVIRONMENTS = {
    "align",
    "align*",
    "alignat",
    "alignat*",
    "aligned",
    "alignedat",
    "displaymath",
    "eqnarray",
    "eqnarray*",
    "equation",
    "equation*",
    "flalign",
    "flalign*",
    "gather",
    "gather*",
    "multline",
    "multline*",
    "split",
}
_FORBIDDEN_COMMANDS = {
    "author",
    "bibliography",
    "bibliographystyle",
    "caption",
    "chapter",
    "cite",
    "date",
    "def",
    "documentclass",
    "emph",
    "footnote",
    "href",
    "include",
    "includegraphics",
    "input",
    "item",
    "label",
    "maketitle",
    "newcommand",
    "newenvironment",
    "pageref",
    "paragraph",
    "part",
    "ref",
    "renewcommand",
    "renewenvironment",
    "section",
    "subparagraph",
    "subsection",
    "subsubsection",
    "tableofcontents",
    "textbf",
    "textit",
    "tikz",
    "title",
    "url",
    "usepackage",
}
_BEGIN_ENV_RE = re.compile(r"\\begin\{([A-Za-z*]+)\}")
_COMMAND_RE = re.compile(r"\\([A-Za-z]+)")
_DISPLAY_DOLLAR_RE = re.compile(r"^\$\$(.*)\$\$$", re.DOTALL)
_DISPLAY_BRACKET_RE = re.compile(r"^\\\[(.*)\\\]$", re.DOTALL)
_INLINE_PAREN_RE = re.compile(r"^\\\((.*)\\\)$", re.DOTALL)
_INLINE_DOLLAR_RE = re.compile(r"^\$(.*)\$$", re.DOTALL)
_DOUBLE_BACKSLASH_RE = re.compile(r"(^|[^\\])\\\\($|[^\\])")
_RAW_AMPERSAND_RE = re.compile(r"&(?!#?[A-Za-z0-9]+;)")
_MATHML_NS = "http://www.w3.org/1998/Math/MathML"
_MATHML_TAG = f"{{{_MATHML_NS}}}"
_OMML_NS = "http://schemas.openxmlformats.org/officeDocument/2006/math"
_OMML_TAG = f"{{{_OMML_NS}}}"
_OMML_VAL_ATTR = f"{{{_OMML_NS}}}val"
_MATRIX_DELIMITER_PAIRS = {
    "(": ")",
    "[": "]",
    "{": "}",
    "|": "|",
    "‖": "‖",
    "⟨": "⟩",
}
_LEFT_ONLY_DELIMITERS = {"{"}
_DEFAULT_MFENCED_OPEN = "("
_DEFAULT_MFENCED_CLOSE = ")"
_NARY_BOUNDARY_CHARS = {"=", "<", ">", "≤", "≥", "≈", "≠", "∼", "→", "↦"}


class LatexMathError(ValueError):
    """Base error for the LaTeX math pipeline."""


class LatexMathScopeError(LatexMathError):
    """Raised when the input is not math-only LaTeX."""


class LatexMathUnavailableError(LatexMathError):
    """Raised when no LaTeX math backend or OMML transform is available."""


class LatexMathTimeoutError(LatexMathError):
    """Raised when a subprocess-based fallback backend exceeds its timeout."""


class LatexMathParseError(LatexMathError):
    """Raised when the configured LaTeX math backend cannot parse the expression."""


class LatexMathInlineError(LatexMathError):
    """Raised when inline conversion receives display-only input."""


class LatexMathTransformError(LatexMathError):
    """Raised when MathML cannot be transformed to OMML."""


@dataclass(frozen=True)
class LatexMathRuntime:
    available: bool
    engine: str | None = None
    command: tuple[str, ...] | None = None
    texmath_path: str | None = None
    xsl_path: str | None = None
    version: str | None = None
    reason: str | None = None


class LatexMathConverter:
    """Converts math-only LaTeX expressions to OMML."""

    def __init__(self, *, timeout_s: Optional[float] = None, cache_size: int = _DEFAULT_CACHE_SIZE):
        self.timeout_s = timeout_s if timeout_s is not None else _read_timeout()
        self.cache_size = max(1, int(cache_size))
        self._cache: OrderedDict[tuple[str, bool], bytes] = OrderedDict()
        self._cache_lock = threading.Lock()
        self._runtime_lock = threading.Lock()
        self._runtime: Optional[LatexMathRuntime] = None
        self._transform_lock = threading.Lock()
        self._transform = None

    def describe_runtime(self, *, force_refresh: bool = False) -> LatexMathRuntime:
        if not force_refresh and self._runtime is not None:
            return self._runtime
        with self._runtime_lock:
            if not force_refresh and self._runtime is not None:
                return self._runtime
            runtime = self._probe_runtime()
            self._runtime = runtime
            return runtime

    def create_omml_element(self, expression: str, *, inline: bool = False):
        normalized = _normalize_expression(expression, inline=inline)
        cache_key = (normalized, inline)
        cached = self._cache_get(cache_key)
        if cached is not None:
            return etree.fromstring(cached)

        runtime = self.describe_runtime()
        if not runtime.available:
            raise LatexMathUnavailableError(runtime.reason or "LaTeX math converter unavailable")

        if runtime.engine == "latex2mathml":
            mathml = self._run_latex2mathml(normalized, inline=inline)
        else:
            mathml = self._run_texmath(runtime, normalized, inline=inline)
        omml_bytes = self._mathml_to_omml(mathml)
        self._cache_put(cache_key, omml_bytes)
        return etree.fromstring(omml_bytes)

    def _probe_runtime(self) -> LatexMathRuntime:
        if not HAS_LXML:
            return LatexMathRuntime(
                available=False,
                reason="lxml no disponible; MathML -> OMML no puede inicializarse.",
            )
        if not _MML2OMML_XSL.exists():
            return LatexMathRuntime(
                available=False,
                reason=f"No se encontro el transformador MathML -> OMML en '{_MML2OMML_XSL}'.",
            )
        if not _MML2OMML_WRAPPER_XSL.exists():
            return LatexMathRuntime(
                available=False,
                reason=f"No se encontro el wrapper MathML -> OMML en '{_MML2OMML_WRAPPER_XSL}'.",
            )
        if HAS_LATEX2MATHML:
            return LatexMathRuntime(
                available=True,
                engine="latex2mathml",
                xsl_path=str(_MML2OMML_WRAPPER_XSL),
                version=getattr(latex2mathml, "__version__", None),
            )

        resolved = _resolve_texmath_command()
        if resolved is None:
            return LatexMathRuntime(
                available=False,
                xsl_path=str(_MML2OMML_XSL),
                reason=(
                    "No se encontro ningun backend LaTeX disponible. El runtime autosuficiente espera "
                    "la libreria vendorizada latex2mathml; como fallback de desarrollo puede usar texmath "
                    "via INSPYRO_TEXMATH_PATH o PATH."
                ),
            )

        command, texmath_path = resolved
        try:
            probe = subprocess.run(
                [*command, "-V"],
                capture_output=True,
                text=True,
                encoding="utf-8",
                timeout=min(max(float(self.timeout_s), 1.0), 5.0),
                check=False,
            )
        except FileNotFoundError as exc:
            return LatexMathRuntime(
                available=False,
                engine="texmath",
                command=tuple(command),
                texmath_path=texmath_path,
                xsl_path=str(_MML2OMML_WRAPPER_XSL),
                reason=f"No se pudo ejecutar texmath: {exc}",
            )
        except subprocess.TimeoutExpired:
            return LatexMathRuntime(
                available=False,
                engine="texmath",
                command=tuple(command),
                texmath_path=texmath_path,
                xsl_path=str(_MML2OMML_WRAPPER_XSL),
                reason="texmath no respondio durante la verificacion inicial.",
            )

        if probe.returncode != 0:
            message = (probe.stderr or probe.stdout or "").strip() or "texmath devolvio error al consultar version."
            return LatexMathRuntime(
                available=False,
                engine="texmath",
                command=tuple(command),
                texmath_path=texmath_path,
                xsl_path=str(_MML2OMML_WRAPPER_XSL),
                reason=message,
            )

        return LatexMathRuntime(
            available=True,
            engine="texmath",
            command=tuple(command),
            texmath_path=texmath_path,
            xsl_path=str(_MML2OMML_WRAPPER_XSL),
            version=(probe.stdout or probe.stderr or "").strip() or None,
        )

    def _run_latex2mathml(self, expression: str, *, inline: bool) -> str:
        if not HAS_LATEX2MATHML or latex2mathml_convert is None:
            raise LatexMathUnavailableError("latex2mathml no disponible en runtime.")
        display = "inline" if inline else "block"
        try:
            return latex2mathml_convert(expression, display=display)
        except Exception as exc:
            raise LatexMathParseError(f"latex2mathml no pudo convertir la expresion LaTeX: {exc}") from exc

    def _run_texmath(self, runtime: LatexMathRuntime, expression: str, *, inline: bool) -> str:
        command = [*(runtime.command or ()), "-f", "tex", "-t", "mathml"]
        if inline:
            command.append("--inline")
        try:
            completed = subprocess.run(
                command,
                input=expression,
                capture_output=True,
                text=True,
                encoding="utf-8",
                timeout=max(float(self.timeout_s), 1.0),
                check=False,
            )
        except FileNotFoundError as exc:
            raise LatexMathUnavailableError(f"No se pudo ejecutar texmath: {exc}") from exc
        except subprocess.TimeoutExpired as exc:
            raise LatexMathTimeoutError(
                f"texmath excedio el timeout de {self.timeout_s:.1f}s para la expresion LaTeX."
            ) from exc

        if completed.returncode != 0:
            message = (completed.stderr or completed.stdout or "").strip()
            if not message:
                message = "texmath no pudo convertir la expresion LaTeX."
            raise LatexMathParseError(message)

        output = (completed.stdout or "").strip()
        if not output:
            raise LatexMathParseError("texmath no devolvio MathML.")
        return output

    def _mathml_to_omml(self, mathml_text: str) -> bytes:
        if not HAS_LXML:
            raise LatexMathUnavailableError("lxml no disponible; no se puede transformar MathML a OMML.")

        sanitized_mathml = _RAW_AMPERSAND_RE.sub("&amp;", mathml_text)
        try:
            mathml_root = etree.fromstring(sanitized_mathml.encode("utf-8"))
        except Exception as exc:
            raise LatexMathTransformError(f"MathML invalido devuelto por el conversor LaTeX: {exc}") from exc
        expected_delimiters = _normalize_mathml_fences(mathml_root)

        transform = self._get_transform()
        try:
            with self._transform_lock:
                result_tree = transform(mathml_root)
        except Exception as exc:
            raise LatexMathTransformError(f"Fallo al transformar MathML a OMML: {exc}") from exc

        root = result_tree.getroot()
        if root is None:
            raise LatexMathTransformError("La transformacion MathML -> OMML devolvio un resultado vacio.")

        tag = etree.QName(root).localname
        if tag not in {"oMath", "oMathPara"}:
            raise LatexMathTransformError(f"El transformador devolvio '{tag}', no un nodo OMML insertable.")

        _apply_expected_omml_delimiters(root, expected_delimiters)
        _populate_empty_omml_nary_operands(root)
        etree.cleanup_namespaces(root)
        return etree.tostring(root, encoding="utf-8")

    def _get_transform(self):
        if self._transform is not None:
            return self._transform
        if not HAS_LXML:
            raise LatexMathUnavailableError("lxml no disponible; no se puede inicializar la transformacion OMML.")
        with self._transform_lock:
            if self._transform is not None:
                return self._transform
            try:
                xslt_doc = etree.parse(str(_MML2OMML_WRAPPER_XSL))
                self._transform = etree.XSLT(xslt_doc)
            except Exception as exc:
                raise LatexMathUnavailableError(f"No se pudo cargar '{_MML2OMML_WRAPPER_XSL.name}': {exc}") from exc
            return self._transform

    def _cache_get(self, key: tuple[str, bool]) -> Optional[bytes]:
        with self._cache_lock:
            value = self._cache.get(key)
            if value is None:
                return None
            self._cache.move_to_end(key)
            return value

    def _cache_put(self, key: tuple[str, bool], value: bytes) -> None:
        with self._cache_lock:
            self._cache[key] = value
            self._cache.move_to_end(key)
            while len(self._cache) > self.cache_size:
                self._cache.popitem(last=False)


def _read_timeout() -> float:
    raw_value = os.getenv(_TEXMATH_TIMEOUT_ENV, "").strip()
    if not raw_value:
        return _DEFAULT_TIMEOUT_S
    try:
        timeout_value = float(raw_value)
    except ValueError:
        _logger.warning("Valor invalido para %s=%r. Usando %.1fs.", _TEXMATH_TIMEOUT_ENV, raw_value, _DEFAULT_TIMEOUT_S)
        return _DEFAULT_TIMEOUT_S
    if timeout_value <= 0:
        _logger.warning("Valor no positivo para %s=%r. Usando %.1fs.", _TEXMATH_TIMEOUT_ENV, raw_value, _DEFAULT_TIMEOUT_S)
        return _DEFAULT_TIMEOUT_S
    return timeout_value


def _resolve_texmath_command() -> Optional[tuple[list[str], str]]:
    env_path = os.getenv(_TEXMATH_ENV, "").strip().strip('"')
    if env_path:
        env_candidate = Path(env_path)
        if env_candidate.exists():
            return _build_command(env_candidate), str(env_candidate)
        env_which = shutil.which(env_path)
        if env_which:
            return _build_command(Path(env_which)), env_which
        return None

    if _BUNDLED_TEXMATH.exists():
        return _build_command(_BUNDLED_TEXMATH), str(_BUNDLED_TEXMATH)

    which_path = shutil.which("texmath")
    if which_path:
        return _build_command(Path(which_path)), which_path
    return None


def _build_command(path: Path) -> list[str]:
    suffix = path.suffix.lower()
    if suffix == ".py":
        return [sys.executable, str(path)]
    return [str(path)]


def _normalize_mathml_fences(mathml_root) -> list[tuple[str, str]]:
    """Promotes stretchy MathML fence sequences to mfenced and returns expected delimiters."""
    changed = True
    while changed:
        changed = False
        for parent in mathml_root.iter():
            children = list(parent)
            for index, child in enumerate(children):
                open_char = _mathml_open_fence_char(child)
                if not open_char:
                    continue

                close_index, close_char = _find_matching_mathml_close(children, index, open_char)
                if close_index is None:
                    if not _is_left_only_mathml_fence(child, open_char):
                        continue
                    close_index = len(children)
                    close_char = ""

                if close_index <= index + 1:
                    continue

                content_nodes = children[index + 1:close_index]
                close_node = children[close_index] if close_index < len(children) else None
                if not _should_promote_mathml_fence(child, close_node, content_nodes):
                    continue

                insert_at = parent.index(child)
                parent.remove(child)
                for content_node in content_nodes:
                    parent.remove(content_node)
                if close_node is not None:
                    parent.remove(close_node)

                fenced = etree.Element(f"{_MATHML_TAG}mfenced", nsmap=mathml_root.nsmap)
                fenced.set("open", open_char)
                fenced.set("close", close_char)
                content_row = etree.Element(f"{_MATHML_TAG}mrow", nsmap=mathml_root.nsmap)
                for content_node in content_nodes:
                    content_row.append(content_node)
                fenced.append(content_row)
                parent.insert(insert_at, fenced)
                changed = True
                break
            if changed:
                break
    return _collect_expected_mathml_delimiters(mathml_root)


def _is_mathml_table(node) -> bool:
    return etree.QName(node).localname == "mtable"


def _is_mathml_fence_token(node) -> bool:
    if etree.QName(node).localname != "mo":
        return False
    return _mathml_node_text(node) in _MATRIX_DELIMITER_PAIRS


def _mathml_open_fence_char(node) -> str:
    if not _is_mathml_fence_token(node):
        return ""
    return _mathml_node_text(node)


def _is_matching_mathml_close(node, open_char: str) -> bool:
    if etree.QName(node).localname != "mo":
        return False
    return _mathml_node_text(node) == _MATRIX_DELIMITER_PAIRS.get(open_char, "")


def _mathml_close_char_for_open(node) -> str:
    if etree.QName(node).localname != "mo":
        return ""
    return _MATRIX_DELIMITER_PAIRS.get(_mathml_node_text(node), "")


def _is_left_only_mathml_fence(node, open_char: str) -> bool:
    if open_char not in _LEFT_ONLY_DELIMITERS:
        return False
    return any(
        (node.get(attr) or "").strip().lower() in {"true", "prefix"}
        for attr in ("stretchy", "fence", "form")
    )


def _mathml_node_text(node) -> str:
    return "".join(node.itertext()).strip()


def _find_matching_mathml_close(children, start_index: int, open_char: str) -> tuple[Optional[int], str]:
    expected_close = _MATRIX_DELIMITER_PAIRS.get(open_char, "")
    nested_closes: list[str] = []
    for close_index in range(start_index + 1, len(children)):
        candidate = children[close_index]
        nested_expected_close = _mathml_close_char_for_open(candidate)
        if nested_expected_close and _mathml_node_text(candidate) != expected_close:
            nested_closes.append(nested_expected_close)
            continue
        if nested_expected_close and _mathml_node_text(candidate) == open_char and open_char != expected_close:
            nested_closes.append(nested_expected_close)
            continue
        if nested_closes and etree.QName(candidate).localname == "mo" and _mathml_node_text(candidate) == nested_closes[-1]:
            nested_closes.pop()
            continue
        if not nested_closes and _is_matching_mathml_close(candidate, open_char):
            return close_index, expected_close
    return None, ""


def _should_promote_mathml_fence(open_node, close_node, content_nodes) -> bool:
    if not content_nodes:
        return False
    if _has_mathml_fence_semantics(open_node) or (close_node is not None and _has_mathml_fence_semantics(close_node)):
        return True
    return any(_is_mathml_table(node) for node in content_nodes)


def _has_mathml_fence_semantics(node) -> bool:
    if node is None:
        return False
    stretchy = (node.get("stretchy") or "").strip().lower()
    fence = (node.get("fence") or "").strip().lower()
    form = (node.get("form") or "").strip().lower()
    return stretchy == "true" or fence == "true" or form in {"prefix", "postfix"}


def _collect_expected_mathml_delimiters(mathml_root) -> list[tuple[str, str]]:
    delimiters: list[tuple[str, str]] = []
    for node in mathml_root.iterfind(f".//{_MATHML_TAG}mfenced"):
        open_char = (node.get("open") or _DEFAULT_MFENCED_OPEN)
        close_char = node.get("close")
        if close_char is None:
            close_char = _DEFAULT_MFENCED_CLOSE
        delimiters.append((open_char, close_char))
    return delimiters


def _apply_expected_omml_delimiters(omml_root, expected_delimiters: list[tuple[str, str]]) -> None:
    if not expected_delimiters:
        return
    delimiter_nodes = omml_root.findall(f".//{_OMML_TAG}d")
    for delimiter_node, (open_char, close_char) in zip(delimiter_nodes, expected_delimiters):
        _set_omml_delimiter_value(delimiter_node, "begChr", open_char, default_char=_DEFAULT_MFENCED_OPEN)
        _set_omml_delimiter_value(delimiter_node, "endChr", close_char, default_char=_DEFAULT_MFENCED_CLOSE)


def _set_omml_delimiter_value(delimiter_node, tag_name: str, char: str, *, default_char: str) -> None:
    dpr_node = delimiter_node.find(f"./{_OMML_TAG}dPr")
    child_node = None if dpr_node is None else dpr_node.find(f"./{_OMML_TAG}{tag_name}")
    if not char and child_node is None and tag_name != "endChr":
        return
    if char == default_char and child_node is None:
        return
    if dpr_node is None:
        dpr_node = etree.Element(f"{_OMML_TAG}dPr")
        delimiter_node.insert(0, dpr_node)
    if child_node is None:
        child_node = etree.Element(f"{_OMML_TAG}{tag_name}")
        dpr_node.append(child_node)
    child_node.set(_OMML_VAL_ATTR, char)


def _populate_empty_omml_nary_operands(omml_root) -> None:
    for nary_node in omml_root.findall(f".//{_OMML_TAG}nary"):
        operand_node = nary_node.find(f"./{_OMML_TAG}e")
        if operand_node is None:
            continue
        if len(operand_node) > 0 or (operand_node.text or "").strip():
            continue
        _move_following_omml_operand_into_nary(nary_node, operand_node)


def _move_following_omml_operand_into_nary(nary_node, operand_node) -> bool:
    current = nary_node
    while current is not None:
        parent = current.getparent()
        if parent is None:
            return False
        sibling = current.getnext()
        if sibling is not None:
            return _append_omml_operand_fragment(operand_node, parent, sibling)
        if not _is_transparent_omml_e_wrapper(parent, current):
            return False
        current = parent
    return False


def _is_transparent_omml_e_wrapper(node, child) -> bool:
    return (
        etree.QName(node).localname == "e"
        and len(node) == 1
        and node[0] is child
        and not (node.text or "").strip()
    )


def _append_omml_operand_fragment(operand_node, source_parent, source_node) -> bool:
    if etree.QName(source_node).localname == "e":
        return _append_omml_operand_from_e_wrapper(operand_node, source_parent, source_node)

    extracted = _extract_omml_nary_operand_fragment(source_parent, source_node)
    if extracted is None:
        return False
    operand_node.append(extracted)
    return True


def _append_omml_operand_from_e_wrapper(operand_node, source_parent, wrapper_node) -> bool:
    children = list(wrapper_node)
    if not children and not (wrapper_node.text or "").strip():
        source_parent.remove(wrapper_node)
        return False

    if len(children) == 1 and etree.QName(children[0]).localname == "r":
        extracted = _extract_omml_nary_operand_fragment(wrapper_node, children[0])
        if extracted is None:
            return False
        operand_node.append(extracted)
        if len(wrapper_node) == 0 and not (wrapper_node.text or "").strip():
            source_parent.remove(wrapper_node)
        return True

    moved = False
    for child in children:
        wrapper_node.remove(child)
        operand_node.append(child)
        moved = True
    if len(wrapper_node) == 0 and not (wrapper_node.text or "").strip():
        source_parent.remove(wrapper_node)
    return moved


def _extract_omml_nary_operand_fragment(parent, node):
    if etree.QName(node).localname != "r":
        parent.remove(node)
        return node

    text_node = node.find(f"./{_OMML_TAG}t")
    text_value = text_node.text or "" if text_node is not None else ""
    if not text_value:
        return None

    split_index = _find_nary_boundary_index(text_value)
    if split_index is None:
        parent.remove(node)
        return node
    if split_index <= 0:
        return None

    extracted = etree.fromstring(etree.tostring(node))
    extracted_text = extracted.find(f"./{_OMML_TAG}t")
    if extracted_text is None:
        return None

    extracted_text.text = text_value[:split_index]
    text_node.text = text_value[split_index:]
    return extracted


def _find_nary_boundary_index(text_value: str) -> Optional[int]:
    for index, char in enumerate(text_value):
        if char in _NARY_BOUNDARY_CHARS:
            return index
    return None


def _normalize_expression(expression: str, *, inline: bool) -> str:
    text = str(expression or "").strip()
    if not text:
        raise LatexMathError("Expresion LaTeX vacia.")

    inner = text
    display_wrapper = False
    matched = _DISPLAY_DOLLAR_RE.match(text)
    if matched:
        inner = matched.group(1).strip()
        display_wrapper = True
    else:
        matched = _DISPLAY_BRACKET_RE.match(text)
        if matched:
            inner = matched.group(1).strip()
            display_wrapper = True
        else:
            matched = _INLINE_PAREN_RE.match(text)
            if matched:
                inner = matched.group(1).strip()
            else:
                matched = _INLINE_DOLLAR_RE.match(text)
                if matched and not text.startswith("$$"):
                    inner = matched.group(1).strip()

    if not inner:
        raise LatexMathError("Expresion LaTeX vacia despues de normalizar delimitadores.")

    _validate_math_only_scope(inner)

    begin_envs = _BEGIN_ENV_RE.findall(inner)
    if inline:
        if display_wrapper:
            raise LatexMathInlineError("create_math_latex_element() solo acepta expresiones inline, no display math.")
        if begin_envs and any(env in _INLINE_BLOCK_ENVIRONMENTS for env in begin_envs):
            raise LatexMathInlineError(
                "create_math_latex_element() no acepta entornos display o multilinea como aligned/split/gather."
            )
        if "\n" in inner or _DOUBLE_BACKSLASH_RE.search(inner):
            raise LatexMathInlineError(
                "create_math_latex_element() no acepta expresiones multilinea ni saltos de linea LaTeX."
            )

    return inner


def _validate_math_only_scope(expression: str) -> None:
    begin_envs = _BEGIN_ENV_RE.findall(expression)
    for env_name in begin_envs:
        if env_name not in _ALLOWED_ENVIRONMENTS:
            raise LatexMathScopeError(
                f"Entorno LaTeX fuera de alcance para math_latex(): '\\begin{{{env_name}}}'."
            )

    for command_name in _COMMAND_RE.findall(expression):
        if command_name in {"begin", "end"}:
            continue
        if command_name in _FORBIDDEN_COMMANDS:
            raise LatexMathScopeError(
                f"Comando LaTeX fuera de alcance para math_latex(): '\\{command_name}'."
            )


__all__ = [
    "LatexMathConverter",
    "LatexMathError",
    "LatexMathInlineError",
    "LatexMathParseError",
    "LatexMathRuntime",
    "LatexMathScopeError",
    "LatexMathTimeoutError",
    "LatexMathTransformError",
    "LatexMathUnavailableError",
]
