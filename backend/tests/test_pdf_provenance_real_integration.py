import base64
import json
import shutil
import subprocess
import sys
from pathlib import Path

import pytest

from librerias_propias.math_to_docx import build_doc, get_session
from app.services.pdf_converter import convert_docx_with_diagnostics


pytestmark = [pytest.mark.manual, pytest.mark.windows_com]


def test_real_word_pdf_keeps_provenance_annotation_visible_to_pdfjs(tmp_path: Path) -> None:
    node_bin = shutil.which("node")
    if not node_bin:
        pytest.skip("node no disponible en este entorno")

    repo_root = Path(__file__).resolve().parents[2]
    pdfjs_bundle = repo_root / "frontend" / "node_modules" / "pdfjs-dist" / "build" / "pdf.js"
    if not pdfjs_bundle.exists():
        pytest.skip("pdfjs-dist build/pdf.js no esta disponible en frontend/node_modules")

    namespace: dict[str, object] = {}
    with build_doc(order=1, namespace=namespace, block_id="cell-provenance-real-pdf") as builder:
        builder.text("Provenance real PDF")

    session = get_session(namespace)
    docx_b64 = session.export_docx_base64()
    manifest = json.loads(session.export_provenance_manifest_json())
    provenance_id = manifest["items"][0]["provenance_id"]

    conversion = convert_docx_with_diagnostics(docx_b64, timeout_s=120)
    assert conversion.get("error") is None, conversion
    assert conversion.get("converter_used") == "word", conversion
    assert conversion.get("pdf_b64"), conversion

    pdf_path = tmp_path / "provenance-real.pdf"
    pdf_path.write_bytes(base64.b64decode(conversion["pdf_b64"]))

    node_script = """
const fs = require('fs');
const pdfjs = require(process.argv[1]);
const pdfData = new Uint8Array(fs.readFileSync(process.argv[2]));

(async () => {
  const loadingTask = pdfjs.getDocument({ data: pdfData });
  const pdf = await loadingTask.promise;
  const annotations = [];
  for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
    const page = await pdf.getPage(pageNumber);
    const pageAnnotations = await page.getAnnotations({ intent: 'display' });
    for (const annotation of pageAnnotations) {
      annotations.push({
        pageNumber,
        subtype: annotation.subtype || null,
        url: annotation.url || null,
        unsafeUrl: annotation.unsafeUrl || null,
        dest: annotation.dest || null,
      });
    }
  }
  await loadingTask.destroy();
  process.stdout.write(JSON.stringify({ numPages: pdf.numPages, annotations }));
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
"""

    result = subprocess.run(
        [node_bin, "-e", node_script, str(pdfjs_bundle), str(pdf_path)],
        check=True,
        capture_output=True,
        text=True,
        cwd=str(repo_root),
    )
    payload = json.loads(result.stdout)
    annotations = payload.get("annotations") or []

    assert payload.get("numPages") == 1, payload
    assert any(
        annotation.get("subtype") == "Link"
        and provenance_id in str(annotation.get("url") or annotation.get("unsafeUrl") or "")
        for annotation in annotations
    ), payload
