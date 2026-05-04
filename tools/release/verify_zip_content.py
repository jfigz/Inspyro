import os
import zipfile
from pathlib import Path


EXCLUDE_DIRS = {
    "venv_inspyro",
    ".venv",
    "venv",
    "node_modules",
    "__pycache__",
    ".pytest_cache",
    ".git/objects",
    ".next",
    "build",
    "dist",
    ".cache",
}

EXCLUDE_EXTENSIONS = {".pyc", ".pyo", ".pyd", ".DS_Store"}


def verify_zip_content(zip_filename: str = "inspyro_windows_export.zip") -> None:
    # Resolve from this file so the script works from any cwd.
    repo_root = Path(__file__).resolve().parents[2]
    zip_path = repo_root / zip_filename

    if not zip_path.exists():
        print(f"Archivo no encontrado: {zip_path}")
        return

    print(f"Analizando: {zip_path}")
    with zipfile.ZipFile(zip_path, "r") as zipf:
        zip_files = set(zipf.namelist())

    print(f"Archivos en ZIP: {len(zip_files)}")

    missing_files = []
    for root, _, files in os.walk(repo_root):
        root_path = Path(root)
        rel_path = root_path.relative_to(repo_root)

        is_excluded_dir = any(part in EXCLUDE_DIRS for part in rel_path.parts)
        if ".git/objects" in str(rel_path).replace("\\", "/"):
            is_excluded_dir = True
        if is_excluded_dir:
            continue

        for file_name in files:
            file_path = root_path / file_name
            if file_path.suffix in EXCLUDE_EXTENSIONS:
                continue
            if file_name in {zip_filename, "verify_zip_content.py", "create_export_zip.py"}:
                continue

            zip_rel_path = (rel_path / file_name).as_posix()
            if rel_path == Path("."):
                zip_rel_path = file_name

            if zip_rel_path not in zip_files:
                missing_files.append(zip_rel_path)

    if missing_files:
        print("\nARCHIVOS FALTANTES EN EL ZIP:")
        for rel in sorted(missing_files):
            print(f"  - {rel}")
    else:
        print("\nTodos los archivos esperados estan presentes en el ZIP.")


if __name__ == "__main__":
    verify_zip_content()
