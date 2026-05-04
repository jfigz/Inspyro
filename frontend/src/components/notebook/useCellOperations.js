/**
 * useCellOperations.js
 *
 * Custom hook extracted from NotebookEditor.js that encapsulates
 * all notebook cell CRUD operations: add, delete, update, and move.
 *
 * Centralises the notebook-mutation logic so NotebookEditor only
 * orchestrates execution and WebSocket messages.
 */
import { useCallback, useRef } from 'react';
import {
    NOTEBOOK_CELL_TYPE_MARKDOWN,
    normalizeNotebookCellType,
} from '../../utils/notebookCellTypes';

/**
 * @param {Function} setNotebook – React state setter for notebook
 * @param {React.MutableRefObject} notebookChangeReasonRef – Ref tracking change origin
 * @returns {{ updateCell, addCell, deleteCell, moveCell }}
 */
export function useCellOperations(setNotebook, notebookChangeReasonRef) {
    const cellIndexMapRef = useRef(new Map());

    /**
     * Rebuild the cellId→index map whenever the notebook changes.
     * The caller should invoke this inside a useEffect([notebook]).
     */
    const rebuildCellIndexMap = useCallback((notebook) => {
        const indexMap = new Map();
        if (notebook?.cells) {
            notebook.cells.forEach((cell, idx) => {
                if (cell?.id) indexMap.set(cell.id, idx);
            });
        }
        cellIndexMapRef.current = indexMap;
    }, []);

    /**
     * Patch a single cell by id without scanning the entire array.
     */
    const patchCellById = useCallback((cellId, updater) => {
        notebookChangeReasonRef.current = 'runtime';
        setNotebook(prev => {
            if (!prev) return prev;
            const idx = cellIndexMapRef.current.get(cellId);
            if (idx == null || idx < 0 || idx >= prev.cells.length) return prev;
            const original = prev.cells[idx];
            const updated = updater(original);
            if (!updated || updated === original) return prev;
            const cells = [...prev.cells];
            cells[idx] = updated;
            return { ...prev, cells };
        });
    }, [setNotebook, notebookChangeReasonRef]);

    const updateCell = useCallback((cellId, newSource, newCellType = null) => {
        notebookChangeReasonRef.current = 'persistable';
        setNotebook(prev => {
            if (!prev) return prev;
            const updatedCells = prev.cells.map(cell => (
                cell.id === cellId
                    ? { ...cell, source: newSource, cell_type: normalizeNotebookCellType(newCellType || cell.cell_type) }
                    : cell
            ));
            return { ...prev, cells: updatedCells };
        });
    }, [setNotebook, notebookChangeReasonRef]);

    const addCell = useCallback((index = -1, cellType = 'code') => {
        notebookChangeReasonRef.current = 'persistable';
        setNotebook(prev => {
            if (!prev) return prev;
            const normalizedCellType = normalizeNotebookCellType(cellType);
            const newCell = {
                id: Date.now().toString() + Math.random().toString(36).substr(2, 9),
                cell_type: normalizedCellType,
                source: [''],
                outputs: normalizedCellType === NOTEBOOK_CELL_TYPE_MARKDOWN ? undefined : [],
                execution_count: normalizedCellType === NOTEBOOK_CELL_TYPE_MARKDOWN ? undefined : null,
                metadata: {},
            };
            const insertIndex = index === -1 ? prev.cells.length : index + 1;
            const updatedCells = [...prev.cells];
            updatedCells.splice(insertIndex, 0, newCell);
            return { ...prev, cells: updatedCells };
        });
    }, [setNotebook, notebookChangeReasonRef]);

    const deleteCell = useCallback((cellId) => {
        notebookChangeReasonRef.current = 'persistable';
        setNotebook(prev => {
            if (!prev || prev.cells.length <= 1) return prev;
            const updatedCells = prev.cells.filter(cell => cell.id !== cellId);
            return { ...prev, cells: updatedCells };
        });
    }, [setNotebook, notebookChangeReasonRef]);

    const moveCell = useCallback((cellId, direction) => {
        notebookChangeReasonRef.current = 'persistable';
        setNotebook(prev => {
            if (!prev) return prev;
            const cells = [...prev.cells];
            const currentIndex = cells.findIndex(cell => cell.id === cellId);
            if (currentIndex === -1) return prev;
            const newIndex = direction === 'up' ? currentIndex - 1 : currentIndex + 1;
            if (newIndex < 0 || newIndex >= cells.length) return prev;
            [cells[currentIndex], cells[newIndex]] = [cells[newIndex], cells[currentIndex]];
            return { ...prev, cells };
        });
    }, [setNotebook, notebookChangeReasonRef]);

    const updateCellOutput = useCallback((cellId, outputs, executionCount, durationMs = null) => {
        patchCellById(cellId, (cell) => {
            const newMetadata = { ...cell.metadata };
            if (durationMs !== null) {
                newMetadata.execution_duration = durationMs;
            }
            return { ...cell, outputs, execution_count: executionCount, metadata: newMetadata };
        });
    }, [patchCellById]);

    return {
        cellIndexMapRef,
        rebuildCellIndexMap,
        patchCellById,
        updateCell,
        addCell,
        deleteCell,
        moveCell,
        updateCellOutput,
    };
}
