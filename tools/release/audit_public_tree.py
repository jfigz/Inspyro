from __future__ import annotations

import argparse
import json
import os
import re
from dataclasses import dataclass, asdict
from pathlib import Path

from release_common import git_ls_files, is_denied_path, load_config, repo_root_from_config, resolve_path


SECRET_PATTERNS = [
    re.compile(r"gh[pousr]_[A-Za-z0-9_]{20,}"),
    re.compile(r"-----BEGIN (RSA |OPENSSH |EC |DSA )?PRIVATE KEY-----"),
]

CONFIG_SECRET_PATTERNS = [
    re.compile(r"(?i)(api[_-]?key|secret|token|password)\s*[:=]\s*['\"]?[A-Za-z0-9_./+=:-]{16,}"),
]

PRIVATE_PATH_PATTERNS = [
    re.compile(r"(?i)C:[\\/]+CalcPyro[\\/]+P1"),
    re.compile(r"(?i)C:[\\/]+Users[\\/]+[^\\/\\s]+"),
]


@dataclass
class AuditIssue:
    kind: str
    path: str
    detail: str


TEXT_EXTENSIONS = {
    ".css",
    ".html",
    ".js",
    ".json",
    ".md",
    ".mjs",
    ".ps1",
    ".py",
    ".txt",
    ".xml",
    ".yaml",
    ".yml",
}

CONFIG_LIKE_EXTENSIONS = {".env", ".json", ".toml", ".yaml", ".yml"}


def audit_tree(root: Path, denylist: dict, *, tracked_only: bool = False) -> list[AuditIssue]:
    issues: list[AuditIssue] = []
    private_markers = [str(marker) for marker in denylist.get("private_path_markers", [])]

    if tracked_only:
        for relpath in git_ls_files(root):
            issues.extend(audit_file(root / relpath, relpath, denylist, private_markers))
        return issues

    for current_root, dirs, files in os.walk(root):
        current = Path(current_root)
        kept_dirs: list[str] = []
        for dirname in dirs:
            dir_path = current / dirname
            rel_dir = dir_path.relative_to(root).as_posix()
            if dirname == ".git" or is_denied_path(rel_dir, denylist):
                issues.append(AuditIssue("denylist_path", rel_dir, "directory matches public release denylist"))
            else:
                kept_dirs.append(dirname)
        dirs[:] = kept_dirs

        for filename in files:
            path = current / filename
            relpath = path.relative_to(root).as_posix()
            issues.extend(audit_file(path, relpath, denylist, private_markers))

    return issues


def audit_file(path: Path, relpath: str, denylist: dict, private_markers: list[str]) -> list[AuditIssue]:
    issues: list[AuditIssue] = []
    if is_denied_path(relpath, denylist):
        issues.append(AuditIssue("denylist_path", relpath, "path matches public release denylist"))

    if path.suffix.lower() not in TEXT_EXTENSIONS and not path.name.startswith(".env"):
        return issues

    try:
        content = path.read_text(encoding="utf-8", errors="ignore")
    except OSError as exc:
        issues.append(AuditIssue("read_error", relpath, str(exc)))
        return issues

    for marker in private_markers:
        if marker and marker in content:
            issues.append(AuditIssue("private_path", relpath, f"contains private path marker: {marker}"))

    for pattern in PRIVATE_PATH_PATTERNS:
        if pattern.search(content):
            issues.append(AuditIssue("private_path", relpath, pattern.pattern))

    for pattern in SECRET_PATTERNS:
        if pattern.search(content):
            issues.append(AuditIssue("secret_pattern", relpath, pattern.pattern))

    if path.name.startswith(".env") or path.suffix.lower() in CONFIG_LIKE_EXTENSIONS:
        for pattern in CONFIG_SECRET_PATTERNS:
            if pattern.search(content):
                issues.append(AuditIssue("secret_pattern", relpath, pattern.pattern))

    return issues


def main() -> int:
    parser = argparse.ArgumentParser(description="Audit public release tree for denied paths and secret-like content.")
    parser.add_argument("--config", default=None)
    parser.add_argument("--root", default=None)
    parser.add_argument("--json", action="store_true")
    parser.add_argument("--all-files", action="store_true", help="Scan all working-tree files instead of git-tracked files only.")
    args = parser.parse_args()

    config = load_config(args.config)
    source_repo = repo_root_from_config(config)
    root = resolve_path(args.root or config["public_repo"], base=source_repo)
    issues = audit_tree(root, config["denylist"], tracked_only=not args.all_files)

    payload = {"root": str(root), "issue_count": len(issues), "issues": [asdict(issue) for issue in issues]}
    if args.json:
        print(json.dumps(payload, indent=2, ensure_ascii=False))
    else:
        print(f"Audit root: {root}")
        if issues:
            for issue in issues:
                print(f"[{issue.kind}] {issue.path}: {issue.detail}")
        else:
            print("Audit OK: no public release issues found.")

    return 1 if issues else 0


if __name__ == "__main__":
    raise SystemExit(main())
