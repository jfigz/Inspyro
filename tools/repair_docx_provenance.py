from __future__ import annotations

import argparse
import sys
from dataclasses import dataclass
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[1]
BACKEND_ROOT = REPO_ROOT / "backend"
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

from app.services.docx_sanitizer import DocxSanitizationResult, sanitize_docx_bytes_for_delivery_result


@dataclass(frozen=True)
class RepairResult:
    input_path: Path
    output_path: Path
    sanitization: DocxSanitizationResult


def default_output_path(input_path: Path) -> Path:
    return input_path.with_name(f"{input_path.stem}-clean{input_path.suffix}")


def repair_docx_file(
    input_path: str | Path,
    *,
    output_path: str | Path | None = None,
    in_place: bool = False,
) -> RepairResult:
    source = Path(input_path).expanduser().resolve()
    if not source.is_file():
        raise FileNotFoundError(f"DOCX no encontrado: {source}")
    if source.suffix.lower() != ".docx":
        raise ValueError(f"Se esperaba un archivo .docx: {source}")

    destination = source if in_place else Path(output_path).expanduser().resolve() if output_path else default_output_path(source)
    result = sanitize_docx_bytes_for_delivery_result(source.read_bytes())
    destination.write_bytes(result.docx_bytes)
    return RepairResult(
        input_path=source,
        output_path=destination,
        sanitization=result,
    )


def build_arg_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Limpia hyperlinks automáticos de procedencia DOCX en archivos ya descargados.",
    )
    parser.add_argument("paths", nargs="+", help="Uno o más archivos .docx a reparar.")
    parser.add_argument(
        "--in-place",
        action="store_true",
        help="Sobrescribe el archivo original en vez de crear una copia *-clean.docx.",
    )
    return parser


def main(argv: list[str] | None = None) -> int:
    parser = build_arg_parser()
    args = parser.parse_args(argv)

    exit_code = 0
    for raw_path in args.paths:
        try:
            repaired = repair_docx_file(raw_path, in_place=bool(args.in_place))
        except Exception as exc:
            exit_code = 1
            print(f"[ERROR] {raw_path}: {exc}", file=sys.stderr)
            continue

        summary = repaired.sanitization
        print(
            f"{repaired.input_path} -> {repaired.output_path} | "
            f"provenance_relationships_detected={summary.provenance_relationships_detected} | "
            f"relationships_removed={summary.relationships_removed} | "
            f"hyperlinks_removed={summary.hyperlink_nodes_removed} | "
            f"field_codes_removed={summary.field_code_hyperlinks_removed}"
        )

    return exit_code


if __name__ == "__main__":
    raise SystemExit(main())
