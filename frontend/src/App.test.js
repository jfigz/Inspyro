import {
  collectNewConflictPaths,
  getWorkspaceSessionFromPayload,
  pruneResolvedConflictPaths,
  resolveHomeTemplateOpenPaths,
  shouldShowProjectLauncher,
} from './App';
import { shouldAutoEnableMirrorAfterMcpAction } from './hooks/useMcpShellControls';
import { applyMcpArtifactToDocumentState } from './utils/docxArtifacts';

describe('applyMcpArtifactToDocumentState', () => {
  it('clears stale PDF conversion state when a mirrored PDF artifact arrives', () => {
    const previous = {
      pdfBase64: 'old-base64',
      pdfRefUrl: null,
      pdfHash: 'old-hash',
      pdfConversionError: 'conversion_failed',
      pdfAttempted: null,
      pdfConversionStdout: 'stdout',
      pdfConversionStderr: 'stderr',
      pdfConversionMs: 1234,
      conversionStatus: { message: 'Convirtiendo a PDF...' },
      converterUsed: 'libreoffice',
      wordError: 'Word failed',
    };

    const next = applyMcpArtifactToDocumentState(previous, {
      kind: 'pdf',
      ref: '/api/pdf/download?token=pdf-123',
      pdf_hash: 'pdf-hash-123',
    });

    expect(next.pdfBase64).toBeNull();
    expect(next.pdfRefUrl).toBe('/api/pdf/download?token=pdf-123');
    expect(next.pdfHash).toBe('pdf-hash-123');
    expect(next.pdfConversionError).toBeNull();
    expect(next.pdfAttempted).toBe(true);
    expect(next.pdfConversionStdout).toBeNull();
    expect(next.pdfConversionStderr).toBeNull();
    expect(next.pdfConversionMs).toBeNull();
    expect(next.conversionStatus).toBeNull();
    expect(next.converterUsed).toBeNull();
    expect(next.wordError).toBeNull();
  });

  it('hydrates inline DOCX data when a mirrored DOCX artifact arrives without ref', () => {
    const previous = {
      docxBase64: null,
      docxHash: null,
      docxDownloadUrl: null,
      docxFileName: null,
      docxSizeBytes: null,
      docxWarnings: ['old-warning'],
      docxError: 'old-error',
      docxStoreError: 'old-store-error',
    };

    const next = applyMcpArtifactToDocumentState(previous, {
      kind: 'docx',
      docx_file_b64: 'docx-inline-base64',
      docx_hash: 'docx-hash-123',
      docx_file_name: 'probe.docx',
      docx_size_bytes: 42,
    });

    expect(next.docxBase64).toBe('docx-inline-base64');
    expect(next.docxHash).toBe('docx-hash-123');
    expect(next.docxDownloadUrl).toBeNull();
    expect(next.docxFileName).toBe('probe.docx');
    expect(next.docxSizeBytes).toBe(42);
    expect(next.docxWarnings).toBeNull();
    expect(next.docxError).toBeNull();
    expect(next.docxStoreError).toBeNull();
  });

  it('builds a DOCX download url from token-only mirrored artifacts', () => {
    const previous = {
      docxBase64: null,
      docxHash: null,
      docxDownloadUrl: null,
      docxFileToken: null,
      docxFileName: null,
      docxSourcePath: 'C:\\workspace\\demo.ipynb',
    };

    const next = applyMcpArtifactToDocumentState(previous, {
      kind: 'docx',
      token: 'docx-token-123',
      docx_hash: 'docx-hash-123',
      docx_file_name: 'probe.docx',
      source_path: 'C:\\workspace\\demo.ipynb',
    });

    expect(next.docxDownloadUrl).toBe('/api/docx/download?token=docx-token-123');
    expect(next.docxFileToken).toBe('docx-token-123');
    expect(next.docxHash).toBe('docx-hash-123');
  });

  it('replaces the current DOCX ref when a newer mirrored DOCX artifact arrives', () => {
    const previous = {
      docxBase64: null,
      docxHash: 'old-hash',
      docxDownloadUrl: '/api/docx/download?artifact_id=old-artifact',
      docxFileToken: null,
      docxFileName: 'old.docx',
      docxSourcePath: 'C:\\workspace\\demo.ipynb',
      docxSourceKind: 'notebook',
    };

    const next = applyMcpArtifactToDocumentState(previous, {
      kind: 'docx',
      docx_ref: '/api/docx/download?artifact_id=new-artifact',
      docx_hash: 'new-hash',
      docx_file_name: 'new.docx',
      source_path: 'C:\\workspace\\demo.ipynb',
      source_kind: 'notebook',
    });

    expect(next.docxDownloadUrl).toBe('/api/docx/download?artifact_id=new-artifact');
    expect(next.docxHash).toBe('new-hash');
    expect(next.docxFileName).toBe('new.docx');
  });

  it('ignores mirrored DOCX artifacts without a stable identity or inline content', () => {
    const previous = {
      docxBase64: null,
      docxHash: 'old-hash',
      docxDownloadUrl: '/api/docx/download?artifact_id=old-artifact',
      docxFileToken: null,
      docxFileName: 'old.docx',
      docxSourcePath: 'C:\\workspace\\demo.ipynb',
      docxSourceKind: 'notebook',
    };

    const next = applyMcpArtifactToDocumentState(previous, {
      kind: 'docx',
      docx_hash: 'hash-only',
      docx_ref: null,
      docx_download_url: null,
      token: null,
    });

    expect(next).toEqual(previous);
  });

  it('normalizes workspace payload without forcing an active workspace from defaults', () => {
    const next = getWorkspaceSessionFromPayload({
      workspace_root: 'C:\\Users\\Usuario\\Documents\\Inspyro\\Projects',
      workspace_path: 'C:\\Users\\Usuario\\Documents\\Inspyro\\Projects',
      suggested_workspace_root: 'C:\\Users\\Usuario\\Documents\\Inspyro\\Projects',
      workspace_source: 'default',
      recent_workspaces: ['C:\\Users\\Usuario\\Documents\\Inspyro\\Projects\\Cliente-A'],
    });

    expect(next.activeWorkspace).toBeNull();
    expect(next.workspaceRoot).toBe('C:\\Users\\Usuario\\Documents\\Inspyro\\Projects');
    expect(next.suggestedWorkspaceRoot).toBe('C:\\Users\\Usuario\\Documents\\Inspyro\\Projects');
    expect(next.recentWorkspaces).toEqual(['C:\\Users\\Usuario\\Documents\\Inspyro\\Projects\\Cliente-A']);
  });

  it('shows the project launcher only when no workspace is active and there are no open files', () => {
    expect(shouldShowProjectLauncher({ activeWorkspace: null }, [])).toBe(true);
    expect(shouldShowProjectLauncher({ activeWorkspace: 'C:\\workspace\\demo' }, [])).toBe(false);
    expect(shouldShowProjectLauncher({ activeWorkspace: null }, [{ path: 'C:\\workspace\\demo\\main.py' }])).toBe(false);
  });

  it('auto-enables mirror only for successful MCP start and restart actions', () => {
    expect(shouldAutoEnableMirrorAfterMcpAction('start', true)).toBe(true);
    expect(shouldAutoEnableMirrorAfterMcpAction('restart', true)).toBe(true);
    expect(shouldAutoEnableMirrorAfterMcpAction('stop', true)).toBe(false);
    expect(shouldAutoEnableMirrorAfterMcpAction('start', false)).toBe(false);
  });

  it('collects only conflict paths that have not been warned yet', () => {
    const warnedPaths = new Set(['c:/workspace/demo.ipynb']);
    const { newlyWarnedPaths, nextWarnedPaths } = collectNewConflictPaths(
      ['C:\\workspace\\demo.ipynb', 'C:\\workspace\\fresh.ipynb'],
      warnedPaths,
    );

    expect(newlyWarnedPaths).toEqual(['C:\\workspace\\fresh.ipynb']);
    expect(Array.from(nextWarnedPaths)).toEqual([
      'c:/workspace/demo.ipynb',
      'c:/workspace/fresh.ipynb',
    ]);
  });

  it('prunes warned conflict paths once the file leaves conflict state', () => {
    const nextWarnedPaths = pruneResolvedConflictPaths(
      new Set(['c:/workspace/demo.ipynb', 'c:/workspace/fresh.ipynb']),
      ['C:\\workspace\\fresh.ipynb'],
    );

    expect(Array.from(nextWarnedPaths)).toEqual(['c:/workspace/fresh.ipynb']);
  });
});

describe('resolveHomeTemplateOpenPaths', () => {
  it('uses the notebook path as the open target when a template inventory row has a mirror DOCX', () => {
    const resolved = resolveHomeTemplateOpenPaths({
      path: 'C:\\workspace\\reports\\bridge.ipynb',
      template_mirror_path: 'C:\\workspace\\.inspyro\\templates\\bridge-template.docx',
    });

    expect(resolved).toEqual({
      notebookPath: 'C:\\workspace\\reports\\bridge.ipynb',
      templateMirrorPath: 'C:\\workspace\\.inspyro\\templates\\bridge-template.docx',
      templateJsonPath: null,
    });
  });

  it('does not treat a DOCX template path as the notebook to open', () => {
    const resolved = resolveHomeTemplateOpenPaths(
      { path: 'C:\\workspace\\.inspyro\\templates\\bridge-template.docx' },
      'C:\\workspace\\reports\\bridge.ipynb',
    );

    expect(resolved).toEqual({
      notebookPath: 'C:\\workspace\\reports\\bridge.ipynb',
      templateMirrorPath: 'C:\\workspace\\.inspyro\\templates\\bridge-template.docx',
      templateJsonPath: null,
    });
  });

  it('promotes a portable JSON binding as a template open source', () => {
    const resolved = resolveHomeTemplateOpenPaths({
      notebook_path: 'C:\\workspace\\reports\\bridge.ipynb',
      template_json_path: 'C:\\workspace\\reports\\bridge.inspyro-template.json',
      template_mirror_path: 'C:\\workspace\\.inspyro\\templates\\bridge-template.docx',
    });

    expect(resolved).toEqual({
      notebookPath: 'C:\\workspace\\reports\\bridge.ipynb',
      templateMirrorPath: 'C:\\workspace\\.inspyro\\templates\\bridge-template.docx',
      templateJsonPath: 'C:\\workspace\\reports\\bridge.inspyro-template.json',
    });
  });
});
