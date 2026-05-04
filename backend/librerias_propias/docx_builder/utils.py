"""Utilidades compartidas por la API DOCX."""

from __future__ import annotations

import io
import os
import posixpath
import zipfile
import xml.etree.ElementTree as ET
from typing import Any

# Límites de seguridad para imágenes
IMAGE_MAX_SIZE_BYTES = int(os.getenv("INSPYRO_IMAGE_MAX_SIZE", str(50 * 1024 * 1024)))  # 50MB
IMAGE_ALLOWED_EXTENSIONS = {".png", ".jpg", ".jpeg", ".gif", ".bmp", ".tiff", ".webp"}
RELATIONSHIP_NAMESPACE = "http://schemas.openxmlformats.org/officeDocument/2006/relationships"
RELATIONSHIP_ATTR_NAMES = frozenset(
    {
        f"{{{RELATIONSHIP_NAMESPACE}}}id",
        f"{{{RELATIONSHIP_NAMESPACE}}}embed",
        f"{{{RELATIONSHIP_NAMESPACE}}}link",
    }
)


class ImageConversionError(RuntimeError):
    """Se lanza cuando no se puede convertir una imagen a bytes."""


def _resolve_relationship_target(rel_path: str, target: str) -> str:
    rels_dir = posixpath.dirname(rel_path)
    source_dir = posixpath.dirname(rels_dir) if rels_dir.endswith("_rels") else rels_dir
    if target.startswith("/"):
        resolved = target.lstrip("/")
    else:
        resolved = posixpath.normpath(posixpath.join(source_dir, target))
    return resolved.lstrip("./")


def _rels_path_for_part(part_name: str) -> str:
    directory, filename = posixpath.split(part_name)
    if directory:
        return posixpath.join(directory, "_rels", f"{filename}.rels")
    return posixpath.join("_rels", f"{filename}.rels")


def iter_relationship_ids_in_xml_element(element: Any) -> set[str]:
    refs: set[str] = set()
    if element is None:
        return refs
    for descendant in getattr(element, "iter", lambda: [])():
        attrib = getattr(descendant, "attrib", {}) or {}
        for attr_name, attr_value in attrib.items():
            if attr_name in RELATIONSHIP_ATTR_NAMES and attr_value:
                refs.add(str(attr_value))
    return refs


def rewrite_relationship_ids_in_xml_element(element: Any, rid_map: dict[str, str]) -> None:
    if element is None or not rid_map:
        return
    for descendant in getattr(element, "iter", lambda: [])():
        attrib = getattr(descendant, "attrib", None)
        if not attrib:
            continue
        for attr_name in RELATIONSHIP_ATTR_NAMES:
            current = attrib.get(attr_name)
            if current in rid_map:
                attrib[attr_name] = rid_map[current]


def validate_docx_package_bytes(raw: bytes) -> tuple[bool, list[str]]:
    errors: list[str] = []
    buffer = io.BytesIO(raw)
    if not zipfile.is_zipfile(buffer):
        return False, ["El archivo no es un ZIP válido (DOCX corrupto)"]

    try:
        buffer.seek(0)
        with zipfile.ZipFile(buffer, "r") as zf:
            names = zf.namelist()
            name_set = set(names)

            required_files = ["word/document.xml", "[Content_Types].xml"]
            missing = [part_name for part_name in required_files if part_name not in name_set]
            if missing:
                errors.append(f"Faltan archivos requeridos: {', '.join(missing)}")
                return False, errors

            for part_name in names:
                if not part_name.lower().endswith(".xml"):
                    continue
                try:
                    ET.fromstring(zf.read(part_name))
                except ET.ParseError as exc:
                    errors.append(f"XML malformado en {part_name}: {exc}")
                except Exception as exc:
                    errors.append(f"Error parseando {part_name}: {type(exc).__name__}")

            try:
                doc_root = ET.fromstring(zf.read("word/document.xml"))
                body = doc_root.find(".//{http://schemas.openxmlformats.org/wordprocessingml/2006/main}body")
                if body is None:
                    errors.append("Estructura DOCX inválida: falta elemento <w:body>")
            except ET.ParseError as exc:
                errors.append(f"XML malformado en word/document.xml: {exc}")
            except Exception as exc:
                errors.append(f"Error parseando word/document.xml: {type(exc).__name__}")

            try:
                content_types = ET.fromstring(zf.read("[Content_Types].xml"))
                for node in list(content_types):
                    if not str(node.tag).endswith("Override"):
                        continue
                    part_name = (node.attrib.get("PartName") or "").lstrip("/")
                    if part_name and part_name not in name_set:
                        errors.append(f"[Content_Types].xml referencia parte faltante: {part_name}")
            except ET.ParseError as exc:
                errors.append(f"XML malformado en [Content_Types].xml: {exc}")
            except Exception as exc:
                errors.append(f"Error parseando [Content_Types].xml: {type(exc).__name__}")

            rel_maps: dict[str, dict[str, dict[str, Any]]] = {}
            rel_files = [name for name in names if name.endswith(".rels")]
            for rel_path in rel_files:
                rel_map: dict[str, dict[str, Any]] = {}
                rel_maps[rel_path] = rel_map
                try:
                    rel_root = ET.fromstring(zf.read(rel_path))
                except ET.ParseError as exc:
                    errors.append(f"XML malformado en {rel_path}: {exc}")
                    continue
                except Exception as exc:
                    errors.append(f"Error parseando {rel_path}: {type(exc).__name__}")
                    continue

                for rel in list(rel_root):
                    if not str(rel.tag).endswith("Relationship"):
                        continue
                    rel_id = rel.attrib.get("Id") or "<sin-id>"
                    target = rel.attrib.get("Target")
                    target_mode = (rel.attrib.get("TargetMode") or "").lower()
                    reltype = rel.attrib.get("Type") or ""
                    rel_map[rel_id] = {
                        "target": target,
                        "target_mode": target_mode,
                        "reltype": reltype,
                    }
                    if not target or target_mode == "external":
                        continue
                    resolved = _resolve_relationship_target(rel_path, target)
                    if resolved.startswith("../"):
                        errors.append(
                            f"Relación inválida en {rel_path} ({rel_id}): Target fuera del paquete ({target})"
                        )
                        continue
                    if resolved not in name_set:
                        errors.append(f"Relación rota en {rel_path} ({rel_id}): falta {resolved}")

            story_parts = [
                part_name
                for part_name in names
                if part_name == "word/document.xml"
                or (part_name.startswith("word/header") and part_name.endswith(".xml"))
                or (part_name.startswith("word/footer") and part_name.endswith(".xml"))
            ]
            for part_name in story_parts:
                try:
                    root = ET.fromstring(zf.read(part_name))
                except Exception:
                    continue
                refs = iter_relationship_ids_in_xml_element(root)
                if not refs:
                    continue
                rel_path = _rels_path_for_part(part_name)
                rel_map = rel_maps.get(rel_path)
                if rel_map is None:
                    errors.append(
                        f"{part_name} referencia relaciones ({', '.join(sorted(refs))}) pero falta {rel_path}"
                    )
                    continue
                for ref_id in sorted(refs):
                    rel_info = rel_map.get(ref_id)
                    if rel_info is None:
                        errors.append(f"{part_name} referencia relación faltante: {ref_id}")
                        continue
                    target = rel_info.get("target")
                    if not target or rel_info.get("target_mode") == "external":
                        continue
                    resolved = _resolve_relationship_target(rel_path, str(target))
                    if resolved not in name_set:
                        errors.append(
                            f"{part_name} referencia {ref_id} hacia parte faltante: {resolved}"
                        )
            return len(errors) == 0, errors
    except zipfile.BadZipFile:
        return False, ["El archivo no es un ZIP válido (DOCX corrupto)"]
    except Exception as exc:
        return False, [f"Error de validación: {type(exc).__name__}: {str(exc)[:100]}"]


def _validate_image_path(path: str) -> None:
    """Valida que la ruta de imagen sea segura."""
    # Normalizar ruta para evitar path traversal
    abs_path = os.path.abspath(os.path.realpath(path))
    
    # Validar extensión
    _, ext = os.path.splitext(abs_path.lower())
    if ext not in IMAGE_ALLOWED_EXTENSIONS:
        raise ImageConversionError(
            f"Extensión de imagen no permitida: {ext}. "
            f"Extensiones válidas: {', '.join(sorted(IMAGE_ALLOWED_EXTENSIONS))}"
        )
    
    # Validar tamaño
    try:
        size = os.path.getsize(abs_path)
        if size > IMAGE_MAX_SIZE_BYTES:
            raise ImageConversionError(
                f"Imagen demasiado grande: {size / (1024*1024):.1f}MB. "
                f"Máximo: {IMAGE_MAX_SIZE_BYTES / (1024*1024):.0f}MB"
            )
    except OSError as e:
        raise ImageConversionError(f"No se puede acceder al archivo: {e}") from e


def _validate_image_bytes(data: bytes) -> None:
    """Valida que los bytes de imagen sean seguros."""
    if len(data) > IMAGE_MAX_SIZE_BYTES:
        raise ImageConversionError(
            f"Imagen demasiado grande: {len(data) / (1024*1024):.1f}MB. "
            f"Máximo: {IMAGE_MAX_SIZE_BYTES / (1024*1024):.0f}MB"
        )


def image_to_bytes(image: Any, *, dpi: int = 200) -> bytes:
    """Convierte diferentes representaciones de imagen en bytes PNG.

    Parámetros
    ----------
    image:
        String con ruta, bytes, bytearray, objeto PIL.Image, ndarray de numpy o
        figura de matplotlib.
    dpi:
        Resolución usada cuando se renderiza una figura de matplotlib.
    
    Raises
    ------
    ImageConversionError:
        Si la imagen no es válida, demasiado grande, o tiene extensión no permitida.
    """

    if image is None:
        raise ImageConversionError("No se proporcionó ninguna imagen")

    if isinstance(image, (bytes, bytearray)):
        data = bytes(image)
        _validate_image_bytes(data)
        return data

    if isinstance(image, str):
        path = os.path.expanduser(image)
        abs_path = os.path.abspath(os.path.realpath(path))
        if not os.path.exists(abs_path):
            raise ImageConversionError(f"La ruta de imagen no existe: {path}")
        _validate_image_path(abs_path)
        with open(abs_path, "rb") as fh:
            data = fh.read()
        _validate_image_bytes(data)
        return data

    # Pillow
    try:
        from PIL import Image  # type: ignore
    except ImportError:
        Image = None  # type: ignore

    if Image is not None and isinstance(image, Image.Image):  # type: ignore[arg-type]
        buffer = io.BytesIO()
        image.save(buffer, format="PNG")
        data = buffer.getvalue()
        _validate_image_bytes(data)
        return data

    # numpy arrays
    try:
        import numpy as np  # type: ignore
    except ImportError:
        np = None  # type: ignore

    if np is not None and Image is not None and isinstance(image, np.ndarray):  # type: ignore[arg-type]
        arr = np.asarray(image)
        img = Image.fromarray(arr)
        buffer = io.BytesIO()
        img.save(buffer, format="PNG")
        data = buffer.getvalue()
        _validate_image_bytes(data)
        return data

    # matplotlib figures
    try:
        import matplotlib.figure  # type: ignore

        if isinstance(image, matplotlib.figure.Figure):
            buffer = io.BytesIO()
            image.savefig(buffer, format="png", dpi=dpi, bbox_inches="tight")
            data = buffer.getvalue()
            _validate_image_bytes(data)
            return data
    except ImportError:
        pass

    raise ImageConversionError(f"Tipo de imagen no soportado: {type(image)!r}")
