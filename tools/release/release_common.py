from __future__ import annotations

import fnmatch
import json
import subprocess
from pathlib import Path
from typing import Any, Iterable


RELEASE_DIR = Path(__file__).resolve().parent
DEFAULT_CONFIG_PATH = RELEASE_DIR / "public_release.config.json"


def load_config(path: str | Path | None = None) -> dict[str, Any]:
    config_path = Path(path) if path else DEFAULT_CONFIG_PATH
    with config_path.open("r", encoding="utf-8") as fh:
        config = json.load(fh)
    config["_config_path"] = str(config_path.resolve())
    return config


def repo_root_from_config(config: dict[str, Any]) -> Path:
    config_dir = Path(config["_config_path"]).resolve().parent
    source = Path(config["source_repo"])
    if not source.is_absolute():
        source = (config_dir / source).resolve()
    return source


def resolve_path(value: str | Path, *, base: Path) -> Path:
    path = Path(value)
    if not path.is_absolute():
        path = (base / path).resolve()
    return path


def normalize_relpath(path: str | Path) -> str:
    return Path(path).as_posix().strip("/")


def run_git(repo: Path, args: list[str], *, check: bool = True) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        ["git", "-C", str(repo), *args],
        check=check,
        text=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
    )


def git_ls_files(repo: Path) -> list[str]:
    result = run_git(repo, ["ls-files", "-z"])
    if not result.stdout:
        return []
    return [item for item in result.stdout.split("\0") if item]


def split_rel_parts(relpath: str) -> tuple[str, ...]:
    return tuple(part for part in normalize_relpath(relpath).split("/") if part)


def is_denied_path(relpath: str, denylist: dict[str, Any]) -> bool:
    rel = normalize_relpath(relpath)
    parts = set(split_rel_parts(rel))
    denied_parts = {str(part) for part in denylist.get("path_parts", [])}
    if parts.intersection(denied_parts):
        return True
    for pattern in denylist.get("path_globs", []):
        if fnmatch.fnmatch(rel, str(pattern).replace("\\", "/")):
            return True
    return False


def iter_files(root: Path) -> Iterable[Path]:
    for path in root.rglob("*"):
        if path.is_file():
            yield path
