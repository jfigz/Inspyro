# Changelog 15 - notification-center

> **Última actualización:** 2026-04-28

---

## 2026-04-28 - Dropdown portalizado y badge responsivo

1. `NotificationCenter` renderiza el dropdown mediante portal React en `document.body`, con posición fija calculada desde el badge y clamp de ancho/alto al viewport.
2. El click-outside considera tanto el trigger como el panel portalizado, preservando cierre, lectura y navegación contextual sin cambiar props.
3. El badge colapsado compacta texto, contador y chevron por breakpoint para no empujar el estado de conexión ni el split de Agents.
4. La cobertura suma una regresión unitaria de portal/clamp y la suite E2E `responsive-overlap` valida apertura del dropdown en la matriz de viewports.

**Archivos:** `frontend/src/components/NotificationCenter.js`, `frontend/src/components/NotificationCenter.css`, `frontend/src/components/NotificationCenter.test.js`, `frontend/tests/helpers/layout.ts`, `frontend/tests/responsive-overlap.spec.ts`, `docs/modules/15-notification-center.md`, `docs/changelog/15-notification-center.md`

---

## 2026-04-26 - Header compacto y prompts contextuales fuera del feed

1. `NotificationCenter.css` reduce el ancho del badge colapsado y aplica truncado para convivir con conexión, Agents y toolbar notebook sin solapes.
2. `App.js` y `VisualizationPanel` dejan los prompts de dependencias vacías como estado inline, evitando notificaciones persistentes que no representan eventos accionables.
3. La prueba focalizada conserva el comportamiento del feed sin mover el ownership de navegación fuera de `App.js`.

**Archivos:** `frontend/src/components/NotificationCenter.css`, `frontend/src/components/NotificationCenter.test.js`, `frontend/src/App.js`, `frontend/src/components/VisualizationPanel.js`, `docs/modules/15-notification-center.md`, `docs/changelog/15-notification-center.md`

---

## 2026-04-19 - Sync documental de navegación y expansión inline

1. El módulo deja de describir mensajes largos como un detalle modal separado y pasa a documentar expansión inline dentro del mismo dropdown.
2. Se agrega el contrato documental de `target` metadata para notificaciones, con `App.js` como owner de la navegación contextual y `NotificationCenter` como renderer del feed.
3. Se sincroniza la semántica de click entre `Ver mas` / `Ver menos`, CTA navegable, acciones rápidas y dismiss para que la arquitectura y los E2E hablen del mismo flujo.

**Archivos:** `docs/modules/15-notification-center.md`, `docs/modules/14-main-app.md`, `docs/architecture/frontend-flow.md`, `docs/architecture/feature-threads.md`, `docs/architecture/synergy-matrix.md`, `docs/llm-index.yaml`, `docs/changelog/14-main-app.md`, `docs/changelog/15-notification-center.md`

---

## 2026-04-06 - Detalle expandible para mensajes largos

1. `NotificationCenter` detecta truncamiento real en título y mensaje dentro del dropdown, y solo en ese caso habilita la affordance `Ver completo`.
2. Las cards largas abren un panel de detalle portalizado, con overlay glassmorphism, scroll propio, cierre por `Escape`/backdrop y sin colapsar el dropdown original.
3. Se agrega cobertura de pruebas para apertura/cierre del detalle, compatibilidad legacy `message/type` y protección de acciones internas (`dismiss`, botones de acción).

**Archivos:** `frontend/src/components/NotificationCenter.js`, `frontend/src/components/NotificationCenter.css`, `frontend/src/components/NotificationCenter.test.js`, `docs/modules/15-notification-center.md`

---

## 2026-03-07 - Integración de notificaciones externas y actividad MCP

1. `NotificationCenter` mantiene compatibilidad con `message/type`, pero ahora puede renderizar una cola externa controlada por `App.js`.
2. Se agrega estado local de lectura para notificaciones externas (`externalReadIds`) de modo que eventos MCP y mensajes legacy puedan convivir en el mismo centro de notificaciones.
3. El nuevo flujo MCP usa esta API externa para avisar errores, reflejos aplicados y espejos omitidos por dirty state.

**Archivos:** `frontend/src/components/NotificationCenter.js`, `docs/modules/15-notification-center.md`, `docs/modules/14-main-app.md`

---

## 2026-02-06 - Inicialización del changelog

1. Se crea el changelog dedicado del módulo dentro de docs/changelog/.
2. El histórico detallado se moverá gradualmente desde la documentación de módulo.
