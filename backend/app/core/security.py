"""Modulo de seguridad y filtrado del filesystem."""

from __future__ import annotations

import os
import tempfile
from pathlib import Path
from typing import List, Set


def _detect_allowed_roots() -> List[str]:
    """Detecta las raices de paths permitidos segun el sistema operativo."""
    extra_roots: list[str] = []
    if os.name == "nt":
        for code in range(65, 91):
            drive = f"{chr(code)}:\\"
            if os.path.exists(drive):
                extra_roots.append(drive)
    else:
        extra_roots.append("/")
    return extra_roots


_EXTRA_ROOTS = _detect_allowed_roots()

ALLOWED_BASE_PATHS = [
    os.path.expanduser("~"),
    tempfile.gettempdir(),
    "/opt",
    str(Path(__file__).parent.parent.parent.resolve()),
] + _EXTRA_ROOTS

SUPPORTED_EXTENSIONS: Set[str] = {
    ".py",
    ".ipynb",
    ".json",
    ".txt",
    ".md",
    ".csv",
    ".yml",
    ".yaml",
    ".html",
    ".css",
    ".js",
    ".jsx",
    ".ts",
    ".tsx",
    ".sh",
    ".env",
    ".log",
    ".xml",
}

# Exclusiones duras: nunca se muestran en el explorer ni se propagan por el
# watcher porque tienden a generar mucho ruido o costo innecesario.
HARD_IGNORED_NAMES: Set[str] = {
    "__pycache__",
    ".pytest_cache",
    ".mypy_cache",
    ".ruff_cache",
    ".cache",
    "node_modules",
    ".git",
    ".svn",
    ".hg",
    ".venv",
    "venv",
    "venv_inspyro",
}


def is_path_safe(path: str) -> bool:
    """Verifica que el path este dentro de los directorios permitidos."""
    try:
        abs_path = os.path.abspath(os.path.expanduser(path))
        real_path = os.path.realpath(abs_path)

        for base in ALLOWED_BASE_PATHS:
            try:
                if not base:
                    continue
                abs_base = os.path.abspath(base)
                real_base = os.path.realpath(abs_base)
                if os.path.commonpath([real_base, real_path]) == real_base:
                    return True
            except (ValueError, OSError):
                continue
        return False
    except Exception:
        return False


def is_extension_supported(filename: str) -> bool:
    ext = os.path.splitext(filename)[1].lower()
    return ext in SUPPORTED_EXTENSIONS


def is_hidden_name(name: str) -> bool:
    """Retorna True para dotfiles/directorios ocultos convencionales."""
    return bool(name) and name.startswith(".")


def is_hard_ignored_name(name: str) -> bool:
    return name in HARD_IGNORED_NAMES


def should_ignore(name: str, *, show_hidden: bool = False) -> bool:
    """Filtra entradas para el explorer.

    `show_hidden` solo afecta a dotfiles normales; las exclusiones duras siguen
    filtradas siempre.
    """
    if is_hard_ignored_name(name):
        return True
    if not show_hidden and is_hidden_name(name):
        return True
    return False
