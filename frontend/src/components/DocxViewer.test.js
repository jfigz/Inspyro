import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { API_BASE } from '../config/endpoints';
import DocxViewer from './DocxViewer';

jest.mock('mammoth', () => ({
  convertToHtml: jest.fn(async () => ({ value: '<p>html-preview</p>' })),
}));

let mockPdfViewerState = null;
let mockPdfViewerLastProps = null;
let mockPdfViewerLastRequestedPage = null;
let mockPdfViewerLastRequestedLocation = null;
let mockPdfViewerProvenanceLinkUrl = '/api/docx/provenance/open?provenance_id=prov-1';
let mockPdfViewerProvenanceId = 'prov-1';
let mockBlobUrlCounter = 0;

const resetMockPdfViewerState = () => {
  mockPdfViewerState = {
    currentPage: 3,
    numPages: 12,
    hasOutline: true,
    outline: [
      { id: 'outline-cover', title: 'Portada', pageNumber: 1, depth: 0, destinationKey: 'dest:outline-cover', anchorTopRatio: 0.04 },
      { id: 'outline-results', title: 'Resultados', pageNumber: 5, depth: 0, destinationKey: 'dest:outline-results', anchorTopRatio: 0.08 },
      { id: 'outline-detail', title: 'Detalle', pageNumber: 7, depth: 1, destinationKey: 'dest:outline-detail', anchorTopRatio: 0.22 },
    ],
  };
  mockPdfViewerLastProps = null;
  mockPdfViewerLastRequestedPage = null;
  mockPdfViewerLastRequestedLocation = null;
  mockPdfViewerProvenanceLinkUrl = '/api/docx/provenance/open?provenance_id=prov-1';
  mockPdfViewerProvenanceId = 'prov-1';
};

jest.mock('./PdfViewer', () => {
  const React = require('react');

  return function MockPdfViewer(props) {
    mockPdfViewerLastProps = props;
    if (props.requestedPage != null) {
      mockPdfViewerLastRequestedPage = props.requestedPage;
    }
    if (props.requestedLocation != null) {
      mockPdfViewerLastRequestedLocation = props.requestedLocation;
    }

    React.useEffect(() => {
      props.onDocumentMetaChange?.({
        numPages: mockPdfViewerState.numPages,
        outline: mockPdfViewerState.outline,
        hasOutline: mockPdfViewerState.hasOutline,
      });
    }, [props.onDocumentMetaChange, props.pdfUrl]);

    React.useEffect(() => {
      if (mockPdfViewerState.currentPage != null) {
        props.onCurrentPageChange?.({
          pageNumber: mockPdfViewerState.currentPage,
          anchorTopRatio: 0.18,
          destinationKey: null,
        });
      }
    }, [props.onCurrentPageChange, props.pdfUrl]);

    return (
      <div>
        <div data-testid="mock-pdf-viewer">mock-pdf</div>
        <div data-testid="mock-pdf-fit-mode">{props.fitMode || 'unset'}</div>
        <div data-testid="mock-pdf-zoom">{String(props.zoomPercent ?? 'unset')}</div>
        <button
          type="button"
          data-testid="mock-pdf-provenance-link"
          onClick={() => props.onLinkActivate?.({
            url: mockPdfViewerProvenanceLinkUrl,
            provenanceId: mockPdfViewerProvenanceId,
          })}
        >
          provenance-link
        </button>
        <button
          type="button"
          data-testid="mock-pdf-summary"
          onClick={() => props.onProvenanceSummaryChange?.({ totalLinkCount: 1, provenanceCount: 1 })}
        >
          summary
        </button>
        <button
          type="button"
          data-testid="mock-pdf-no-provenance"
          onClick={() => props.onProvenanceSummaryChange?.({ totalLinkCount: 0, provenanceCount: 0 })}
        >
          no-provenance
        </button>
        <button
          type="button"
          data-testid="mock-pdf-current-page-7"
          onClick={() => props.onCurrentPageChange?.({ pageNumber: 7, anchorTopRatio: 0.2, destinationKey: 'page:7' })}
        >
          page-7
        </button>
        <button
          type="button"
          data-testid="mock-pdf-current-outline-anchor-middle"
          onClick={() => props.onCurrentPageChange?.({ pageNumber: 5, anchorTopRatio: 0.42, destinationKey: 'dest:outline-section-b' })}
        >
          outline-middle
        </button>
        <button
          type="button"
          data-testid="mock-pdf-apply-requested-location"
          onClick={() => {
            const requestedPage = props.requestedLocation?.pageNumber ?? props.requestedPage;
            if (requestedPage != null) {
              props.onCurrentPageChange?.({
                pageNumber: requestedPage,
                anchorTopRatio: props.requestedLocation?.anchorTopRatio ?? 0,
                destinationKey: props.requestedLocation?.destinationKey || `page:${requestedPage}`,
              });
            }
          }}
        >
          apply-requested-location
        </button>
        <button
          type="button"
          data-testid="mock-pdf-meta-no-outline"
          onClick={() => props.onDocumentMetaChange?.({
            numPages: mockPdfViewerState.numPages,
            outline: [],
            hasOutline: false,
          })}
        >
          meta-no-outline
        </button>
      </div>
    );
  };
});

const DOCX_NO_STORE_FETCH = { cache: 'no-store' };
const mammoth = require('mammoth');
const flushPromises = async () => {
  await act(async () => {
    await Promise.resolve();
  });
  act(() => {
    jest.runOnlyPendingTimers();
  });
  await act(async () => {
    await Promise.resolve();
  });
};

const buildProps = (overrides = {}) => ({
  docxBase64: null,
  docxHash: null,
  docxDownloadUrl: null,
  docxFileToken: null,
  docxArtifactId: null,
  docxFileName: null,
  docxWarnings: null,
  docxError: null,
  docxSizeBytes: null,
  docxStoreError: null,
  docxProvenanceAvailable: false,
  docxProvenanceRef: null,
  docxUpdatedAt: null,
  docxHistory: [],
  docxWorkspacePath: null,
  docxWorkspaceRelpath: null,
  docxWorkspaceWarning: null,
  sourcePath: null,
  sourceKind: null,
  pdfBase64: null,
  pdfRefUrl: null,
  pdfHash: null,
  pdfConversionError: null,
  pdfAttempted: null,
  pdfConversionStdout: null,
  pdfConversionStderr: null,
  pdfConversionMs: null,
  conversionStatus: null,
  converterUsed: null,
  wordError: null,
  onClearDocx: jest.fn(),
  onRetryPdf: jest.fn(),
  onStatusMessage: jest.fn(),
  kernelId: null,
  sendMessage: null,
  lastMessage: null,
  templateInfo: null,
  qualityOpenRequest: null,
  onTemplateChange: jest.fn(),
  onTemplateUpload: jest.fn(),
  onRequestKernelStart: jest.fn(),
  onNavigateToCode: jest.fn(),
  isVisible: true,
  ...overrides,
});

describe('DocxViewer', () => {
  let originalInnerWidth;

  beforeAll(() => {
    originalInnerWidth = window.innerWidth;
  });

  beforeEach(() => {
    resetMockPdfViewerState();
    mockBlobUrlCounter = 0;
    mammoth.convertToHtml.mockClear();
    delete window.inspyroDesktop;
    Object.defineProperty(window, 'innerWidth', {
      configurable: true,
      writable: true,
      value: 1024,
    });
    jest.useFakeTimers();
    if (!global.URL.createObjectURL) {
      global.URL.createObjectURL = jest.fn(() => `blob:test-docx-${++mockBlobUrlCounter}`);
    } else {
      jest.spyOn(global.URL, 'createObjectURL').mockImplementation(() => `blob:test-docx-${++mockBlobUrlCounter}`);
    }
    if (!global.URL.revokeObjectURL) {
      global.URL.revokeObjectURL = jest.fn();
    } else {
      jest.spyOn(global.URL, 'revokeObjectURL').mockImplementation(() => {});
    }
    if (!HTMLAnchorElement.prototype.click) {
      HTMLAnchorElement.prototype.click = jest.fn();
    } else {
      jest.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    }
    if (!window.open) {
      window.open = jest.fn();
    } else {
      jest.spyOn(window, 'open').mockImplementation(() => null);
    }
  });

  afterEach(() => {
    jest.clearAllTimers();
    jest.useRealTimers();
    jest.restoreAllMocks();
    delete window.inspyroDesktop;
  });

  afterAll(() => {
    Object.defineProperty(window, 'innerWidth', {
      configurable: true,
      writable: true,
      value: originalInnerWidth,
    });
  });

  it('does not show PDF loading UI when only DOCX history is available', () => {
    render(
      <DocxViewer
        {...buildProps({
          docxHistory: [
            {
              id: 'artifact:docx-1',
              createdAt: Date.now(),
              downloadUrl: '/api/docx/download?artifact_id=docx-1',
              docxFileName: 'report.docx',
              sourcePath: 'C:\\workspace\\demo.ipynb',
              sourceKind: 'notebook',
            },
          ],
        })}
      />
    );

    expect(screen.queryByText(/Generando PDF/i)).toBeNull();

    act(() => {
      jest.advanceTimersByTime(6000);
    });

    expect(screen.queryByText(/PDF tardando/i)).toBeNull();
    expect(screen.getByText(/Sin vista previa activa/i)).toBeTruthy();
    expect(screen.getByText(/versiones DOCX descargables/i)).toBeTruthy();
  });

  it('shows PDF loading UI when conversion is explicitly in progress', () => {
    render(
      <DocxViewer
        {...buildProps({
          docxDownloadUrl: '/api/docx/download?artifact_id=docx-1',
          conversionStatus: { message: 'Convirtiendo a PDF...' },
        })}
      />
    );

    expect(screen.getAllByText(/Convirtiendo a PDF/i).length).toBeGreaterThan(0);
  });

  it('derives shared PDF converter copy from structured document pipeline metadata', () => {
    render(
      <DocxViewer
        {...buildProps({
          docxDownloadUrl: '/api/docx/download?artifact_id=docx-1',
          conversionStatus: null,
          documentPipelineStatus: {
            stage: 'pdf_convert',
            status: 'running',
            sharedResource: {
              kind: 'pdf_converter',
              scope: 'global',
              status: 'waiting',
            },
          },
        })}
      />
    );

    expect(screen.getAllByText(/Esperando convertidor PDF compartido/i).length).toBeGreaterThan(0);
  });

  it('does not show PDF loading UI for completed document pipeline metadata', () => {
    render(
      <DocxViewer
        {...buildProps({
          docxDownloadUrl: '/api/docx/download?artifact_id=docx-1',
          conversionStatus: null,
          documentPipelineStatus: {
            stage: 'pdf_convert',
            status: 'completed',
            message: 'PDF listo en Documento.',
          },
        })}
      />
    );

    expect(screen.queryByText(/PDF listo en Documento/i)).toBeNull();
    expect(screen.queryByText(/Generando PDF/i)).toBeNull();
  });

  it('keeps a clean viewer state when the remote history endpoint returns 404', async () => {
    const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    global.fetch = jest.fn((url) => {
      if (String(url).includes('/api/docx/history')) {
        return Promise.resolve({
          ok: false,
          status: 404,
        });
      }
      return Promise.resolve({
        ok: true,
        json: async () => ({ items: [] }),
      });
    });

    render(
      <DocxViewer
        {...buildProps({
          sourcePath: 'C:\\workspace\\demo.ipynb',
          sourceKind: 'notebook',
          kernelId: 'kernel-live',
          docxHistory: [
            {
              id: 'artifact:docx-local',
              createdAt: Date.now(),
              downloadUrl: '/api/docx/download?artifact_id=docx-local',
              docxFileName: 'local.docx',
              sourcePath: 'C:\\workspace\\demo.ipynb',
              sourceKind: 'notebook',
            },
          ],
        })}
      />
    );

    await flushPromises();
    expect(screen.getByRole('button', { name: 'DOCX' })).toBeTruthy();
    expect(consoleErrorSpy).not.toHaveBeenCalled();
  });

  it('keeps the previous PDF visible while a newer DOCX generation is still loading', async () => {
    const { rerender } = render(
      <DocxViewer
        {...buildProps({
          docxDownloadUrl: '/api/docx/download?artifact_id=docx-1',
          pdfBase64: 'cGRm',
        })}
      />
    );

    expect(screen.getByTestId('mock-pdf-viewer')).toBeTruthy();
    const initialPdfUrl = mockPdfViewerLastProps.pdfUrl;

    rerender(
      <DocxViewer
        {...buildProps({
          docxDownloadUrl: '/api/docx/download?artifact_id=docx-2',
          documentPipelineStatus: { message: 'DOCX listo.' },
        })}
      />
    );

    await act(async () => Promise.resolve());

    expect(screen.getByTestId('mock-pdf-viewer')).toBeTruthy();
    expect(mockPdfViewerLastProps.pdfUrl).toBe(initialPdfUrl);
    expect(screen.getAllByText(/DOCX listo/i).length).toBeGreaterThan(0);
  });

  it('treats a missing temporary pdf_ref as not-ready state and still offers retry in notebook mode', async () => {
    const onRetryPdf = jest.fn();
    const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 404,
    });

    render(
      <DocxViewer
        {...buildProps({
          docxDownloadUrl: '/api/docx/download?artifact_id=docx-1',
          pdfRefUrl: '/api/pdf/download?token=missing-pdf',
          pdfAttempted: true,
          kernelId: 'kernel-live',
          sendMessage: jest.fn(),
          onRetryPdf,
        })}
      />
    );

    await act(async () => Promise.resolve());
    await act(async () => Promise.resolve());

    expect(screen.queryByTestId('mock-pdf-viewer')).toBeNull();
    expect(screen.getAllByText(/todavia no esta disponible/i).length).toBeGreaterThan(0);
    expect(screen.getByRole('button', { name: 'Reintentar PDF' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Reintentar conversion' })).toBeNull();
    expect(consoleErrorSpy).not.toHaveBeenCalled();
  });

  it('hides the retry CTA without a kernel while keeping PDF diagnostics visible', async () => {
    const onRetryPdf = jest.fn();
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 404,
    });

    render(
      <DocxViewer
        {...buildProps({
          docxDownloadUrl: '/api/docx/download?artifact_id=docx-1',
          pdfRefUrl: '/api/pdf/download?token=missing-pdf',
          pdfAttempted: true,
          pdfConversionError: 'HTTP 404',
          onRetryPdf,
        })}
      />
    );

    await act(async () => Promise.resolve());
    await act(async () => Promise.resolve());

    expect(screen.queryByRole('button', { name: 'Reintentar PDF' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Reintentar conversion' })).toBeNull();
    expect(screen.getByText(/Diagnostico PDF/i)).toBeTruthy();
    expect(screen.getByText(/HTTP 404/i)).toBeTruthy();
  });

  it('keeps the template button visible when history exists before kernel startup', () => {
    const onRequestKernelStart = jest.fn();

    render(
      <DocxViewer
        {...buildProps({
          docxHistory: [
            {
              id: 'artifact:docx-1',
              createdAt: Date.now(),
              downloadUrl: '/api/docx/download?artifact_id=docx-1',
              docxFileName: 'report.docx',
              sourcePath: 'C:\\workspace\\demo.ipynb',
              sourceKind: 'notebook',
            },
          ],
          sendMessage: jest.fn(),
          onRequestKernelStart,
        })}
      />
    );

    const button = screen.getByTestId('docx-template-button-empty');
    expect(button).toBeTruthy();
    expect(button.disabled).toBe(false);

    fireEvent.click(button);

    expect(onRequestKernelStart).toHaveBeenCalledTimes(1);
  });

  it('renders the PDF reader toolbar and keeps page state in sync with PdfViewer', async () => {
    render(
      <DocxViewer
        {...buildProps({
          pdfBase64: 'cGRm',
        })}
      />
    );

    await flushPromises();

    expect(screen.getByTestId('docx-page-indicator').textContent).toBe('3 / 12');
    expect(screen.getByTestId('mock-pdf-fit-mode').textContent).toBe('width');
    expect(screen.getByTestId('mock-pdf-zoom').textContent).toBe('100');
    expect(screen.getByTestId('docx-zoom-label').textContent).toBe('Ajuste ancho');

    fireEvent.click(screen.getByRole('button', { name: 'Aumentar zoom' }));

    expect(screen.getByTestId('mock-pdf-fit-mode').textContent).toBe('custom');
    expect(screen.getByTestId('mock-pdf-zoom').textContent).toBe('110');
    expect(screen.getByTestId('docx-zoom-label').textContent).toBe('110%');

    fireEvent.click(screen.getByRole('button', { name: 'Restablecer zoom a 100%' }));

    expect(screen.getByTestId('mock-pdf-fit-mode').textContent).toBe('custom');
    expect(screen.getByTestId('mock-pdf-zoom').textContent).toBe('100');

    fireEvent.click(screen.getByRole('button', { name: 'Ajustar al ancho' }));

    expect(screen.getByTestId('mock-pdf-fit-mode').textContent).toBe('width');

    fireEvent.click(screen.getByTestId('mock-pdf-current-page-7'));

    expect(screen.getByTestId('docx-page-indicator').textContent).toBe('7 / 12');
    expect(screen.getByLabelText(/Ir a pagina/i).value).toBe('7');
  });

  it('loads mammoth only when HTML view is requested', async () => {
    mammoth.convertToHtml.mockResolvedValue({ value: '<p>html-preview</p>' });
    const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

    render(
      <DocxViewer
        {...buildProps({
          docxBase64: 'ZG9jeA==',
          pdfBase64: 'cGRm',
        })}
      />
    );

    await flushPromises();

    expect(mammoth.convertToHtml).not.toHaveBeenCalled();

    fireEvent.click(screen.getByLabelText(/Mas opciones del documento/i));
    fireEvent.click(screen.getByText(/Ver HTML/i));

    await flushPromises();

    expect(mammoth.convertToHtml).toHaveBeenCalledTimes(1);
    expect(screen.getByText(/Vista HTML/i)).toBeTruthy();
    expect(consoleErrorSpy).not.toHaveBeenCalled();
  });

  it('navigates using the page input and outline rail from the PDF toolbar', async () => {
    render(
      <DocxViewer
        {...buildProps({
          pdfBase64: 'cGRm',
        })}
      />
    );

    await flushPromises();

    const pageInput = screen.getByLabelText(/Ir a pagina/i);
    fireEvent.change(pageInput, { target: { value: '6' } });
    fireEvent.blur(pageInput);

    expect(mockPdfViewerLastRequestedPage).toBe(6);
    fireEvent.click(screen.getByTestId('mock-pdf-apply-requested-location'));
    expect(screen.getByTestId('docx-page-indicator').textContent).toBe('6 / 12');

    fireEvent.click(screen.getByTestId('docx-outline-toggle'));
    expect(screen.getByTestId('docx-outline-rail')).toBeTruthy();
    fireEvent.click(screen.getByTestId('docx-outline-item-2'));

    expect(mockPdfViewerLastRequestedPage).toBe(7);
    expect(mockPdfViewerLastRequestedLocation).toEqual(expect.objectContaining({
      pageNumber: 7,
      destinationKey: 'dest:outline-detail',
      anchorTopRatio: 0.22,
    }));
    fireEvent.click(screen.getByTestId('mock-pdf-apply-requested-location'));
    expect(screen.getByTestId('docx-page-indicator').textContent).toBe('7 / 12');
    expect(screen.getByTestId('docx-outline-rail')).toBeTruthy();
    expect(screen.getByTestId('docx-outline-item-2').getAttribute('data-active')).toBe('true');
  });

  it('keeps the outline rail docked and highlights the active section on wide viewers', async () => {
    Object.defineProperty(window, 'innerWidth', {
      configurable: true,
      writable: true,
      value: 1400,
    });

    render(
      <DocxViewer
        {...buildProps({
          pdfBase64: 'cGRm',
        })}
      />
    );

    await flushPromises();

    fireEvent.click(screen.getByTestId('docx-outline-toggle'));

    const rail = screen.getByTestId('docx-outline-rail');
    expect(rail.className).toContain('is-docked');

    fireEvent.click(screen.getByTestId('docx-outline-item-2'));
    fireEvent.click(screen.getByTestId('mock-pdf-apply-requested-location'));

    expect(screen.getByTestId('docx-outline-rail')).toBeTruthy();
    expect(screen.getByTestId('docx-outline-item-2').getAttribute('data-active')).toBe('true');
  });

  it('tracks the active outline item by exact bookmark location when multiple sections share a page', async () => {
    mockPdfViewerState = {
      currentPage: 5,
      numPages: 12,
      hasOutline: true,
      outline: [
        { id: 'outline-section-a', title: 'Seccion A', pageNumber: 5, depth: 0, destinationKey: 'dest:outline-section-a', anchorTopRatio: 0.08 },
        { id: 'outline-section-b', title: 'Seccion B', pageNumber: 5, depth: 0, destinationKey: 'dest:outline-section-b', anchorTopRatio: 0.36 },
        { id: 'outline-section-c', title: 'Seccion C', pageNumber: 5, depth: 1, destinationKey: 'dest:outline-section-c', anchorTopRatio: 0.74 },
      ],
    };

    Object.defineProperty(window, 'innerWidth', {
      configurable: true,
      writable: true,
      value: 1400,
    });

    render(
      <DocxViewer
        {...buildProps({
          pdfBase64: 'cGRm',
        })}
      />
    );

    await flushPromises();

    fireEvent.click(screen.getByTestId('docx-outline-toggle'));
    fireEvent.click(screen.getByTestId('mock-pdf-current-outline-anchor-middle'));

    expect(screen.getByTestId('docx-outline-item-1').getAttribute('data-active')).toBe('true');
    expect(screen.getByTestId('docx-outline-item-2').getAttribute('data-active')).toBe('false');

    fireEvent.click(screen.getByTestId('docx-outline-item-1'));

    expect(mockPdfViewerLastRequestedLocation).toEqual(expect.objectContaining({
      pageNumber: 5,
      destinationKey: 'dest:outline-section-b',
      anchorTopRatio: 0.36,
    }));
    fireEvent.click(screen.getByTestId('mock-pdf-apply-requested-location'));
    expect(screen.getByTestId('docx-page-indicator').textContent).toBe('5 / 12');
    expect(screen.getByTestId('docx-outline-item-1').getAttribute('data-active')).toBe('true');
  });

  it('closes the outline rail when the new pdf metadata has no outline', async () => {
    render(
      <DocxViewer
        {...buildProps({
          pdfBase64: 'cGRm',
        })}
      />
    );

    await flushPromises();

    fireEvent.click(screen.getByTestId('docx-outline-toggle'));
    expect(screen.getByTestId('docx-outline-rail')).toBeTruthy();

    fireEvent.click(screen.getByTestId('mock-pdf-meta-no-outline'));

    await flushPromises();

    expect(screen.queryByTestId('docx-outline-rail')).toBeNull();
    expect(screen.getByTestId('docx-outline-toggle').disabled).toBe(true);
  });

  it('keeps PdfViewer callback identities stable across metadata updates', async () => {
    render(
      <DocxViewer
        {...buildProps({
          pdfBase64: 'cGRm',
        })}
      />
    );

    await flushPromises();
    const initialOnCurrentPageChange = mockPdfViewerLastProps.onCurrentPageChange;

    mockPdfViewerState = {
      currentPage: 2,
      numPages: 8,
      hasOutline: false,
      outline: [],
    };

    fireEvent.click(screen.getByTestId('mock-pdf-meta-no-outline'));

    await flushPromises();

    expect(mockPdfViewerLastProps.onCurrentPageChange).toBe(initialOnCurrentPageChange);
    expect(screen.getByTestId('mock-pdf-viewer')).toBeTruthy();
  });

  it('preserves the current page when Documento is hidden and shown again', async () => {
    const { rerender } = render(
      <DocxViewer
        {...buildProps({
          pdfBase64: 'cGRm',
        })}
      />
    );

    await flushPromises();
    await flushPromises();

    fireEvent.click(screen.getByTestId('mock-pdf-current-page-7'));
    expect(screen.getByTestId('docx-page-indicator').textContent).toBe('7 / 12');

    rerender(
      <DocxViewer
        {...buildProps({
          pdfBase64: 'cGRm',
          isVisible: false,
        })}
      />
    );

    await flushPromises();

    expect(screen.queryByTestId('mock-pdf-viewer')).toBeNull();
    expect(screen.getByText(/Vista PDF pausada/i)).toBeTruthy();
    expect(screen.getByTestId('docx-page-indicator').textContent).toBe('7 / 12');

    rerender(
      <DocxViewer
        {...buildProps({
          pdfBase64: 'cGRm',
          isVisible: true,
        })}
      />
    );

    await flushPromises();
    await flushPromises();

    expect(screen.getByTestId('mock-pdf-viewer')).toBeTruthy();
    expect(mockPdfViewerLastRequestedPage).toBe(7);
    fireEvent.click(screen.getByTestId('mock-pdf-apply-requested-location'));
    expect(screen.getByTestId('docx-page-indicator').textContent).toBe('7 / 12');
  });

  it('clears stale PDF state when switching to a different notebook source without document artifacts', async () => {
    const firstSourcePath = 'C:\\workspace\\first.ipynb';
    const secondSourcePath = 'C:\\workspace\\second.ipynb';
    global.fetch = jest.fn((url) => {
      if (String(url).includes('/api/docx/history')) {
        return Promise.resolve({
          ok: true,
          json: async () => ({ items: [] }),
        });
      }
      if (String(url).includes('/api/pdf/download')) {
        return Promise.resolve({
          ok: true,
          blob: async () => new Blob(['pdf'], { type: 'application/pdf' }),
        });
      }
      return Promise.resolve({
        ok: true,
        json: async () => ({}),
      });
    });

    const { rerender } = render(
      <DocxViewer
        {...buildProps({
          sourcePath: firstSourcePath,
          sourceKind: 'notebook',
          docxDownloadUrl: '/api/docx/download?artifact_id=docx-first',
          pdfRefUrl: '/api/pdf/download?token=pdf-first',
        })}
      />
    );

    await flushPromises();
    await flushPromises();
    expect(screen.getByTestId('mock-pdf-viewer')).toBeTruthy();

    rerender(
      <DocxViewer
        {...buildProps({
          sourcePath: secondSourcePath,
          sourceKind: 'notebook',
        })}
      />
    );

    await flushPromises();

    expect(screen.queryByTestId('mock-pdf-viewer')).toBeNull();
    expect(screen.getByText(/Sin vista previa activa/i)).toBeTruthy();
    expect(screen.getByText(/ultima version DOCX estable/i)).toBeTruthy();
  });

  it('keeps the latest hidden notebook PDF ready for when Documento becomes visible again', async () => {
    const fetchMock = jest.fn((url) => {
      if (String(url).includes('/api/docx/history')) {
        return Promise.resolve({
          ok: true,
          json: async () => ({ items: [] }),
        });
      }
      if (String(url).includes('/api/pdf/download')) {
        return Promise.resolve({
          ok: true,
          blob: async () => new Blob([String(url)], { type: 'application/pdf' }),
        });
      }
      if (String(url).includes('/api/docx/download?artifact_id=docx-new')) {
        return Promise.resolve({
          ok: true,
          blob: async () => new Blob(['docx-new'], {
            type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
          }),
        });
      }
      return Promise.resolve({
        ok: true,
        json: async () => ({}),
      });
    });
    global.fetch = fetchMock;
    const sourcePath = 'C:\\workspace\\report.ipynb';
    const { rerender } = render(
      <DocxViewer
        {...buildProps({
          sourcePath,
          sourceKind: 'notebook',
          docxDownloadUrl: '/api/docx/download?artifact_id=docx-old',
          pdfRefUrl: '/api/pdf/download?token=pdf-old',
        })}
      />
    );

    await flushPromises();
    await flushPromises();
    const initialPdfUrl = mockPdfViewerLastProps.pdfUrl;

    rerender(
      <DocxViewer
        {...buildProps({
          sourcePath,
          sourceKind: 'notebook',
          docxDownloadUrl: '/api/docx/download?artifact_id=docx-new',
          docxUpdatedAt: 200,
          pdfRefUrl: '/api/pdf/download?token=pdf-new',
          isVisible: false,
        })}
      />
    );

    await flushPromises();
    expect(screen.queryByTestId('mock-pdf-viewer')).toBeNull();
    expect(screen.getByText(/Vista PDF pausada/i)).toBeTruthy();

    rerender(
      <DocxViewer
        {...buildProps({
          sourcePath,
          sourceKind: 'notebook',
          docxDownloadUrl: '/api/docx/download?artifact_id=docx-new',
          docxUpdatedAt: 200,
          pdfRefUrl: '/api/pdf/download?token=pdf-new',
          isVisible: true,
        })}
      />
    );

    await flushPromises();
    await flushPromises();

    expect(screen.getByTestId('mock-pdf-viewer')).toBeTruthy();
    expect(mockPdfViewerLastProps.pdfUrl).not.toBe(initialPdfUrl);

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'DOCX' }));
    });

    expect(fetchMock).toHaveBeenCalledWith(
      `${API_BASE}/api/docx/download?artifact_id=docx-new`,
      DOCX_NO_STORE_FETCH,
    );
  });

  it('moves secondary document actions into menus and removes the explicit go button', async () => {
    render(
      <DocxViewer
        {...buildProps({
          pdfBase64: 'cGRm',
          sendMessage: jest.fn(),
          docxHistory: [
            {
              id: 'artifact:docx-1',
              createdAt: Date.now(),
              downloadUrl: '/api/docx/download?artifact_id=docx-1',
              docxFileName: 'report.docx',
              sourcePath: 'C:\\workspace\\demo.ipynb',
              sourceKind: 'notebook',
            },
          ],
        })}
      />
    );

    await flushPromises();

    expect(screen.queryByRole('button', { name: 'Ir' })).toBeNull();
    expect(screen.getByRole('button', { name: 'DOCX' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'PDF' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Plantilla' })).toBeTruthy();

    fireEvent.click(screen.getByTestId('docx-more-menu'));
    expect(screen.getByText(/Ver PDF/i)).toBeTruthy();
    expect(screen.getByText(/Ver HTML/i)).toBeTruthy();
    expect(screen.getByText(/Limpiar documento/i)).toBeTruthy();

    fireEvent.click(screen.getByTestId('docx-history-menu'));
    expect(screen.getByText(/report\.docx/i)).toBeTruthy();
  });

  it('opens the DOCX quality rail, runs audit actions and shows history badges', async () => {
    const qualitySummary = {
      status: 'warning',
      score: 84,
      counts: { error: 0, warning: 2, info: 1 },
      pages_rendered: null,
      content_controls: {
        control_count: 1,
        placeholder_count: 2,
        unwrapped_placeholder_count: 1,
      },
      sections: [
        {
          id: 'accessibility',
          status: 'warning',
          findings: [{ severity: 'warning', message: 'Imagen sin texto alternativo', count: 1 }],
        },
        {
          id: 'fields',
          status: 'ok',
          findings: [],
        },
      ],
    };
    const fetchMock = jest.fn((url, options = {}) => {
      const rawUrl = String(url);
      if (rawUrl.includes('/api/docx/workbench/run')) {
        const body = options?.body ? JSON.parse(options.body) : {};
        if (body.operation === 'render_page' || body.operation === 'render_all_pages' || body.operation === 'render_manifest') {
          return Promise.resolve({
            ok: true,
            json: async () => ({
              operation: body.operation,
              artifact_id: 'artifact-quality',
              visual: {
                status: body.operation === 'render_all_pages' ? 'complete' : 'partial',
                page_count: 3,
                cached_pages: body.operation === 'render_all_pages' ? 3 : 1,
                converter_used: 'word',
                page_resources: [
                  {
                    name: 'page-0003-z2_00.png',
                    mime_type: 'image/png',
                    resource_uri: '/api/docx/render/resource?render_id=render-1&name=page-0003-z2_00.png',
                  },
                ],
              },
              resources: [
                {
                  name: 'page-0003-z2_00.png',
                  mime_type: 'image/png',
                  resource_uri: '/api/docx/render/resource?render_id=render-1&name=page-0003-z2_00.png',
                },
              ],
              render: {
                page: 3,
                page_count: 3,
                resource_uri: '/api/docx/render/resource?render_id=render-1&name=page-0003-z2_00.png',
              },
            }),
          });
        }
        return Promise.resolve({
          ok: true,
          json: async () => ({
            operation: 'prepare_delivery',
            artifact_id: 'artifact-quality',
            summary: qualitySummary,
            resources: [
              {
                name: 'quality-clean.docx',
                resource_uri: '/api/docx/workbench/resource?artifact_id=artifact-quality&workbench_id=wb-1&resource=variant.docx',
              },
            ],
            variant: { file_name: 'quality-clean.docx' },
          }),
        });
      }
      if (rawUrl.includes('/api/docx/workbench/resource')) {
        return Promise.resolve({
          ok: true,
          blob: async () => new Blob(['docx'], {
            type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
          }),
        });
      }
      if (rawUrl.includes('/api/docx/render/resource')) {
        return Promise.resolve({
          ok: true,
          blob: async () => new Blob(['png'], { type: 'image/png' }),
        });
      }
      if (rawUrl.includes('/api/docx/quality/run')) {
        return Promise.resolve({ ok: true, json: async () => qualitySummary });
      }
      if (rawUrl.includes('/api/docx/quality/render')) {
        return Promise.resolve({ ok: true, blob: async () => new Blob(['png'], { type: 'image/png' }) });
      }
      if (rawUrl.includes('/api/docx/quality/clean')) {
        return Promise.resolve({
          ok: true,
          blob: async () => new Blob(['docx'], {
            type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
          }),
        });
      }
      if (rawUrl.includes('/api/docx/quality')) {
        return Promise.resolve({ ok: false, status: 404 });
      }
      if (rawUrl.includes('/api/docx/history')) {
        return Promise.resolve({ ok: true, json: async () => ({ items: [] }) });
      }
      if (rawUrl.includes('/api/docx/provenance?')) {
        return Promise.resolve({ ok: false, status: 404 });
      }
      throw new Error(`Unexpected fetch in quality test: ${rawUrl} ${options.method || 'GET'}`);
    });
    global.fetch = fetchMock;
    const onStatusMessage = jest.fn();

    render(
      <DocxViewer
        {...buildProps({
          pdfBase64: 'cGRm',
          docxArtifactId: 'artifact-quality',
          docxFileName: 'quality.docx',
          docxQualityStatus: 'warning',
          docxQualityScore: 88,
          docxQualityCounts: { warning: 2, error: 0, info: 0 },
          docxHistory: [
            {
              id: 'artifact:artifact-quality',
              createdAt: Date.now(),
              downloadUrl: '/api/docx/download?artifact_id=artifact-quality',
              docxArtifactId: 'artifact-quality',
              docxFileName: 'quality.docx',
              docxQualityStatus: 'warning',
              docxQualityCounts: { warning: 2, error: 0, info: 0 },
            },
          ],
          onStatusMessage,
        })}
      />
    );

    await flushPromises();

    fireEvent.click(screen.getByTestId('docx-history-menu'));
    expect(screen.getAllByText(/Calidad 2 avisos/i).length).toBeGreaterThan(0);

    fireEvent.click(screen.getByTestId('docx-quality-toggle'));
    expect(screen.getByTestId('docx-quality-rail')).toBeTruthy();
    expect(screen.getByText(/2 warnings/i)).toBeTruthy();

    fireEvent.click(screen.getByTestId('docx-quality-run'));
    await waitFor(() => expect(screen.getByText(/Imagen sin texto alternativo/i)).toBeTruthy());
    expect(fetchMock).toHaveBeenCalledWith(
      `${API_BASE}/api/docx/quality/run`,
      expect.objectContaining({ method: 'POST' }),
    );

    fireEvent.click(screen.getByRole('tab', { name: 'Visual' }));
    expect(screen.getByTestId('docx-render-summary')).toBeTruthy();
    fireEvent.click(screen.getByTestId('docx-render-manifest'));
    await waitFor(() => expect(screen.getAllByText(/PDF listo|Visual listo|1\/3 paginas/i).length).toBeGreaterThan(0));
    fireEvent.click(screen.getByTestId('docx-quality-render'));
    await waitFor(() => expect(screen.getByTestId('docx-quality-preview')).toBeTruthy());
    expect(fetchMock).toHaveBeenCalledWith(
      `${API_BASE}/api/docx/workbench/run`,
      expect.objectContaining({ method: 'POST' }),
    );
    fireEvent.click(screen.getByTestId('docx-render-all'));
    await waitFor(() => expect(screen.getByText(/3\/3 paginas/i)).toBeTruthy());

    fireEvent.click(screen.getByRole('tab', { name: 'Publicacion' }));
    fireEvent.click(screen.getByTestId('docx-quality-clean'));
    await waitFor(() => expect(HTMLAnchorElement.prototype.click).toHaveBeenCalled());
    expect(fetchMock).toHaveBeenCalledWith(
      `${API_BASE}/api/docx/workbench/run`,
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('opens the DOCX quality rail from a download-only document state', async () => {
    const fetchMock = jest.fn((url) => {
      const rawUrl = String(url);
      if (rawUrl.includes('/api/docx/history')) {
        return Promise.resolve({ ok: true, json: async () => ({ items: [] }) });
      }
      if (rawUrl.includes('/api/docx/quality')) {
        return Promise.resolve({ ok: false, status: 404 });
      }
      if (rawUrl.includes('/api/docx/provenance?')) {
        return Promise.resolve({ ok: false, status: 404 });
      }
      throw new Error(`Unexpected fetch in empty quality test: ${rawUrl}`);
    });
    global.fetch = fetchMock;

    render(
      <DocxViewer
        {...buildProps({
          docxArtifactId: 'artifact-empty',
          docxDownloadUrl: '/api/docx/download?artifact_id=artifact-empty',
          docxFileName: 'empty.docx',
          docxHistory: [
            {
              id: 'artifact:artifact-empty',
              createdAt: Date.now(),
              downloadUrl: '/api/docx/download?artifact_id=artifact-empty',
              docxArtifactId: 'artifact-empty',
              docxFileName: 'empty.docx',
            },
          ],
        })}
      />
    );

    await flushPromises();

    expect(screen.getByTestId('docx-empty-state')).toBeTruthy();
    fireEvent.click(screen.getByTestId('docx-quality-toggle-empty'));
    expect(screen.getByTestId('docx-quality-rail')).toBeTruthy();
    expect(screen.getByText(/Workbench DOCX/i)).toBeTruthy();
  });

  it('does not report render success when Workbench render fails', async () => {
    const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    const fetchMock = jest.fn((url) => {
      const rawUrl = String(url);
      if (rawUrl.includes('/api/docx/workbench/run')) {
        return Promise.resolve({ ok: false, status: 500 });
      }
      if (rawUrl.includes('/api/docx/history')) {
        return Promise.resolve({ ok: true, json: async () => ({ items: [] }) });
      }
      if (rawUrl.includes('/api/docx/quality')) {
        return Promise.resolve({ ok: false, status: 404 });
      }
      if (rawUrl.includes('/api/docx/provenance?')) {
        return Promise.resolve({ ok: false, status: 404 });
      }
      throw new Error(`Unexpected fetch in failed render test: ${rawUrl}`);
    });
    global.fetch = fetchMock;
    const onStatusMessage = jest.fn();

    render(
      <DocxViewer
        {...buildProps({
          pdfBase64: 'cGRm',
          docxArtifactId: 'artifact-quality',
          docxFileName: 'quality.docx',
          onStatusMessage,
        })}
      />
    );

    await flushPromises();

    fireEvent.click(screen.getByTestId('docx-quality-toggle'));
    fireEvent.click(screen.getByRole('tab', { name: 'Visual' }));
    fireEvent.click(screen.getByTestId('docx-quality-render'));

    await waitFor(() => expect(onStatusMessage).toHaveBeenCalledWith(
      expect.stringMatching(/No se pudo ejecutar Workbench DOCX/i),
      'error',
    ));
    expect(onStatusMessage).not.toHaveBeenCalledWith(
      expect.stringMatching(/^Pagina .* renderizada/i),
      'success',
    );
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      '[DocxViewer]',
      'Error ejecutando Workbench DOCX:',
      expect.any(Error),
    );
  });

  it('downloads the newest DOCX from history before a stale current download URL', async () => {
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      blob: async () => new Blob(['docx'], {
        type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      }),
    });
    global.fetch = fetchMock;

    render(
      <DocxViewer
        {...buildProps({
          docxDownloadUrl: '/api/docx/download?artifact_id=old-docx',
          docxFileName: 'old.docx',
          docxHistory: [
            {
              id: 'artifact:new-docx',
              createdAt: Date.now(),
              downloadUrl: '/api/docx/download?artifact_id=new-docx',
              docxFileName: 'new.docx',
              sourcePath: 'C:\\workspace\\demo.ipynb',
              sourceKind: 'notebook',
            },
          ],
        })}
      />
    );

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'DOCX' }));
    });

    expect(fetchMock).toHaveBeenCalledWith(
      `${API_BASE}/api/docx/download?artifact_id=new-docx`,
      DOCX_NO_STORE_FETCH,
    );
  });

  it('downloads the current live DOCX when it is fresher than stale history', async () => {
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      blob: async () => new Blob(['docx'], {
        type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      }),
    });
    global.fetch = fetchMock;

    render(
      <DocxViewer
        {...buildProps({
          docxDownloadUrl: '/api/docx/download?artifact_id=stale-current-url',
          docxArtifactId: 'current-live',
          docxUpdatedAt: 500,
          docxFileName: 'current.docx',
          docxHistory: [
            {
              id: 'artifact:old-history',
              createdAt: 100,
              downloadUrl: '/api/docx/download?artifact_id=old-history',
              docxFileName: 'old.docx',
              sourcePath: 'C:\\workspace\\demo.ipynb',
              sourceKind: 'notebook',
            },
          ],
        })}
      />
    );

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'DOCX' }));
    });

    expect(fetchMock).toHaveBeenCalledWith(
      `${API_BASE}/api/docx/download?artifact_id=current-live`,
      DOCX_NO_STORE_FETCH,
    );
  });

  it('opens the persisted project DOCX through the desktop bridge when a workspace path is available', async () => {
    const openPath = jest.fn().mockResolvedValue('C:\\workspace\\Docx_Documents\\report.docx');
    window.inspyroDesktop = {
      isDesktop: true,
      openPath,
    };
    const fetchMock = jest.fn();
    global.fetch = fetchMock;
    const onStatusMessage = jest.fn();

    render(
      <DocxViewer
        {...buildProps({
          docxArtifactId: 'current-live',
          docxUpdatedAt: 500,
          docxWorkspacePath: 'C:\\workspace\\Docx_Documents\\report.docx',
          docxWorkspaceRelpath: 'Docx_Documents\\report.docx',
          onStatusMessage,
        })}
      />
    );

    expect(screen.getByText('DOCX listo para abrirse desde la carpeta del proyecto')).toBeTruthy();

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'DOCX' }));
    });

    expect(openPath).toHaveBeenCalledWith('C:\\workspace\\Docx_Documents\\report.docx');
    expect(fetchMock).not.toHaveBeenCalled();
    expect(onStatusMessage).toHaveBeenCalledWith('DOCX abierto desde la carpeta del proyecto', 'success');
  });

  it('warns and falls back to download on desktop when no project-backed DOCX path is available', async () => {
    const openPath = jest.fn();
    window.inspyroDesktop = {
      isDesktop: true,
      openPath,
    };
    const fetchMock = jest.fn().mockImplementation((url) => {
      if (url.includes('/api/docx/history')) {
        return Promise.resolve({
          ok: true,
          json: async () => ({ items: [] }),
        });
      }
      return Promise.resolve({
        ok: true,
        blob: async () => new Blob(['docx'], {
          type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        }),
      });
    });
    global.fetch = fetchMock;
    const onStatusMessage = jest.fn();

    render(
      <DocxViewer
        {...buildProps({
          docxUpdatedAt: 500,
          sourcePath: 'C:\\workspace\\demo.ipynb',
          sourceKind: 'notebook',
          kernelId: 'kernel-live',
          docxWorkspaceWarning: 'active_workspace_missing',
          onStatusMessage,
        })}
      />
    );

    await act(async () => Promise.resolve());

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'DOCX' }));
    });

    expect(openPath).not.toHaveBeenCalled();
    expect(onStatusMessage).toHaveBeenCalledWith(
      'No hay un proyecto activo para abrir este DOCX desde la carpeta del proyecto.',
      'warning',
    );
    expect(fetchMock).toHaveBeenLastCalledWith(
      `${API_BASE}/api/docx/download?source_path=C%3A%5Cworkspace%5Cdemo.ipynb`,
      DOCX_NO_STORE_FETCH,
    );
  });

  it('uses the stable source fallback before older history when the current DOCX has no artifact id yet', async () => {
    const fetchMock = jest.fn().mockImplementation((url) => {
      if (url.includes('/api/docx/history')) {
        return Promise.resolve({
          ok: true,
          json: async () => ({ items: [] }),
        });
      }
      return Promise.resolve({
        ok: true,
        blob: async () => new Blob(['docx'], {
          type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        }),
      });
    });
    global.fetch = fetchMock;

    render(
      <DocxViewer
        {...buildProps({
          docxUpdatedAt: 500,
          sourcePath: 'C:\\workspace\\demo.ipynb',
          sourceKind: 'notebook',
          kernelId: 'kernel-live',
          docxHistory: [
            {
              id: 'artifact:old-history',
              createdAt: 100,
              downloadUrl: '/api/docx/download?artifact_id=old-history',
              docxFileName: 'old.docx',
              sourcePath: 'C:\\workspace\\demo.ipynb',
              sourceKind: 'notebook',
            },
          ],
        })}
      />
    );

    await act(async () => Promise.resolve());

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'DOCX' }));
    });

    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      `${API_BASE}/api/docx/history?source_path=C%3A%5Cworkspace%5Cdemo.ipynb&kernel_id=kernel-live&limit=20`,
      DOCX_NO_STORE_FETCH,
    );
    expect(fetchMock).toHaveBeenLastCalledWith(
      `${API_BASE}/api/docx/download?source_path=C%3A%5Cworkspace%5Cdemo.ipynb`,
      DOCX_NO_STORE_FETCH,
    );
  });

  it('keeps the DOCX button enabled while remote history is still loading if the live payload is fresh', () => {
    global.fetch = jest.fn(() => new Promise(() => {}));

    render(
      <DocxViewer
        {...buildProps({
          docxArtifactId: 'live-docx',
          docxUpdatedAt: 500,
          sourcePath: 'C:\\workspace\\demo.ipynb',
          sourceKind: 'notebook',
          kernelId: 'kernel-live',
        })}
      />
    );

    expect(screen.getByRole('button', { name: 'DOCX' }).disabled).toBe(false);
  });

  it('re-fetches stable source-based DOCX downloads with no-store on repeated clicks', async () => {
    const fetchMock = jest.fn().mockImplementation((url) => {
      if (url.includes('/api/docx/history')) {
        return Promise.resolve({
          ok: true,
          json: async () => ({ items: [] }),
        });
      }
      return Promise.resolve({
        ok: true,
        blob: async () => new Blob(['docx'], {
          type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        }),
      });
    });
    global.fetch = fetchMock;

    render(
      <DocxViewer
        {...buildProps({
          docxUpdatedAt: 500,
          sourcePath: 'C:\\workspace\\demo.ipynb',
          sourceKind: 'notebook',
          kernelId: 'kernel-live',
        })}
      />
    );

    await act(async () => Promise.resolve());

    const downloadButton = screen.getByRole('button', { name: 'DOCX' });

    await act(async () => {
      fireEvent.click(downloadButton);
    });
    await act(async () => {
      fireEvent.click(downloadButton);
    });

    expect(fetchMock).toHaveBeenNthCalledWith(
      3,
      `${API_BASE}/api/docx/download?source_path=C%3A%5Cworkspace%5Cdemo.ipynb`,
      DOCX_NO_STORE_FETCH,
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      5,
      `${API_BASE}/api/docx/download?source_path=C%3A%5Cworkspace%5Cdemo.ipynb`,
      DOCX_NO_STORE_FETCH,
    );
  });

  it('refreshes remote history and retries with the new stable artifact when source-based download returns 404', async () => {
    const historyUrl = `${API_BASE}/api/docx/history?source_path=C%3A%5Cworkspace%5Cdemo.ipynb&kernel_id=kernel-live&limit=20`;
    const sourceDownloadUrl = `${API_BASE}/api/docx/download?source_path=C%3A%5Cworkspace%5Cdemo.ipynb`;
    const artifactDownloadUrl = `${API_BASE}/api/docx/download?artifact_id=artifact-new`;
    let historyCallCount = 0;
    const fetchMock = jest.fn().mockImplementation((url) => {
      if (url === historyUrl) {
        historyCallCount += 1;
        return Promise.resolve({
          ok: true,
          json: async () => ({
            items: historyCallCount === 1 ? [] : [
              {
                artifact_id: 'artifact-new',
                created_at: '2026-04-18T16:00:00Z',
                download_url: '/api/docx/download?artifact_id=artifact-new',
                filename: 'Docx_document_2026-04-18_16-00-00-000.docx',
                source_path: 'C:\\workspace\\demo.ipynb',
                source_kind: 'notebook',
                docx_is_empty: false,
              },
            ],
          }),
        });
      }
      if (url === sourceDownloadUrl) {
        return Promise.resolve({ ok: false, status: 404 });
      }
      if (url === artifactDownloadUrl) {
        return Promise.resolve({
          ok: true,
          blob: async () => new Blob(['docx'], {
            type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
          }),
        });
      }
      throw new Error(`Unexpected fetch URL: ${url}`);
    });
    global.fetch = fetchMock;

    render(
      <DocxViewer
        {...buildProps({
          docxUpdatedAt: 500,
          sourcePath: 'C:\\workspace\\demo.ipynb',
          sourceKind: 'notebook',
          kernelId: 'kernel-live',
        })}
      />
    );

    await act(async () => Promise.resolve());

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'DOCX' }));
    });

    expect(fetchMock).toHaveBeenNthCalledWith(1, historyUrl, DOCX_NO_STORE_FETCH);
    expect(fetchMock).toHaveBeenNthCalledWith(2, historyUrl, DOCX_NO_STORE_FETCH);
    expect(fetchMock).toHaveBeenNthCalledWith(3, artifactDownloadUrl, DOCX_NO_STORE_FETCH);
  });

  it('prefers a newer remote artifact over the generic source download when live metadata has no artifact id yet', async () => {
    const historyUrl = `${API_BASE}/api/docx/history?source_path=C%3A%5Cworkspace%5Cdemo.ipynb&kernel_id=kernel-live&limit=20`;
    const sourceDownloadUrl = `${API_BASE}/api/docx/download?source_path=C%3A%5Cworkspace%5Cdemo.ipynb`;
    const artifactDownloadUrl = `${API_BASE}/api/docx/download?artifact_id=artifact-new`;
    let historyCallCount = 0;
    const fetchMock = jest.fn().mockImplementation((url) => {
      if (url === historyUrl) {
        historyCallCount += 1;
        const item = historyCallCount === 1
          ? {
            artifact_id: 'artifact-old',
            created_at: '2026-04-18T15:00:00Z',
            download_url: '/api/docx/download?artifact_id=artifact-old',
            filename: 'Docx_document_2026-04-18_15-00-00-000.docx',
            source_path: 'C:\\workspace\\demo.ipynb',
            source_kind: 'notebook',
            docx_is_empty: false,
          }
          : {
            artifact_id: 'artifact-new',
            created_at: '2026-04-18T16:00:00Z',
            download_url: '/api/docx/download?artifact_id=artifact-new',
            filename: 'Docx_document_2026-04-18_16-00-00-000.docx',
            source_path: 'C:\\workspace\\demo.ipynb',
            source_kind: 'notebook',
            docx_is_empty: false,
          };
        return Promise.resolve({
          ok: true,
          json: async () => ({ items: [item] }),
        });
      }
      if (url === artifactDownloadUrl) {
        return Promise.resolve({
          ok: true,
          blob: async () => new Blob(['docx'], {
            type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
          }),
        });
      }
      if (url === sourceDownloadUrl) {
        throw new Error('Source download should not be used when a newer artifact is available.');
      }
      throw new Error(`Unexpected fetch URL: ${url}`);
    });
    global.fetch = fetchMock;

    render(
      <DocxViewer
        {...buildProps({
          docxUpdatedAt: Date.parse('2026-04-18T16:30:00Z'),
          sourcePath: 'C:\\workspace\\demo.ipynb',
          sourceKind: 'notebook',
          kernelId: 'kernel-live',
          docxHistory: [
            {
              id: 'artifact:artifact-old',
              createdAt: 100,
              downloadUrl: '/api/docx/download?artifact_id=artifact-old',
              docxFileName: 'old.docx',
              sourcePath: 'C:\\workspace\\demo.ipynb',
              sourceKind: 'notebook',
            },
          ],
        })}
      />
    );

    await act(async () => Promise.resolve());

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'DOCX' }));
    });

    expect(fetchMock).toHaveBeenNthCalledWith(1, historyUrl, DOCX_NO_STORE_FETCH);
    expect(fetchMock).toHaveBeenNthCalledWith(2, historyUrl, DOCX_NO_STORE_FETCH);
    expect(fetchMock).toHaveBeenNthCalledWith(3, artifactDownloadUrl, DOCX_NO_STORE_FETCH);
  });

  it('refreshes remote history when a new DOCX generation updates docxUpdatedAt for the same notebook', async () => {
    const historyUrl = `${API_BASE}/api/docx/history?source_path=C%3A%5Cworkspace%5Cdemo.ipynb&kernel_id=kernel-live&limit=20`;
    const fetchMock = jest.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          items: [
            {
              artifact_id: 'artifact-old',
              created_at: new Date(100).toISOString(),
              download_url: '/api/docx/download?artifact_id=artifact-old',
              filename: 'old.docx',
              source_path: 'C:\\workspace\\demo.ipynb',
              source_kind: 'notebook',
            },
          ],
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          items: [
            {
              artifact_id: 'artifact-new',
              created_at: new Date(200).toISOString(),
              download_url: '/api/docx/download?artifact_id=artifact-new',
              filename: 'new.docx',
              source_path: 'C:\\workspace\\demo.ipynb',
              source_kind: 'notebook',
            },
            {
              artifact_id: 'artifact-old',
              created_at: new Date(100).toISOString(),
              download_url: '/api/docx/download?artifact_id=artifact-old',
              filename: 'old.docx',
              source_path: 'C:\\workspace\\demo.ipynb',
              source_kind: 'notebook',
            },
          ],
        }),
      })
      .mockResolvedValue({
        ok: true,
        blob: async () => new Blob(['docx'], {
          type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        }),
      });
    global.fetch = fetchMock;

    const initialProps = buildProps({
      docxUpdatedAt: 100,
      sourcePath: 'C:\\workspace\\demo.ipynb',
      sourceKind: 'notebook',
      kernelId: 'kernel-live',
    });
    const { rerender } = render(<DocxViewer {...initialProps} />);

    await act(async () => Promise.resolve());

    rerender(
      <DocxViewer
        {...buildProps({
          docxUpdatedAt: 200,
          sourcePath: 'C:\\workspace\\demo.ipynb',
          sourceKind: 'notebook',
          kernelId: 'kernel-live',
        })}
      />
    );

    await act(async () => Promise.resolve());
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'DOCX' }));
    });

    expect(fetchMock).toHaveBeenNthCalledWith(1, historyUrl, DOCX_NO_STORE_FETCH);
    expect(fetchMock).toHaveBeenNthCalledWith(2, historyUrl, DOCX_NO_STORE_FETCH);
    expect(fetchMock).toHaveBeenNthCalledWith(
      3,
      `${API_BASE}/api/docx/download?artifact_id=artifact-new`,
      DOCX_NO_STORE_FETCH,
    );
  });

  it('refreshes remote history when a new PDF ref arrives for the same notebook but live DOCX metadata is stale', async () => {
    const historyUrl = `${API_BASE}/api/docx/history?source_path=C%3A%5Cworkspace%5Cdemo.ipynb&kernel_id=kernel-live&limit=20`;
    let historyCallCount = 0;
    const fetchMock = jest.fn().mockImplementation((url) => {
      if (url === historyUrl) {
        historyCallCount += 1;
        const items = historyCallCount === 1
          ? [
            {
              artifact_id: 'artifact-old',
              created_at: new Date(100).toISOString(),
              download_url: '/api/docx/download?artifact_id=artifact-old',
              filename: 'old.docx',
              source_path: 'C:\\workspace\\demo.ipynb',
              source_kind: 'notebook',
            },
          ]
          : [
            {
              artifact_id: 'artifact-new',
              created_at: new Date(200).toISOString(),
              download_url: '/api/docx/download?artifact_id=artifact-new',
              filename: 'new.docx',
              source_path: 'C:\\workspace\\demo.ipynb',
              source_kind: 'notebook',
            },
            {
              artifact_id: 'artifact-old',
              created_at: new Date(100).toISOString(),
              download_url: '/api/docx/download?artifact_id=artifact-old',
              filename: 'old.docx',
              source_path: 'C:\\workspace\\demo.ipynb',
              source_kind: 'notebook',
            },
          ];
        return Promise.resolve({
          ok: true,
          json: async () => ({ items }),
        });
      }

      if (url.includes('/api/pdf/download')) {
        return Promise.resolve({
          ok: true,
          blob: async () => new Blob(['pdf'], { type: 'application/pdf' }),
        });
      }

      return Promise.resolve({
        ok: true,
        blob: async () => new Blob(['docx'], {
          type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        }),
      });
    });
    global.fetch = fetchMock;

    const { rerender } = render(
      <DocxViewer
        {...buildProps({
          sourcePath: 'C:\\workspace\\demo.ipynb',
          sourceKind: 'notebook',
          kernelId: 'kernel-live',
          pdfRefUrl: '/api/pdf/download?token=pdf-old',
        })}
      />
    );

    await act(async () => Promise.resolve());

    rerender(
      <DocxViewer
        {...buildProps({
          sourcePath: 'C:\\workspace\\demo.ipynb',
          sourceKind: 'notebook',
          kernelId: 'kernel-live',
          pdfRefUrl: '/api/pdf/download?token=pdf-new',
        })}
      />
    );

    await act(async () => Promise.resolve());
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'DOCX' }));
    });

    expect(fetchMock).toHaveBeenCalledWith(historyUrl, DOCX_NO_STORE_FETCH);
    expect(fetchMock).toHaveBeenCalledWith(
      `${API_BASE}/api/docx/download?artifact_id=artifact-new`,
      DOCX_NO_STORE_FETCH,
    );
  });

  it('navigates to code and opens the provenance rail when source mode is active', async () => {
    const fetchMock = jest.fn((url) => {
      if (url.includes('/api/pdf/download')) {
        return Promise.resolve({
          ok: true,
          blob: async () => new Blob(['pdf'], { type: 'application/pdf' }),
        });
      }
      if (url.includes('/api/docx/provenance')) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            items: [
              {
                provenance_id: 'prov-1',
                notebook_cell_id: 'cell-12',
                line: 42,
                exact_file_path: 'C:\\workspace\\helper_impl.py',
                exact_line: 18,
                api_name: 'heading',
                element_kind: 'heading',
                precision: 'exact',
                text_preview: 'Titulo de prueba',
                user_stack: [
                  { notebook_cell_id: 'cell-12', line: 42 },
                  { file_path: 'C:\\workspace\\helper_impl.py', line: 18 },
                ],
              },
            ],
          }),
        });
      }
      return Promise.resolve({
        ok: true,
        json: async () => ({ items: [] }),
      });
    });
    global.fetch = fetchMock;
    const onNavigateToCode = jest.fn().mockResolvedValue(true);

    render(
      <DocxViewer
        {...buildProps({
          pdfRefUrl: '/api/pdf/download?token=pdf-1',
          docxProvenanceAvailable: true,
          docxProvenanceRef: '/api/docx/provenance?artifact_id=docx-1',
          onNavigateToCode,
        })}
      />
    );

    await act(async () => Promise.resolve());
    await act(async () => Promise.resolve());
    fireEvent.click(screen.getByTestId('mock-pdf-summary'));

    const toggle = screen.getByTestId('docx-source-mode-toggle');
    expect(toggle.disabled).toBe(false);

    await act(async () => {
      fireEvent.click(toggle);
    });
    await act(async () => {
      fireEvent.click(screen.getByTestId('mock-pdf-provenance-link'));
    });

    expect(onNavigateToCode).toHaveBeenCalledWith({
      filePath: 'C:\\workspace\\helper_impl.py',
      cellId: 'cell-12',
      line: 18,
    });
    expect(screen.getByTestId('docx-provenance-rail')).toBeTruthy();
    expect(screen.getByText(/Titulo de prueba/i)).toBeTruthy();
    expect(screen.getByText(/^Callsite$/i)).toBeTruthy();
    expect(screen.getByText(/^Exacta$/i)).toBeTruthy();
    expect(screen.getAllByText(/C:\\workspace\\helper_impl.py:18/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/cell-12/i).length).toBeGreaterThan(0);

    await act(async () => {
      fireEvent.click(screen.getByTestId('docx-provenance-go-callsite'));
    });

    expect(onNavigateToCode).toHaveBeenNthCalledWith(2, {
      filePath: null,
      cellId: 'cell-12',
      line: 42,
    });
  });

  it('closes the provenance rail when opening the outline rail in overlay mode', async () => {
    const fetchMock = jest.fn((url) => {
      if (url.includes('/api/pdf/download')) {
        return Promise.resolve({
          ok: true,
          blob: async () => new Blob(['pdf'], { type: 'application/pdf' }),
        });
      }
      if (url.includes('/api/docx/provenance')) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            items: [
              {
                provenance_id: 'prov-1',
                notebook_cell_id: 'cell-12',
                line: 42,
                api_name: 'heading',
                element_kind: 'heading',
                precision: 'exact',
                text_preview: 'Titulo de prueba',
              },
            ],
          }),
        });
      }
      return Promise.resolve({
        ok: true,
        json: async () => ({ items: [] }),
      });
    });
    global.fetch = fetchMock;
    const onNavigateToCode = jest.fn().mockResolvedValue(true);

    render(
      <DocxViewer
        {...buildProps({
          sourcePath: 'C:\\workspace\\report.ipynb',
          sourceKind: 'notebook',
          pdfRefUrl: '/api/pdf/download?token=pdf-1',
          docxProvenanceAvailable: true,
          docxProvenanceRef: '/api/docx/provenance?artifact_id=docx-1',
          onNavigateToCode,
        })}
      />
    );

    await act(async () => Promise.resolve());
    await act(async () => Promise.resolve());
    fireEvent.click(screen.getByTestId('mock-pdf-summary'));

    await act(async () => {
      fireEvent.click(screen.getByTestId('docx-source-mode-toggle'));
    });
    await act(async () => {
      fireEvent.click(screen.getByTestId('mock-pdf-provenance-link'));
    });

    expect(screen.getByTestId('docx-provenance-rail')).toBeTruthy();

    fireEvent.click(screen.getByTestId('docx-outline-toggle'));

    expect(screen.getByTestId('docx-outline-rail').className).toContain('is-overlay');
    expect(screen.queryByTestId('docx-provenance-rail')).toBeNull();
  });

  it('switches the outline rail to overlay when the provenance rail consumes the usable PDF viewport', async () => {
    Object.defineProperty(window, 'innerWidth', {
      configurable: true,
      writable: true,
      value: 760,
    });

    const fetchMock = jest.fn((url) => {
      if (url.includes('/api/pdf/download')) {
        return Promise.resolve({
          ok: true,
          blob: async () => new Blob(['pdf'], { type: 'application/pdf' }),
        });
      }
      if (url.includes('/api/docx/provenance')) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            items: [
              {
                provenance_id: 'prov-1',
                notebook_cell_id: 'cell-12',
                line: 42,
                api_name: 'heading',
                element_kind: 'heading',
                precision: 'exact',
                text_preview: 'Titulo de prueba',
              },
            ],
          }),
        });
      }
      return Promise.resolve({
        ok: true,
        json: async () => ({ items: [] }),
      });
    });
    global.fetch = fetchMock;

    render(
      <DocxViewer
        {...buildProps({
          sourcePath: 'C:\\workspace\\report.ipynb',
          sourceKind: 'notebook',
          pdfRefUrl: '/api/pdf/download?token=pdf-1',
          docxProvenanceAvailable: true,
          docxProvenanceRef: '/api/docx/provenance?artifact_id=docx-1',
          onNavigateToCode: jest.fn().mockResolvedValue(true),
        })}
      />
    );

    await act(async () => Promise.resolve());
    await act(async () => Promise.resolve());
    fireEvent.click(screen.getByTestId('mock-pdf-summary'));

    await act(async () => {
      fireEvent.click(screen.getByTestId('docx-source-mode-toggle'));
    });
    await act(async () => {
      fireEvent.click(screen.getByTestId('mock-pdf-provenance-link'));
    });

    expect(screen.getByTestId('docx-provenance-rail')).toBeTruthy();

    await act(async () => {
      fireEvent.click(screen.getByTestId('docx-outline-toggle'));
    });

    expect(screen.getByTestId('docx-outline-rail').className).toContain('is-overlay');
  });

  it('resolves a missing provenance id directly from backend before navigating', async () => {
    mockPdfViewerProvenanceLinkUrl = 'http://127.0.0.1:8000/api/docx/provenance/open?provenance_id=prov-1';
    const fetchMock = jest.fn((url) => {
      if (url.includes('/api/pdf/download')) {
        return Promise.resolve({
          ok: true,
          blob: async () => new Blob(['pdf'], { type: 'application/pdf' }),
        });
      }
      if (url.includes('/api/docx/provenance?artifact_id=')) {
        return Promise.resolve({
          ok: true,
          json: async () => ({ items: [] }),
        });
      }
      if (url.includes('/api/docx/provenance/open') && url.includes('format=json')) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            artifact_id: 'docx-1',
            item: {
              provenance_id: 'prov-1',
              notebook_cell_id: 'cell-12',
              line: 42,
              exact_notebook_cell_id: 'cell-12',
              exact_line: 19,
              api_name: 'heading',
              element_kind: 'heading',
              precision: 'exact',
              text_preview: 'Resuelto en backend',
            },
          }),
        });
      }
      return Promise.resolve({
        ok: true,
        json: async () => ({ items: [] }),
      });
    });
    global.fetch = fetchMock;
    const onNavigateToCode = jest.fn().mockResolvedValue(true);

    render(
      <DocxViewer
        {...buildProps({
          pdfRefUrl: '/api/pdf/download?token=pdf-1',
          docxProvenanceAvailable: true,
          docxProvenanceRef: '/api/docx/provenance?artifact_id=docx-1',
          onNavigateToCode,
        })}
      />
    );

    await act(async () => Promise.resolve());
    await act(async () => Promise.resolve());
    fireEvent.click(screen.getByTestId('mock-pdf-summary'));

    await act(async () => {
      fireEvent.click(screen.getByTestId('docx-source-mode-toggle'));
    });
    await act(async () => {
      fireEvent.click(screen.getByTestId('mock-pdf-provenance-link'));
    });

    expect(fetchMock).toHaveBeenCalledWith(
      `${API_BASE}/api/docx/provenance/open?provenance_id=prov-1&format=json`,
      DOCX_NO_STORE_FETCH,
    );
    expect(onNavigateToCode).toHaveBeenCalledWith({
      filePath: null,
      cellId: 'cell-12',
      line: 19,
    });
    expect(screen.getByText(/Resuelto en backend/i)).toBeTruthy();
  });

  it('derives the provenance id from a stale absolute PDF link when the overlay payload omits it', async () => {
    mockPdfViewerProvenanceLinkUrl = 'http://127.0.0.1:8000/api/docx/provenance/open?provenance_id=prov-1';
    mockPdfViewerProvenanceId = null;
    const fetchMock = jest.fn((url) => {
      if (url.includes('/api/pdf/download')) {
        return Promise.resolve({
          ok: true,
          blob: async () => new Blob(['pdf'], { type: 'application/pdf' }),
        });
      }
      if (url.includes('/api/docx/provenance?artifact_id=')) {
        return Promise.resolve({
          ok: true,
          json: async () => ({ items: [] }),
        });
      }
      if (url === `${API_BASE}/api/docx/provenance/open?provenance_id=prov-1&format=json`) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            artifact_id: 'docx-1',
            item: {
              provenance_id: 'prov-1',
              notebook_cell_id: 'cell-12',
              line: 42,
              exact_notebook_cell_id: 'cell-12',
              exact_line: 19,
              api_name: 'heading',
              element_kind: 'heading',
              precision: 'exact',
              text_preview: 'Derivado del URL',
            },
          }),
        });
      }
      return Promise.resolve({
        ok: true,
        json: async () => ({ items: [] }),
      });
    });
    global.fetch = fetchMock;
    const onNavigateToCode = jest.fn().mockResolvedValue(true);

    render(
      <DocxViewer
        {...buildProps({
          pdfRefUrl: '/api/pdf/download?token=pdf-1',
          docxProvenanceAvailable: true,
          docxProvenanceRef: '/api/docx/provenance?artifact_id=docx-1',
          onNavigateToCode,
        })}
      />
    );

    await act(async () => Promise.resolve());
    await act(async () => Promise.resolve());
    fireEvent.click(screen.getByTestId('mock-pdf-summary'));

    await act(async () => {
      fireEvent.click(screen.getByTestId('docx-source-mode-toggle'));
    });
    await act(async () => {
      fireEvent.click(screen.getByTestId('mock-pdf-provenance-link'));
    });

    expect(fetchMock).toHaveBeenCalledWith(
      `${API_BASE}/api/docx/provenance/open?provenance_id=prov-1&format=json`,
      DOCX_NO_STORE_FETCH,
    );
    expect(onNavigateToCode).toHaveBeenCalledWith({
      filePath: null,
      cellId: 'cell-12',
      line: 19,
    });
  });

  it('rewrites stale absolute provenance links to the active backend when source mode is disabled', async () => {
    mockPdfViewerProvenanceLinkUrl = 'http://127.0.0.1:8000/api/docx/provenance/open?provenance_id=prov-1';
    global.fetch = jest.fn((url) => {
      if (url.includes('/api/pdf/download')) {
        return Promise.resolve({
          ok: true,
          blob: async () => new Blob(['pdf'], { type: 'application/pdf' }),
        });
      }
      if (url.includes('/api/docx/provenance?artifact_id=')) {
        return Promise.resolve({
          ok: true,
          json: async () => ({ items: [] }),
        });
      }
      return Promise.resolve({
        ok: true,
        json: async () => ({ items: [] }),
      });
    });

    render(
      <DocxViewer
        {...buildProps({
          pdfRefUrl: '/api/pdf/download?token=pdf-1',
          docxProvenanceAvailable: true,
          docxProvenanceRef: '/api/docx/provenance?artifact_id=docx-1',
        })}
      />
    );

    await act(async () => Promise.resolve());
    await act(async () => Promise.resolve());
    fireEvent.click(screen.getByTestId('mock-pdf-summary'));

    await act(async () => {
      fireEvent.click(screen.getByTestId('mock-pdf-provenance-link'));
    });

    expect(window.open).toHaveBeenCalledWith(
      `${API_BASE}/api/docx/provenance/open?provenance_id=prov-1`,
      '_blank',
      'noopener,noreferrer',
    );
  });

  it('uses the document source notebook path when provenance only provides a notebook cell id', async () => {
    const fetchMock = jest.fn((url) => {
      if (url.includes('/api/pdf/download')) {
        return Promise.resolve({
          ok: true,
          blob: async () => new Blob(['pdf'], { type: 'application/pdf' }),
        });
      }
      if (url.includes('/api/docx/provenance')) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            items: [
              {
                provenance_id: 'prov-1',
                notebook_cell_id: 'cell-12',
                line: 42,
                api_name: 'heading',
                element_kind: 'heading',
                precision: 'exact',
                text_preview: 'Notebook path fallback',
              },
            ],
          }),
        });
      }
      return Promise.resolve({
        ok: true,
        json: async () => ({ items: [] }),
      });
    });
    global.fetch = fetchMock;
    const onNavigateToCode = jest.fn().mockResolvedValue(true);

    render(
      <DocxViewer
        {...buildProps({
          sourcePath: 'C:\\workspace\\report.ipynb',
          sourceKind: 'notebook',
          pdfRefUrl: '/api/pdf/download?token=pdf-1',
          docxProvenanceAvailable: true,
          docxProvenanceRef: '/api/docx/provenance?artifact_id=docx-1',
          onNavigateToCode,
        })}
      />
    );

    await act(async () => Promise.resolve());
    await act(async () => Promise.resolve());
    fireEvent.click(screen.getByTestId('mock-pdf-summary'));

    await act(async () => {
      fireEvent.click(screen.getByTestId('docx-source-mode-toggle'));
    });
    await act(async () => {
      fireEvent.click(screen.getByTestId('mock-pdf-provenance-link'));
    });

    expect(onNavigateToCode).toHaveBeenCalledWith({
      filePath: 'C:\\workspace\\report.ipynb',
      cellId: 'cell-12',
      line: 42,
    });
  });

  it('does not duplicate the exact location in the rail when callsite and exact are the same', async () => {
    const fetchMock = jest.fn((url) => {
      if (url.includes('/api/pdf/download')) {
        return Promise.resolve({
          ok: true,
          blob: async () => new Blob(['pdf'], { type: 'application/pdf' }),
        });
      }
      if (url.includes('/api/docx/provenance')) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            items: [
              {
                provenance_id: 'prov-1',
                file_path: 'C:\\workspace\\report.py',
                line: 77,
                exact_file_path: 'C:\\workspace\\report.py',
                exact_line: 77,
                api_name: 'text',
                element_kind: 'paragraph',
                precision: 'exact',
                text_preview: 'Mismo destino',
              },
            ],
          }),
        });
      }
      return Promise.resolve({
        ok: true,
        json: async () => ({ items: [] }),
      });
    });
    global.fetch = fetchMock;

    render(
      <DocxViewer
        {...buildProps({
          pdfRefUrl: '/api/pdf/download?token=pdf-1',
          docxProvenanceAvailable: true,
          docxProvenanceRef: '/api/docx/provenance?artifact_id=docx-1',
        })}
      />
    );

    await act(async () => Promise.resolve());
    await act(async () => Promise.resolve());
    fireEvent.click(screen.getByTestId('mock-pdf-summary'));

    await act(async () => {
      fireEvent.click(screen.getByTestId('docx-source-mode-toggle'));
    });
    await act(async () => {
      fireEvent.click(screen.getByTestId('mock-pdf-provenance-link'));
    });

    expect(screen.getByTestId('docx-provenance-rail')).toBeTruthy();
    expect(screen.queryByText(/Exacta/i)).toBeNull();
    expect(screen.queryByTestId('docx-provenance-go-exact')).toBeNull();
  });

  it('keeps source mode disabled when the PDF has no provenance annotations', async () => {
    const fetchMock = jest.fn((url) => {
      if (url.includes('/api/pdf/download')) {
        return Promise.resolve({
          ok: true,
          blob: async () => new Blob(['pdf'], { type: 'application/pdf' }),
        });
      }
      if (url.includes('/api/docx/provenance')) {
        return Promise.resolve({
          ok: true,
          json: async () => ({ items: [] }),
        });
      }
      return Promise.resolve({
        ok: true,
        json: async () => ({ items: [] }),
      });
    });
    global.fetch = fetchMock;

    render(
      <DocxViewer
        {...buildProps({
          pdfRefUrl: '/api/pdf/download?token=pdf-1',
          docxProvenanceAvailable: true,
          docxProvenanceRef: '/api/docx/provenance?artifact_id=docx-1',
        })}
      />
    );

    await act(async () => Promise.resolve());
    await act(async () => Promise.resolve());
    fireEvent.click(screen.getByTestId('mock-pdf-no-provenance'));

    const toggle = screen.getByTestId('docx-source-mode-toggle');
    expect(toggle.disabled).toBe(true);
    expect(screen.getByText(/no contiene links de procedencia clicables/i)).toBeTruthy();
  });
});
