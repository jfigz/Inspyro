import {
  buildNotebookIndexEntryId,
  deriveNotebookIndex,
  normalizeNotebookHeadingTitle,
  normalizeNotebookMarkdownSource,
  resolveActiveNotebookIndexItemId,
} from './deriveNotebookIndex';

describe('deriveNotebookIndex', () => {
  it('builds a hierarchical outline from markdown notebook cells only', () => {
    const cells = [
      {
        id: 'md-1',
        cell_type: 'markdown',
        source: [
          '# Portada\n',
          'Texto introductorio\n',
          '## Alcance\n',
          '```python\n',
          '# heading ignorado\n',
          '```\n',
          '### Detalle [uno](https://example.com)\n',
        ],
      },
      {
        id: 'code-1',
        cell_type: 'code',
        source: ['# no cuenta'],
      },
      {
        id: 'md-2',
        cell_type: 'markdown',
        source: '## **Resultados**\n### `Flecha`\n# Cierre',
      },
    ];

    const indexData = deriveNotebookIndex(cells);

    expect(indexData.flatItems.map((item) => item.title)).toEqual([
      'Portada',
      'Alcance',
      'Detalle uno',
      'Resultados',
      'Flecha',
      'Cierre',
    ]);
    expect(indexData.items).toHaveLength(2);
    expect(indexData.items[0].title).toBe('Portada');
    expect(indexData.items[0].children[0].title).toBe('Alcance');
    expect(indexData.items[0].children[0].children[0].title).toBe('Detalle uno');
    expect(indexData.items[0].children[1].title).toBe('Resultados');
    expect(indexData.items[1].title).toBe('Cierre');
    expect(indexData.flatItems[0].id).toBe('notebook-index:md-1:1:1');
    expect(indexData.flatItems[3].navigation).toEqual({
      cellId: 'md-2',
      cellIndex: 2,
      line: 1,
      column: 0,
    });
  });

  it('resolves the active entry by explicit id or by nearest heading inside a cell', () => {
    const indexData = deriveNotebookIndex([
      {
        id: 'md-1',
        cell_type: 'markdown',
        source: '# Portada\n## Alcance\n### Detalle',
      },
    ]);

    expect(resolveActiveNotebookIndexItemId(indexData, {
      activeEntryId: 'notebook-index:md-1:2:2',
    })).toBe('notebook-index:md-1:2:2');

    expect(resolveActiveNotebookIndexItemId(indexData, {
      activeCellId: 'md-1',
      activeLine: 3,
    })).toBe('notebook-index:md-1:3:3');

    expect(resolveActiveNotebookIndexItemId(indexData, {
      activeCellId: 'md-1',
      activeLine: 2.5,
    })).toBe('notebook-index:md-1:2:2');
  });

  it('exposes small pure helpers for stable ids and normalization', () => {
    expect(normalizeNotebookMarkdownSource(['# A\r\n', '## B\r\n'])).toBe('# A\n## B\n');
    expect(normalizeNotebookHeadingTitle('**Titulo** con [link](https://x.test) y `codigo`')).toBe('Titulo con link y codigo');
    expect(buildNotebookIndexEntryId({ cellId: 'cell a', line: 4, ordinal: 2 })).toBe('notebook-index:cell%20a:4:2');
  });
});
