# Arquitectura General de Inspyro

> **Última actualización:** 2026-02-06
> **Lectura recomendada para IA:** empezar por `docs/llm-index.yaml`.

---

## Visión global

Inspyro integra tres dominios principales:

1. **Edición y UX** (React): notebooks, editor Monaco, paneles de visualización.
2. **Orquestación de ejecución** (FastAPI + WS): dispatcher de mensajes y handlers.
3. **Procesamiento especializado** (kernel, LSP, DOCX/PDF, análisis): servicios backend y procesos externos.

---

## Mapa de arquitectura canónica

1. `docs/architecture/system-context.md`
2. `docs/architecture/contracts-catalog.md`
3. `docs/architecture/feature-threads.md`
4. `docs/architecture/synergy-matrix.md`
5. `docs/architecture/glossary.md`

---

## Topología resumida

```text
Frontend (React) ── WS/REST ──> Backend (FastAPI dispatcher)
        │                               │
        │                               ├─> Jupyter Kernel (ipykernel)
        │                               ├─> LSP Bridge (pylsp)
        │                               ├─> Template Service
        │                               └─> PDF Converter
        └────────────── consume resultados y estado ──────────────┘
```

---

## Fuente de verdad por tema

| Tema | Fuente canónica |
|------|------------------|
| Contratos WS/REST | `docs/architecture/contracts-catalog.md` |
| Flujos E2E | `docs/architecture/feature-threads.md` |
| Sinergias módulo↔módulo | `docs/architecture/synergy-matrix.md` |
| Navegación LLM | `docs/llm-index.yaml` |
| Detalle técnico por módulo | `docs/modules/*.md` |

---

## Regla operativa

Si cambia arquitectura, contratos o ownership de estado, actualizar en la misma sesión:

1. `docs/llm-index.yaml`
2. `docs/architecture/contracts-catalog.md`
3. `docs/architecture/feature-threads.md`
4. `docs/architecture/synergy-matrix.md`