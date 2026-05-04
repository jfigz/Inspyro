# 22 - Repo Hygiene Cleanup

> **Última actualización:** 2026-04-20
> **Ámbito:** orden documental + saneamiento de scripts/tests

## 2026-04-20 - Poda segura de ruido tracked y código huérfano

1. Se sacaron del control de versiones artefactos generados que no forman parte del producto:
   - `.agent_logs/**`
   - `backend/tmp/**`
   - `backend/backend/tmp/**`
2. `.gitignore` ahora bloquea el reingreso de esos directorios generados al repo.
3. Se eliminaron módulos frontend ya reemplazados y sin referencias productivas:
   - `frontend/src/components/dependency-graph/ContainerNode.js`
   - `frontend/src/components/dependency-graph/graphUtils.js`
4. Se eliminaron scripts `backend/dev/` huérfanos, sin rol en gates oficiales ni referencias vigentes fuera de historial:
   - `benchmark_dependency.py`
   - `create_template_fixture.py`
   - `debug_calculation.py`
   - `debug_calculation_fixed.py`
   - `deps_probe.py`
   - `fix_word_lock.py`
   - `impact_context_probe.py`
   - `impact_probe.py`
   - `verify_refactor.py`
   - `verify_startup.py`
5. Se mantuvieron fuera de la poda los demos y smoke útiles (`demo_*.ipynb`, `mcp-iter-smoke/**`, `mcp-ui-mirror-smoke/**`) para no degradar cobertura manual o material de referencia.

**Impacto:** sin cambios de contratos WS/REST ni de comportamiento funcional visible; menos ruido tracked y menor riesgo de recircular evidencia generada.

## 2026-02-22 - Orden de scripts, hardening de gates y limpieza de drift

1. Se reubicaron scripts de release a `tools/release/`:
   - `create_export_zip.py`
   - `verify_zip_content.py`
2. Se reubicaron probes de impacto y diagnóstico a `backend/dev/` con naming no coleccionable por pytest:
   - `impact_probe.py`
   - `impact_context_probe.py`
   - `deps_probe.py` (antes `test_deps.py`)
3. Se eliminaron scripts legacy/one-off no confiables:
   - `debug_pdf_trigger.py`
   - `backend/refactor_script.py`
   - `backend/dev/reproduce_issue.py`
4. `backend/pytest.ini` ahora fija `testpaths = tests` para evitar colección accidental de `backend/dev`.
5. `docs/tools/validate_docs.ps1` incorpora:
   - validación de existencia de rutas `modules[*].source_files` en `docs/llm-index.yaml`
   - validación de ubicación de scripts `test_*.py` (prohibidos en raíz y `backend/dev`)
6. Se corrigió documentación canónica para eliminar referencias vigentes a rutas obsoletas y tests inexistentes:
   - `docs/llm-index.yaml`
   - `docs/modules/17-template-editor.md`
   - `docs/architecture/synergy-matrix.md`
   - `docs/modules/01-document-generation-docx.md`
   - `docs/modules/02-websocket-manager.md`
   - `docs/modules/03-file-system-api.md`
   - `docs/modules/08-lsp-bridge.md`
   - `AGENTS.md`

**Impacto:** sin cambios de contratos WS/REST; mejora de mantenibilidad y reducción de falsos positivos en validaciones.
