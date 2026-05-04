#!/usr/bin/env python3
from __future__ import annotations

import argparse
import os
import re
import subprocess
import sys
from pathlib import Path

SEMVER_RE = re.compile(r"^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$")


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Validate the skill and update its VERSION file.",
    )
    parser.add_argument(
        "bump",
        nargs="?",
        choices=("major", "minor", "patch"),
        help="Semver component to increment.",
    )
    parser.add_argument(
        "--set",
        dest="set_version",
        help="Set the version explicitly to X.Y.Z.",
    )
    return parser.parse_args(argv)


def parse_version(raw: str) -> tuple[int, int, int]:
    match = SEMVER_RE.fullmatch(raw.strip())
    if not match:
        raise ValueError(f"Invalid semantic version: {raw!r}")
    return tuple(int(part) for part in match.groups())


def format_version(parts: tuple[int, int, int]) -> str:
    return ".".join(str(part) for part in parts)


def bump_version(current: tuple[int, int, int], bump: str) -> tuple[int, int, int]:
    major, minor, patch = current
    if bump == "major":
        return major + 1, 0, 0
    if bump == "minor":
        return major, minor + 1, 0
    if bump == "patch":
        return major, minor, patch + 1
    raise ValueError(f"Unknown bump action: {bump}")


def resolve_quick_validate() -> Path:
    codex_home = Path(os.environ.get("CODEX_HOME", Path.home() / ".codex"))
    validator = codex_home / "skills" / ".system" / "skill-creator" / "scripts" / "quick_validate.py"
    if not validator.exists():
        raise FileNotFoundError(
            f"quick_validate.py not found at expected path: {validator}"
        )
    return validator


def run_validation(skill_dir: Path) -> None:
    validator = resolve_quick_validate()
    result = subprocess.run(
        [sys.executable, str(validator), str(skill_dir)],
        capture_output=True,
        text=True,
        check=False,
    )
    if result.returncode != 0:
        raise RuntimeError(
            "Skill validation failed before updating VERSION.\n"
            f"COMMAND: {sys.executable} {validator} {skill_dir}\n"
            f"STDOUT:\n{result.stdout}\n"
            f"STDERR:\n{result.stderr}"
        )


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv)
    if bool(args.bump) == bool(args.set_version):
        raise SystemExit("Specify exactly one of: major|minor|patch or --set X.Y.Z")

    skill_dir = Path(__file__).resolve().parents[1]
    version_path = skill_dir / "VERSION"
    if not version_path.exists():
        raise SystemExit(f"VERSION file not found: {version_path}")

    current = parse_version(version_path.read_text(encoding="utf-8").strip())
    target = parse_version(args.set_version) if args.set_version else bump_version(current, args.bump)

    run_validation(skill_dir)

    current_text = format_version(current)
    target_text = format_version(target)
    version_path.write_text(target_text + "\n", encoding="utf-8")

    print(f"VERSION updated: {current_text} -> {target_text}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
