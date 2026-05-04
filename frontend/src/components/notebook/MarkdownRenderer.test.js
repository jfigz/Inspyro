import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import MarkdownRenderer, { normalizeNotebookMathDelimiters } from './MarkdownRenderer';

const mockMermaidRender = jest.fn();
const mockMermaidInitialize = jest.fn();

jest.mock('mermaid', () => ({
  __esModule: true,
  default: {
    initialize: (...args) => mockMermaidInitialize(...args),
    render: (...args) => mockMermaidRender(...args),
  },
}));

describe('MarkdownRenderer', () => {
  beforeEach(() => {
    mockMermaidInitialize.mockClear();
    mockMermaidRender.mockReset();
    mockMermaidRender.mockResolvedValue({
      svg: '<svg class="mermaid-svg" viewBox="0 0 100 40"><text>diagram</text></svg>',
    });
    delete window.__inspyroTrustedMarkdownScript;
  });

  it('renders broad GFM markdown including tables, tasks, strikethrough and footnotes', async () => {
    const { container } = render(
      <MarkdownRenderer
        source={[
          '# Report',
          '',
          '- [x] checked item',
          '- [ ] open item',
          '',
          '| A | B |',
          '| - | - |',
          '| 1 | 2 |',
          '',
          '~~removed~~ and a footnote[^calc].',
          '',
          '[^calc]: Calculation note.',
        ].join('\n')}
      />,
    );

    await waitFor(() => expect(screen.getByRole('heading', { name: 'Report' })).toBeTruthy());
    expect(container.querySelectorAll('input[type="checkbox"]').length).toBe(2);
    expect(container.querySelector('table')?.textContent).toContain('1');
    expect(container.querySelector('table')?.textContent).toContain('2');
    expect(container.querySelector('del')?.textContent).toBe('removed');
    expect(container.querySelector('.footnotes')?.textContent).toContain('Calculation note.');
  });

  it('renders KaTeX for dollar math and notebook slash delimiters outside code', async () => {
    const { container } = render(
      <MarkdownRenderer
        source={[
          'Inline $a^2$ and slash \\(b^2\\).',
          '',
          '\\[ c = \\sqrt{a^2 + b^2} \\]',
          '',
          '`\\(not math\\)`',
          '',
          '```python',
          'value = "\\\\(still code\\\\)"',
          '```',
        ].join('\n')}
      />,
    );

    await waitFor(() => expect(container.querySelectorAll('.katex').length).toBeGreaterThanOrEqual(3));
    expect(container.querySelector('code')?.textContent).toContain('\\(not math\\)');
    expect(container.querySelector('pre code')?.textContent).toContain('still code');
    expect(normalizeNotebookMathDelimiters('`\\(x\\)` and \\(y\\)')).toContain('`\\(x\\)` and $y$');
  });

  it('renders Mermaid fences as inline diagrams', async () => {
    const { container } = render(
      <MarkdownRenderer
        source={[
          '```mermaid',
          'graph TD; A-->B;',
          '```',
        ].join('\n')}
      />,
    );

    await waitFor(() => expect(mockMermaidRender).toHaveBeenCalled());
    expect(mockMermaidInitialize).toHaveBeenCalledWith(expect.objectContaining({
      securityLevel: 'strict',
      startOnLoad: false,
    }));
    expect(container.querySelector('.markdown-mermaid-rendered svg')).toBeTruthy();
  });

  it('shows a safe Mermaid fallback when rendering fails', async () => {
    mockMermaidRender.mockRejectedValueOnce(new Error('bad diagram'));

    const { container } = render(
      <MarkdownRenderer
        source={[
          '```mermaid',
          'graph TD; A-->',
          '```',
        ].join('\n')}
      />,
    );

    await waitFor(() => expect(screen.getByText('Mermaid no se pudo renderizar')).toBeTruthy());
    expect(container.querySelector('.markdown-mermaid-error pre')?.textContent).toContain('graph TD');
    expect(container.querySelector('.markdown-mermaid-error')?.textContent).toContain('bad diagram');
  });

  it('sanitizes raw HTML when trusted mode is disabled', async () => {
    const { container } = render(
      <MarkdownRenderer
        source={'<button onclick="window.bad = true">Run</button><script>window.bad = true</script><a href="javascript:alert(1)">bad</a>'}
      />,
    );

    await waitFor(() => expect(screen.getByText('Run')).toBeTruthy());
    expect(container.querySelector('script')).toBeNull();
    expect(container.querySelector('button')?.getAttribute('onclick')).toBeNull();
    expect(container.querySelector('a')?.getAttribute('href') || '').not.toMatch(/^javascript:/i);
  });

  it('keeps trusted HTML and executes scripts when trusted mode is enabled', async () => {
    const { container } = render(
      <MarkdownRenderer
        trustHtml
        source={'<button onclick="window.__trustedClick = true">Run</button><script>window.__inspyroTrustedMarkdownScript = 7;</script>'}
      />,
    );

    await waitFor(() => expect(screen.getByText('Run')).toBeTruthy());
    await waitFor(() => expect(window.__inspyroTrustedMarkdownScript).toBe(7));
    expect(container.querySelector('button')?.getAttribute('onclick')).toContain('__trustedClick');
  });
});
