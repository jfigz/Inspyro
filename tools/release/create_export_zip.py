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
    ".next",
    "build",
    "dist",
    ".cache",
    ".coverage",
    "htmlcov",
}

EXCLUDE_EXTENSIONS = {".pyc", ".pyo", ".pyd", ".DS_Store"}


def create_export_zip(output_filename: str = "inspyro_windows_export.zip") -> None:
    # Resolve from this file so the script works from any cwd.
    repo_root = Path(__file__).resolve().parents[2]
    output_path = repo_root / output_filename

    print(f"Creando archivo: {output_path}...")

    with zipfile.ZipFile(output_path, "w", zipfile.ZIP_DEFLATED) as zipf:
        for root, dirs, files in os.walk(repo_root):
            root_path = Path(root)
            rel_path = root_path.relative_to(repo_root)

            dirs[:] = [d for d in dirs if d not in EXCLUDE_DIRS]

            for file_name in files:
                file_path = root_path / file_name
                if file_path.suffix in EXCLUDE_EXTENSIONS:
                    continue
                if file_name == output_filename:
                    continue

                zip_rel_path = rel_path / file_name
                print(f"  + {zip_rel_path}")
                zipf.write(file_path, zip_rel_path)

    print(f"Exportacion completada: {output_path}")
    print(f"Tamano: {output_path.stat().st_size / (1024 * 1024):.2f} MB")


if __name__ == "__main__":
    create_export_zip()
