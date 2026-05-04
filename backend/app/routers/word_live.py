"""REST bridge for the Word live-edit companion."""

from __future__ import annotations

import subprocess
from typing import Any, Literal

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel, Field

from app.services import word_live

router = APIRouter(prefix="/api/word-live", tags=["word-live"])


class EditableRegionPayload(BaseModel):
    region_id: str = Field(min_length=1)
    kind: Literal["text", "table", "math", "image", "section-block"]
    content_control_tag: str = Field(min_length=1)
    title: str | None = None
    allowed_ops: list[str] = Field(default_factory=list)
    supports_ooxml_replace: bool = False
    locked: bool = False
    text_preview: str | None = None
    word_control_id: int | str | None = None
    source: str | None = None


class WordLiveOpenRequest(BaseModel):
    document_path: str | None = None
    docx_base64: str | None = None
    addin_version: str | None = None
    host: str = "word-desktop"
    regions: list[EditableRegionPayload] = Field(default_factory=list)


class WordLiveUpdateTextRequest(BaseModel):
    session_id: str = Field(min_length=1)
    region_id: str = Field(min_length=1)
    text: str
    document_version: int | None = None
    document_path: str | None = None
    docx_base64: str | None = None
    addin_version: str | None = None


class WordLiveReplaceFragmentRequest(BaseModel):
    session_id: str = Field(min_length=1)
    region_id: str = Field(min_length=1)
    fragment_ooxml: str = Field(min_length=1)
    document_version: int | None = None
    document_path: str | None = None
    docx_base64: str | None = None
    addin_version: str | None = None


class WordLiveResyncRequest(BaseModel):
    session_id: str = Field(min_length=1)
    document_path: str | None = None
    docx_base64: str | None = None
    regions: list[EditableRegionPayload] = Field(default_factory=list)
    addin_version: str | None = None
    document_version: int | None = None


class WordLiveLauncherOpenRequest(BaseModel):
    document_path: str | None = None
    use_picker: bool = True
    initial_directory: str | None = None


def _serialize_state(session: dict[str, Any]) -> dict[str, Any]:
    return {
        "session_id": session.get("session_id"),
        "document_path": session.get("document_path"),
        "document_version": session.get("document_version"),
        "host": session.get("host"),
        "addin_version": session.get("addin_version"),
        "schema_version": session.get("schema_version"),
        "created_at": session.get("created_at"),
        "updated_at": session.get("updated_at"),
        "validation_status": session.get("validation_status"),
        "validation_errors": session.get("validation_errors") or [],
        "warnings": session.get("warnings") or [],
        "unsupported_features": session.get("unsupported_features") or [],
        "document_hash": session.get("document_hash"),
        "last_action": session.get("last_action"),
        "regions": session.get("regions") or [],
    }


@router.post("/session/open")
async def open_word_live_session(request_data: WordLiveOpenRequest):
    try:
        session = word_live.open_word_live_session(
            document_path=request_data.document_path,
            docx_b64=request_data.docx_base64,
            addin_version=request_data.addin_version,
            host=request_data.host,
            regions=[region.model_dump() for region in request_data.regions],
        )
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail=f"Documento no encontrado: {exc}") from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"No se pudo abrir la sesion Word Live: {exc}") from exc
    return _serialize_state(session)


@router.get("/session/state")
async def get_word_live_session_state(session_id: str = Query(..., min_length=1)):
    session = word_live.get_word_live_session(session_id)
    if not session:
        raise HTTPException(status_code=404, detail="Sesion Word Live no encontrada")
    return _serialize_state(session)


@router.get("/regions")
async def list_word_live_regions(session_id: str = Query(..., min_length=1)):
    try:
        regions = word_live.list_word_live_regions(session_id)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    return {"session_id": session_id, "items": regions}


@router.post("/region/update-text")
async def update_word_live_text_region(request_data: WordLiveUpdateTextRequest):
    try:
        session = word_live.update_word_live_text_region(
            session_id=request_data.session_id,
            region_id=request_data.region_id,
            text=request_data.text,
            document_version=request_data.document_version,
            document_path=request_data.document_path,
            docx_b64=request_data.docx_base64,
            addin_version=request_data.addin_version,
        )
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"No se pudo actualizar la region: {exc}") from exc
    return _serialize_state(session)


@router.post("/region/replace-fragment")
async def replace_word_live_region_fragment(request_data: WordLiveReplaceFragmentRequest):
    try:
        session = word_live.replace_word_live_region_fragment(
            session_id=request_data.session_id,
            region_id=request_data.region_id,
            fragment_ooxml=request_data.fragment_ooxml,
            document_version=request_data.document_version,
            document_path=request_data.document_path,
            docx_b64=request_data.docx_base64,
            addin_version=request_data.addin_version,
        )
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"No se pudo reemplazar el fragmento: {exc}") from exc
    return _serialize_state(session)


@router.post("/session/resync")
async def resync_word_live_session(request_data: WordLiveResyncRequest):
    try:
        session = word_live.resync_word_live_session(
            session_id=request_data.session_id,
            document_path=request_data.document_path,
            docx_b64=request_data.docx_base64,
            regions=[region.model_dump() for region in request_data.regions],
            addin_version=request_data.addin_version,
            document_version=request_data.document_version,
        )
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"No se pudo resincronizar la sesion: {exc}") from exc
    return _serialize_state(session)


@router.post("/launcher/install")
async def install_word_live_launcher():
    try:
        return word_live.install_word_live_addin()
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except RuntimeError as exc:
        raise HTTPException(status_code=501, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"No se pudo registrar Word Live: {exc}") from exc


@router.post("/launcher/open")
async def open_word_live_launcher(request_data: WordLiveLauncherOpenRequest):
    try:
        return word_live.open_word_live_launcher(
            document_path=request_data.document_path,
            use_picker=request_data.use_picker,
            initial_directory=request_data.initial_directory,
        )
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail=f"Documento no encontrado: {exc}") from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except RuntimeError as exc:
        raise HTTPException(status_code=501, detail=str(exc)) from exc
    except subprocess.CalledProcessError as exc:
        stderr = exc.stderr or exc.stdout or str(exc)
        raise HTTPException(status_code=500, detail=f"Fallo lanzando Word Live: {stderr}") from exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"No se pudo abrir Word Live: {exc}") from exc
