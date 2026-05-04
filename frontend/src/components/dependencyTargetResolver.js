const PYTHON_DECLARATION_KEYWORDS = new Set(['def', 'class', 'async']);
const IDENTIFIER_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;
const DOTTED_IDENTIFIER_RE = /^[A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)*$/;

function isUsableSymbol(text) {
    return typeof text === 'string' && DOTTED_IDENTIFIER_RE.test(text.trim());
}

function normalizeSelectedSymbol(text) {
    if (typeof text !== 'string') return null;
    const normalized = text.trim();
    return isUsableSymbol(normalized) ? normalized : null;
}

function getSelectionSymbol(model, selection, mode) {
    if (!model || !selection || typeof model.getValueInRange !== 'function') return null;
    const startLine = selection.startLineNumber;
    const endLine = selection.endLineNumber;
    const startColumn = selection.startColumn;
    const endColumn = selection.endColumn;
    const hasSelection = startLine !== endLine || startColumn !== endColumn;
    if (!hasSelection) return null;

    const selectedSymbol = normalizeSelectedSymbol(model.getValueInRange(selection));
    if (!selectedSymbol) return null;

    return {
        symbol: selectedSymbol,
        line: startLine,
        column: Math.max(0, startColumn - 1),
        mode,
    };
}

function findNextIdentifierOnLine(lineContent, startColumnOneBased) {
    if (typeof lineContent !== 'string') return null;
    const startIndex = Math.max(0, Number(startColumnOneBased || 1) - 1);
    const suffix = lineContent.slice(startIndex);
    const identifierMatch = suffix.match(/[A-Za-z_][A-Za-z0-9_]*/g);
    if (!identifierMatch) return null;

    for (const word of identifierMatch) {
        if (!IDENTIFIER_RE.test(word) || PYTHON_DECLARATION_KEYWORDS.has(word)) {
            continue;
        }
        const relativeIndex = suffix.indexOf(word);
        return {
            word,
            column: startIndex + relativeIndex,
        };
    }
    return null;
}

export function resolveDependencyTargetFromModel(model, position, { mode = 'dependencies', selection = null } = {}) {
    const selectionTarget = getSelectionSymbol(model, selection, mode);
    if (selectionTarget) return selectionTarget;
    if (!model || !position || typeof model.getWordAtPosition !== 'function') return null;

    const word = model.getWordAtPosition(position);
    if (!word?.word) return null;

    let symbol = word.word;
    let column = Math.max(0, (word.startColumn || position.column || 1) - 1);

    if (PYTHON_DECLARATION_KEYWORDS.has(symbol) && typeof model.getLineContent === 'function') {
        const lineContent = model.getLineContent(position.lineNumber);
        const nextIdentifier = findNextIdentifierOnLine(lineContent, word.endColumn || position.column || 1);
        if (nextIdentifier) {
            symbol = nextIdentifier.word;
            column = nextIdentifier.column;
        }
    }

    if (!isUsableSymbol(symbol)) return null;

    return {
        symbol,
        line: position.lineNumber,
        column,
        mode,
    };
}

