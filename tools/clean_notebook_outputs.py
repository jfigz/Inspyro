from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path


def _build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Clean Jupyter notebook outputs to reduce file size."
    )
    parser.add_argument(
        "paths",
        nargs="+",
        help="Notebook file(s) or directory paths to clean.",
    )
    parser.add_argument(
        "--in-place",
        action="store_true",
        help="Overwrite the original notebook instead of creating *.cleaned.ipynb.",
    )
    parser.add_argument(
        "--recursive",
        action="store_true",
        help="When a directory is provided, scan it recursively for .ipynb files.",
    )
    parser.add_argument(
        "--drop-widgets",
        action="store_true",
        help="Remove notebook metadata.widgets (can be large).",
    )
    parser.add_argument(
        "--overwrite",
        action="store_true",
        help="Allow overwriting output files when not using --in-place.",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Report what would change without writing files.",
    )
    return parser


def _format_bytes(value: int) -> str:
    units = ["B", "KB", "MB", "GB", "TB"]
    size = float(value)
    for unit in units:
        if size < 1024.0 or unit == units[-1]:
            if unit == "B":
                return f"{int(size)} {unit}"
            return f"{size:.2f} {unit}"
        size /= 1024.0
    return f"{value} B"


def _iter_ipynb_paths(raw_paths: list[str], recursive: bool) -> list[Path]:
    results: list[Path] = []
    for raw in raw_paths:
        path = Path(raw).expanduser()
        if path.is_dir():
            if not recursive:
                raise ValueError(
                    f"Directory provided without --recursive: {path}"
                )
            for item in path.rglob("*.ipynb"):
                if ".ipynb_checkpoints" in item.parts:
                    continue
                results.append(item)
            continue
        results.append(path)
    return results


def _clean_notebook(data: dict, drop_widgets: bool) -> bool:
    changed = False
    cells = data.get("cells")
    if isinstance(cells, list):
        for cell in cells:
            if not isinstance(cell, dict):
                continue
            if cell.get("cell_type") != "code":
                continue
            if cell.get("outputs"):
                cell["outputs"] = []
                changed = True
            if cell.get("execution_count") is not None:
                cell["execution_count"] = None
                changed = True

    if drop_widgets:
        metadata = data.get("metadata")
        if isinstance(metadata, dict) and "widgets" in metadata:
            metadata.pop("widgets", None)
            changed = True
    return changed


def _output_path(input_path: Path, in_place: bool) -> Path:
    if in_place:
        return input_path
    return input_path.with_suffix(".cleaned.ipynb")


def _write_notebook(path: Path, data: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp_path = path.with_suffix(path.suffix + ".tmp")
    with tmp_path.open("w", encoding="utf-8") as handle:
        json.dump(data, handle, indent=2, ensure_ascii=False)
        handle.write("\n")
    tmp_path.replace(path)


def main(argv: list[str] | None = None) -> int:
    args = _build_parser().parse_args(argv)

    try:
        targets = _iter_ipynb_paths(args.paths, args.recursive)
    except ValueError as exc:
        print(f"[error] {exc}")
        return 2

    if not targets:
        print("[error] No .ipynb files found.")
        return 2

    errors = 0
    cleaned = 0

    for path in targets:
        if not path.exists():
            print(f"[error] Not found: {path}")
            errors += 1
            continue
        if path.is_dir():
            print(f"[error] Directory without --recursive: {path}")
            errors += 1
            continue
        if path.suffix.lower() != ".ipynb":
            print(f"[skip] Not a notebook: {path}")
            continue

        before_size = path.stat().st_size
        try:
            with path.open("r", encoding="utf-8") as handle:
                data = json.load(handle)
        except json.JSONDecodeError as exc:
            print(f"[error] Invalid notebook JSON: {path} ({exc})")
            errors += 1
            continue

        changed = _clean_notebook(data, args.drop_widgets)
        output_path = _output_path(path, args.in_place)

        if not changed:
            print(f"[skip] No outputs to clean: {path}")
            continue

        if not args.in_place and output_path.exists() and not args.overwrite:
            print(f"[error] Output exists (use --overwrite): {output_path}")
            errors += 1
            continue

        if args.dry_run:
            print(
                f"[dry-run] {path} -> {output_path} "
                f"({_format_bytes(before_size)} -> cleaned)"
            )
            cleaned += 1
            continue

        try:
            _write_notebook(output_path, data)
        except OSError as exc:
            print(f"[error] Failed to write {output_path}: {exc}")
            errors += 1
            continue

        after_size = output_path.stat().st_size
        delta = before_size - after_size
        print(
            f"[clean] {path} -> {output_path} "
            f"({_format_bytes(before_size)} -> {_format_bytes(after_size)}, "
            f"saved {_format_bytes(max(delta, 0))})"
        )
        cleaned += 1

    if errors:
        print(f"[summary] Cleaned: {cleaned}, errors: {errors}")
        return 1
    print(f"[summary] Cleaned: {cleaned}, errors: 0")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
