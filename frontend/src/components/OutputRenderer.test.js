import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import OutputRenderer from './OutputRenderer';

jest.mock('./notebook/MarkdownRenderer', () => function MockMarkdownRenderer({ source }) {
  return <div data-testid="markdown-output">{source}</div>;
});

jest.mock('katex', () => ({
  __esModule: true,
  default: {
    renderToString: jest.fn((latex) => `<span data-testid="latex-output">${latex}</span>`),
  },
}));

jest.mock('plotly.js-dist-min', () => ({
  __esModule: true,
  default: {
    newPlot: jest.fn((node) => {
      node.textContent = 'plotly rendered';
      return Promise.resolve();
    }),
  },
}));

jest.mock('vega-embed', () => ({
  __esModule: true,
  default: jest.fn((node) => {
    node.textContent = 'vega rendered';
    return Promise.resolve();
  }),
}));

describe('OutputRenderer', () => {
  it('renders stream and error outputs as readable result blocks', () => {
    const { rerender } = render(
      <OutputRenderer output={{ output_type: 'stream', name: 'stdout', text: ['hello', '\n'] }} />,
    );

    expect(screen.getByText('hello').classList.contains('stdout')).toBe(true);

    rerender(
      <OutputRenderer
        output={{
          output_type: 'error',
          ename: 'ValueError',
          evalue: 'bad input',
          traceback: ['\u001b[31mValueError\u001b[0m: bad input'],
        }}
      />,
    );

    expect(screen.getAllByText('ValueError: bad input').length).toBeGreaterThan(0);
    expect(screen.getByText('ValueError: bad input', { selector: 'pre' }).classList.contains('output-error')).toBe(true);
  });

  it('renders common rich MIME outputs without dropping them', async () => {
    const { container, rerender } = render(
      <OutputRenderer
        output={{
          output_type: 'display_data',
          data: { 'text/html': '<table><tbody><tr><td>12</td></tr></tbody></table><script>bad()</script>' },
        }}
      />,
    );

    expect(screen.getByText('12').tagName).toBe('TD');
    expect(container.querySelector('.output-html')?.classList.contains('scroll-surface')).toBe(true);
    expect(container.querySelector('script')).toBeNull();

    rerender(<OutputRenderer output={{ output_type: 'display_data', data: { 'image/png': ' cG5n ' } }} />);
    expect(screen.getByAltText('output').getAttribute('src')).toBe('data:image/png;base64,cG5n');

    rerender(<OutputRenderer output={{ output_type: 'display_data', data: { 'image/jpeg': 'anBlZw==' } }} />);
    expect(screen.getByAltText('output').getAttribute('src')).toBe('data:image/jpeg;base64,anBlZw==');

    rerender(<OutputRenderer output={{ output_type: 'display_data', data: { 'image/svg+xml': '<svg><circle cx="4" cy="4" r="4" /></svg>' } }} />);
    expect(container.querySelector('.output-svg svg')).not.toBeNull();

    rerender(<OutputRenderer output={{ output_type: 'display_data', data: { 'text/latex': '$x^2$' } }} />);
    await waitFor(() => expect(container.querySelector('[data-testid="latex-output"]')?.textContent).toBe('x^2'));

    rerender(<OutputRenderer output={{ output_type: 'display_data', data: { 'application/json': { ok: true } } }} />);
    expect(container.querySelector('.output-json')?.textContent).toContain('"ok": true');
    expect(container.querySelector('.output-json')?.classList.contains('scroll-surface')).toBe(true);

    rerender(<OutputRenderer output={{ output_type: 'display_data', data: { 'application/vnd.plotly.v1+json': { data: [] } } }} />);
    await waitFor(() => expect(screen.getByText('plotly rendered')).not.toBeNull());

    rerender(<OutputRenderer output={{ output_type: 'display_data', data: { 'application/vnd.vega.v5+json': { mark: 'bar' } } }} />);
    await waitFor(() => expect(screen.getByText('vega rendered')).not.toBeNull());

    rerender(<OutputRenderer output={{ output_type: 'display_data', data: { 'application/pdf': 'JVBERi0xLjQ=' } }} />);
    expect(container.querySelector('object[type="application/pdf"]')?.getAttribute('data')).toBe('data:application/pdf;base64,JVBERi0xLjQ=');

    rerender(<OutputRenderer output={{ output_type: 'display_data', data: { 'text/markdown': '**ready**' } }} />);
    expect(screen.getByTestId('markdown-output').textContent).toBe('**ready**');
  });

  it('shows safe placeholders for widgets, JavaScript, and unknown MIME types', async () => {
    const { container, rerender } = render(
      <OutputRenderer
        output={{
          output_type: 'display_data',
          data: { 'application/vnd.jupyter.widget-view+json': { model_id: 'abc' } },
        }}
      />,
    );

    await waitFor(() => expect(screen.getByText(/Widget Jupyter no interactivo/)).not.toBeNull());
    expect(container.querySelector('.output-widget pre')?.classList.contains('scroll-surface')).toBe(true);

    rerender(<OutputRenderer output={{ output_type: 'display_data', data: { 'application/javascript': 'alert(1)' } }} />);
    expect(screen.getByText('application/javascript bloqueado por seguridad')).not.toBeNull();
    expect(container.querySelector('.output-blocked-code pre')?.textContent).toBe('alert(1)');
    expect(container.querySelector('.output-blocked-code pre')?.classList.contains('scroll-surface')).toBe(true);

    rerender(<OutputRenderer output={{ output_type: 'display_data', data: { 'application/x-custom': { value: 1 } } }} />);
    expect(screen.getByText(/Output no especializado/)).not.toBeNull();
    expect(container.querySelector('.output-unknown pre')?.textContent).toContain('application/x-custom');
    expect(container.querySelector('.output-unknown pre')?.classList.contains('scroll-surface')).toBe(true);
  });
});
