# 13 - Monaco Editor

> **Estado:** 🟡 Revisable  
> **Ubicación:** `frontend/src/components/MonacoEditorLSP.js`
> **Última actualización:** 2026-02-21
> **Changelog:** `docs/changelog/13-monaco-editor.md`

---

## Propósito

Editor de código con:
- Autocompletado inteligente via LSP
- Diagnósticos en tiempo real
- Contexto de notebook (cross-cell references)
- Menú contextual con acciones de dependencias

---

## Archivos

| Archivo | Líneas (referencial) | Descripción |
|---------|-----------------------|-------------|
| `MonacoEditorLSP.js` | ~760 | Editor principal |
| `MonacoEditor.js` | ~20 | Re-export wrapper |

---

## Dependencias

### Externas
- `@monaco-editor/react` - React bindings para Monaco
- `monaco-languageclient` - Cliente LSP
- `vscode-ws-jsonrpc` - WebSocket para LSP

---

## Props del Componente

```typescript
interface MonacoEditorProps {
    value: string;                    // Código fuente
    onChange: (value: string) => void;
    language?: string;                // 'python', 'markdown', etc.
    readOnly?: boolean;
    height?: string;
    theme?: string;
    
    // Contexto de notebook
    notebookContext?: {
        precedingCells: string[];     // Código de celdas anteriores
        notebookPath: string;         // Path del archivo
        cellIndex: number;            // Índice de la celda
    };
    
    // Callbacks
    onShowDependencyTree?: (info) => void;
    onShowImpact?: (info) => void;
}
```

---

## Conexión LSP

```javascript
useEffect(() => {
    // Conectar a /ws/lsp al montar
    const ws = new WebSocket('ws://localhost:8000/ws/lsp');
    
    ws.onopen = () => {
        // Inicializar LSP
        sendRequest('initialize', {
            rootUri: 'file:///./',
            capabilities: { ... }
        });
    };
    
    return () => ws.close();
}, []);
```

---

## Documento Virtual

Para soportar referencias cross-cell, se crea un documento virtual:

```python
# Celda 1
import numpy as np
x = 42

# Celda 2
np.  # ← LSP ve numpy de celda 1

# --- Celda Actual ---
# Código de la celda actual
print(x)  # ← LSP ve x de celda 1
```

```javascript
function buildVirtualDocument(precedingCells, currentCell) {
    const parts = [];
    
    precedingCells.forEach((cell, i) => {
        parts.push(`# Cell ${i + 1}`);
        parts.push(cell);
        parts.push('');
    });
    
    parts.push('# --- Celda Actual ---');
    parts.push(currentCell);
    
    return parts.join('\n');
}
```

---

## Menú Contextual

```javascript
// Agregar acciones al menú contextual
editor.addAction({
    id: 'show-dependency-tree',
    label: '🌳 Ver Árbol de Dependencias',
    keybindings: [
        monaco.KeyMod.CtrlCmd | monaco.KeyMod.Shift | monaco.KeyCode.KeyD
    ],
    contextMenuGroupId: 'navigation',
    run: (ed) => {
        const position = ed.getPosition();
        const word = ed.getModel().getWordAtPosition(position);
        
        if (word && onShowDependencyTree) {
            onShowDependencyTree({
                symbol: word.word,
                line: position.lineNumber,
                column: position.column
            });
        }
    }
});
```

---

## Filtrado de Diagnósticos

Los diagnósticos del documento virtual se filtran para mostrar solo los de la celda actual:

```javascript
function filterDiagnostics(diagnostics, lineOffset) {
    return diagnostics
        .filter(d => d.range.startLine >= lineOffset)
        .map(d => ({
            ...d,
            range: {
                ...d.range,
                startLine: d.range.startLine - lineOffset,
                endLine: d.range.endLine - lineOffset
            }
        }));
}
```

---

## Configuración del Editor

```javascript
const editorOptions = {
    minimap: { enabled: false },
    scrollBeyondLastLine: false,
    fontSize: 14,
    lineNumbers: 'on',
    tabSize: 4,
    automaticLayout: true,
    quickSuggestions: true,
    suggestOnTriggerCharacters: true,
    acceptSuggestionOnEnter: 'on',
    wordWrap: 'on',
    scrollbar: {
        vertical: 'auto',
        horizontal: 'auto',
        alwaysConsumeMouseWheel: false  // Permite scroll chaining al padre
    }
};
```

---

## Posibles Mejoras

1.  **Extraer hook de LSP**: `useLSPConnection()`
2.  **Extraer contexto de notebook**: `useNotebookContext()`
3.  **Separar configuración**: `editorConfig.js`

---

## Testing

```javascript
// MonacoEditorLSP.test.js

describe('MonacoEditorLSP', () => {
    it('renders editor with initial value', () => {
        render(<MonacoEditorLSP value="print('hello')" />);
        expect(screen.getByRole('textbox')).toBeInTheDocument();
    });
    
    it('calls onChange when content changes', () => {
        const onChange = jest.fn();
        render(<MonacoEditorLSP value="" onChange={onChange} />);
        
        // Simular cambio...
        expect(onChange).toHaveBeenCalled();
    });
});
```

---

## Cambios Recientes

| Fecha | Cambio |
|-------|--------|
| 2026-02-19 | Cleanup menor: se elimina contador global de request IDs no usado para reducir ruido de lint, manteniendo contador por instancia (`_requestIdCounter`) |
| 2026-02-19 | **LSP URI mapping:** `_modelToDocUri` Map para resolver completado/hover al documento correcto por celda; `requestIdCounter` migrado a instancia; `disconnect()` captura `oldWs` para evitar cerrar WS nuevo |
| 2026-02-21 | Normalización de `source` de celdas previas para documento virtual/offset de diagnósticos; menú contextual de dependencias envía `column` en base 0 para alinearse con AST backend |
| 2026-02-07 | Cleanup de warnings: estado local no usado (`lspStatus`) y encapsulación local de `no-template-curly-in-string` para snippets de fallback |
| 2026-01 | **Scroll Chaining:** `alwaysConsumeMouseWheel: false` para propagar scroll |
| 2025-12 | Menú contextual para dependencias |
| 2025-11 | Soporte cross-cell via documento virtual |
| 2025-11 | Configuración de extra_paths para stubs |
