from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import FileResponse

from app.services.pdf_downloads import PDF_MIME_TYPE, get_pdf_file

router = APIRouter(prefix="/api/pdf", tags=["pdf"])


@router.get("/download")
async def download_pdf(
    token: str = Query(..., min_length=10),
    inline: bool = Query(True, description="Si true responde inline para iframe; false fuerza descarga"),
):
    info = get_pdf_file(token)
    if not info:
        raise HTTPException(status_code=404, detail="PDF no disponible o expirado")
    filename = str(info.get("filename") or "inspyro_document.pdf").replace('"', "")
    return FileResponse(
        info["path"],
        media_type=PDF_MIME_TYPE,
        filename=filename,
        content_disposition_type="inline" if inline else "attachment",
    )
