# Módulo 15: Centro de Notificaciones (NotificationCenter)

> **Última actualización:** 2026-04-28
> **Changelog:** `docs/changelog/15-notification-center.md`
> **Archivos principales:** `frontend/src/components/NotificationCenter.js`, `frontend/src/components/NotificationCenter.css`  
> **Versión:** 3.0.0

---

## Descripción General

El **Centro de Notificaciones** es el feed centralizado de mensajes y alertas de Inspyro. Vive en el bloque derecho del `DesktopTitleBar`, mezcla notificaciones legacy con eventos externos estructurados (por ejemplo, actividad de agentes/MCP) y funciona como renderer del shell: `App.js` sigue siendo la fuente de verdad de la cola, del estado de descarte y de la navegación contextual que parte desde una notificación.

### Características v3.0

- **Pill badge** colapsado con mensaje y contador de no leídas
- **Dropdown con glassmorphism** (efecto blur/transparencia)
- **Cards individuales** con hover effects y animaciones
- **Expansión inline** para mensajes truncados dentro del mismo dropdown
- **Agrupación temporal**: "Ahora", "Hace un momento", "Antes"
- **Timestamps relativos**: "hace 2 min"
- **Notificaciones de progreso** con barra animada
- **Acciones rápidas** (botones clickeables)
- **Metadatos `target` opcionales** para navegación contextual resuelta por `App.js`
- **Dismiss individual y global**
- **Dropdown portalizado y viewport-aware** para no quedar oculto por el `DesktopTitleBar`
- **Badge compacto con truncado estable** para convivir con conexión, Agents y toolbar contextual sin solaparse

---

## Vista Previa

### Vista Colapsada (Pill Badge)
```
┌─────────────────────────────────────────┐
│ ✓ PDF generado exitosamente       3  ▼ │
└─────────────────────────────────────────┘
     │                              │  │
     └─ Icono tipo                  │  └─ Chevron expandir
                                    └─ Contador no leídas
```

### Vista Expandida (Dropdown)
```
┌───────────────────────────────────┐
│ 🔔 Notificaciones (5)    Limpiar │
├───────────────────────────────────┤
│ Ahora                             │
│ ┌─────────────────────────────┐   │
│ │ ✓ PDF generado       ahora  │   │
│ │   Documento convertido...   │   │
│ └─────────────────────────────┘   │
│                                   │
│ Hace un momento                   │
│ ┌─────────────────────────────┐   │
│ │ ℹ Kernel iniciado  hace 5m  │   │
│ └─────────────────────────────┘   │
└───────────────────────────────────┘
```

### Vista Expandida Inline (Mensaje Largo)
```
┌──────────────────────────────────────┐
│ ℹ Agents: execute_cell        hace 5m│
│   Resumen truncado…                  │
│   Ver mas                            │
├──────────────────────────────────────┤
│   Mensaje completo expandido en la   │
│   misma card, manteniendo el scroll  │
│   y el contexto del dropdown.        │
│                                      │
│   [Abrir notebook] [Reintentar]      │
└──────────────────────────────────────┘
```

---

## Arquitectura

```text
NotebookEditor / hooks / MCP / filesystem / documento
    ↓ onStatusMessage(...) o pushNotification(...)
App.js (owner de cola, target metadata y navegación)
    ↓
DesktopTitleBar
    ↓ props: notifications / onDismiss / onDismissAll / onNavigate
NotificationCenter (UI + read state + expand inline)
```

## Ajuste 2026-04-28 - Portal fijo y clamp responsivo

- El dropdown se renderiza en `document.body` mediante portal React y se posiciona con `getBoundingClientRect()` del badge, margen fijo y clamp contra ancho/alto de viewport.
- El panel conserva scroll interno, ancho máximo y alto máximo calculados, por lo que ventanas cortas o angostas no esconden header, acciones ni cards fuera de pantalla.
- El badge degrada a compacto/icon-only en breakpoints estrechos antes de empujar el estado de conexión o `McpStatusButton`.
- La regresión `responsive-overlap` abre el dropdown en una matriz de viewports y valida que el rectángulo visible permanezca dentro del viewport.

---

## Ajuste 2026-04-26 - Menos ruido y mejor convivencia en header

- Los mensajes de orientación como `Selecciona un simbolo...` permanecen en la superficie que los produce (`VisualizationPanel`) y no se promueven a notificación persistente.
- El badge colapsado reduce su ancho máximo y trunca el texto antes de competir con `McpStatusButton`, estado de conexión o acciones del notebook.
- `NotificationCenter` sigue siendo renderer del feed: la decisión de descartar prompts contextuales pertenece a `App.js`/componentes dueños del flujo, no al dropdown.

---

## Props del Componente

```javascript
NotificationCenter({
  // API de compatibilidad (legacy)
  message,              // string - Mensaje a mostrar
  type = 'info',        // 'info' | 'success' | 'warning' | 'error' | 'progress'
  
  // API nueva (opcional)
  notifications,        // Array de objetos notificación
  onDismiss,           // (id) => void
  onDismissAll,        // () => void
  onAction,            // (notifId, action) => void
  onNavigate          // (target, notification) => Promise<boolean>|boolean
})
```

---

## Estructura de Notificación

```javascript
{
  id: string|number,    // Identificador único
  type: string,         // 'info' | 'success' | 'warning' | 'error' | 'progress'
  title: string,        // Título corto (opcional)
  message: string,      // Mensaje completo
  timestamp: Date,      // Fecha de creación
  read: boolean,        // Estado leído/no leído
  progress?: number,    // 0-100 para tipo 'progress'
  target?: {            // Destino contextual opcional
    kind: string,       // 'file' | 'code' | 'document' | 'template' | 'workspace' | 'agents'
    path?: string,
    filePath?: string,
    sourcePath?: string,
    line?: number,
    column?: number,
    cellId?: string,
    cellIndex?: number,
    focusView?: string,
    surface?: 'home' | 'file',
    panel?: string
  },
  actions?: [{          // Acciones clickeables (opcional)
    label: string,
    onClick: () => void
  }],
  dismissible: boolean  // Puede cerrarse manualmente
}
```

---

## Uso

### API de Compatibilidad (Legacy)

```javascript
// Desde cualquier componente hijo
onStatusMessage?.('PDF generado con Word', 'success');
onStatusMessage?.('Error al guardar', 'error');
onStatusMessage?.('Procesando...', 'info');
```

### API Nueva (Avanzada)

```javascript
// Con título y mensaje separados
notify({
  type: 'success',
  title: 'Documento listo',
  message: 'El PDF y el DOCX ya estan disponibles para este notebook.',
  target: {
    kind: 'document',
    sourcePath: notebookPath,
    sourceKind: 'notebook',
    surface: 'file',
  },
  actions: [{
    label: 'Ver PDF',
    onClick: () => setActiveTab('pdf')
  }]
});

// Notificación de progreso
const progressId = notify({
  type: 'progress',
  title: 'Convirtiendo a PDF...',
  message: 'Procesando documento',
  progress: 0
});

// Actualizar progreso
updateProgress(progressId, 50);
updateProgress(progressId, 100);
```

### API Nueva (Feed externo MCP)

```javascript
pushNotification({
  id: event.event_id,
  type: event.phase === 'failed' ? 'error' : 'success',
  title: `Agents: ${event.tool_name}`,
  message: event.summary,
  timestamp: new Date(event.ts),
  target: event.ui_hints?.artifact ? {
    kind: 'document',
    sourcePath: event.resource?.notebook_path,
    sourceKind: 'notebook',
    surface: 'file',
  } : null,
  dismissible: true
});
```

---

## Tipos de Mensaje

| Tipo | Color | Icono | Uso |
|------|-------|-------|-----|
| `info` | Azul `#58a6ff` | ℹ️ | Información general |
| `success` | Verde `#3fb950` | ✓ | Operación exitosa |
| `warning` | Naranja `#d29922` | ⚠ | Advertencia |
| `error` | Rojo `#f85149` | ✕ | Error crítico |
| `progress` | Azul animado | ⏱ | Operación en curso |

---

## Estilos CSS

### Variables del Componente

```css
--notif-success: #3fb950;
--notif-info: #58a6ff;
--notif-warning: #d29922;
--notif-error: #f85149;
```

### Clases Principales

| Clase | Descripción |
|-------|-------------|
| `.notification-center` | Contenedor raíz |
| `.notification-badge` | Pill badge colapsado |
| `.notification-dropdown` | Panel expandido portalizado, fijo y clampado al viewport |
| `.notification-card` | Card individual |
| `.notification-card__body` | Área principal de la card, navegable solo si existe `target` |
| `.notification-card__expanded` | Región expandida inline con contenido completo |
| `.notification-card__expand-button` | CTA real `Ver mas` / `Ver menos` |
| `.notification-group` | Grupo temporal |

### Efectos

- **Glassmorphism**: `backdrop-filter: blur(16px)`
- **Animación entrada**: `slideIn` de derecha
- **Pulse nuevas**: `badgePulse` con glow
- **Progress shimmer**: Gradiente animado
- **Clamp elegante**: título a una línea, mensaje a cuatro líneas con fade

## Metadatos de destino y semántica de click

- `App.js` puede adjuntar un objeto `target` a cada notificación para describir un destino navegable (`file`, `code`, `document`, `template`, `workspace` o `agents`).
- `NotificationCenter` no decide la navegación por si solo: la resolución real del `target` pertenece al shell vía `App.js` y sus callbacks (`openWorkspaceResource`, `handleNavigateToCode`, `focusDocxView`, `setWorkspaceSurface`, etc.).
- El click principal deja de ser uniforme: si la notificación trae `target`, el shell puede usarlo como CTA primario; si no hay destino pero sí truncamiento, la card alterna expansión inline dentro de la lista.
- El affordance `Ver mas` aparece solo si existe truncamiento real medido en runtime, y alterna con `Ver menos` cuando la card ya está expandida.
- La expansión inline conserva el dropdown abierto, no crea un overlay dedicado y no roba foco global del shell.
- Los botones de acción y descarte mantienen `stopPropagation`, de modo que no disparan ni navegación ni expansión inline accidental.

---

## Integración con App.js

```javascript
import NotificationCenter from './components/NotificationCenter';

// Integrado dentro de DesktopTitleBar
<DesktopTitleBar
  notifications={notifications}
  onDismissNotification={dismissNotification}
  onDismissAllNotifications={dismissAllNotifications}
  onNavigate={dispatchNotificationTarget}
  connectionStatus={connectionStatus}
  connectionStatusText={connectionStatusText}
  mcpStatus={mcpStatus}
  onToggleMcpPanel={() => setMcpPanelOpen((value) => !value)}
/>
```

`App.js` es además el owner del modelo de notificación visible: normaliza `title/message/type/progress`, deduplica por `id`, decide cuándo emitir notificaciones nativas aparte del feed interno y resuelve la navegación contextual cuando una entrada trae `target`.

---

## Archivos Relacionados

| Archivo | Propósito |
|---------|-----------|
| `NotificationCenter.js` | Componente React principal |
| `NotificationCenter.css` | Estilos modernos |
| `App.js` | Cola visible, dedupe, targets y navegación contextual |
| `NotebookEditor.js` | Principal emisor de mensajes |
| `useMcpActivity.js` | Emisor de notificaciones MCP estructuradas |
| `StatusBar.js` | Versión legacy (obsoleta) |
| `StatusBar.css` | Estilos legacy (obsoleto) |

---

## Cambios recientes

1. El comportamiento de mensajes largos pasa a documentarse como expansión inline dentro del dropdown, en vez de una vista modal separada.
2. El resumen del dropdown se compacta con clamp visual para evitar que mensajes muy largos deformen la lista.
3. `NotificationCenter` acepta una cola externa administrada por `App.js`, sin romper la API legacy `message/type`.
4. Las notificaciones externas mantienen estado de lectura local (`externalReadIds`) para poder mezclar eventos de agentes/MCP y mensajes tradicionales en el mismo feed.
5. El modelo documental del shell ahora admite `target` metadata para que `App.js` resuelva navegación explícita entre `workspace`, archivo, código, documento, template y agentes.
6. El click primario, la expansión inline y las acciones secundarias se documentan como semánticas distintas para evitar ambigüedad entre "leer más" y "navegar".
7. El dropdown deja de depender del overflow del titlebar: se portaliza al `body`, se fija al viewport y recalcula posición en resize/scroll.

---

## Migración desde StatusBar

El nuevo componente es compatible con la API existente. No se requieren cambios en los componentes que usan `onStatusMessage`. La migración consiste únicamente en:

1. Cambiar import en `App.js`
2. Cambiar el componente `<StatusBar>` por `<NotificationCenter>`

Los archivos `StatusBar.js` y `StatusBar.css` pueden eliminarse cuando se confirme el correcto funcionamiento.
