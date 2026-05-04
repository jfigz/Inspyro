import {
  applyDocumentStatePayload,
  applyMcpArtifactToDocumentState,
  buildDocxDownloadUrlFromPayload,
  createDocxHistoryEntry,
  createEmptyDocumentState,
  getDocxStableIdentity,
  hasMeaningfulDocxArtifactPayload,
  loadDocxHistoryEntries,
  resetDocumentState,
  saveDocxHistoryEntries,
  upsertDocxHistoryEntry,
} from './docxArtifacts';

describe('docxArtifacts history', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it('ignores DOCX payloads that only carry stale nullable fields', () => {
    const payload = {
      docx_hash: 'hash-only',
      docx_error: null,
      docx_size_bytes: null,
      docx_ref: null,
      docx_download_url: null,
      docx_file_token: null,
    };

    expect(hasMeaningfulDocxArtifactPayload(payload)).toBe(false);
    expect(getDocxStableIdentity(payload)).toBeNull();
    expect(createDocxHistoryEntry(payload, { sourcePath: 'C:\\workspace\\demo.ipynb' })).toBeNull();
  });

  it('uses stable artifact identity instead of transient event ids', () => {
    const entry = createDocxHistoryEntry(
      {
        docx_artifact_id: 'artifact-123',
        docx_download_url: '/api/docx/download?artifact_id=artifact-123',
        docx_hash: 'hash-123',
        docx_file_name: 'report.docx',
      },
      {
        docxEventId: 'docx_evt_1',
        sourcePath: 'C:\\workspace\\demo.ipynb',
      },
    );

    expect(entry.id).toBe('artifact:artifact-123');
  });

  it('prefers artifact download routes over generic source-based URLs', () => {
    const payload = {
      docx_artifact_id: 'artifact-123',
      docx_download_url: '/api/docx/download?source_path=C%3A%5Cworkspace%5Cdemo.ipynb',
    };

    expect(buildDocxDownloadUrlFromPayload(payload)).toBe('/api/docx/download?artifact_id=artifact-123');
    expect(getDocxStableIdentity(payload)).toBe('artifact:artifact-123');
  });

  it('deduplicates local history by stable identity and purges legacy invalid entries on load', () => {
    const first = createDocxHistoryEntry(
      {
        docx_file_token: 'token-1',
        docx_download_url: '/api/docx/download?token=token-1',
        docx_hash: 'hash-1',
        docx_file_name: 'report.docx',
      },
      {
        sourcePath: 'C:\\workspace\\demo.ipynb',
        createdAt: 100,
      },
    );
    const duplicate = {
      ...first,
      id: 'legacy_docx_event_id',
      createdAt: 200,
    };
    const invalid = {
      id: 'junk',
      docxHash: 'hash-only',
      sourcePath: 'C:\\workspace\\demo.ipynb',
      downloadUrl: null,
    };

    saveDocxHistoryEntries([first, duplicate, invalid]);
    const loaded = loadDocxHistoryEntries();

    expect(loaded).toHaveLength(1);
    expect(loaded[0].id).toBe('download:/api/docx/download?token=token-1');

    const updated = upsertDocxHistoryEntry(loaded, {
      ...first,
      id: 'download:/api/docx/download?token=token-1',
      createdAt: 300,
    });
    expect(updated).toHaveLength(1);
    expect(updated[0].createdAt).toBe(300);
  });

  it('keeps distinct local history entries when generations change artifact_id under the same source path', () => {
    const genericSourceUrl = '/api/docx/download?source_path=C%3A%5Cworkspace%5Cdemo.ipynb';
    const first = createDocxHistoryEntry(
      {
        docx_artifact_id: 'artifact-1',
        docx_download_url: genericSourceUrl,
        docx_hash: 'hash-1',
        docx_file_name: 'report.docx',
      },
      {
        sourcePath: 'C:\\workspace\\demo.ipynb',
        createdAt: 100,
      },
    );
    const second = createDocxHistoryEntry(
      {
        docx_artifact_id: 'artifact-2',
        docx_download_url: genericSourceUrl,
        docx_hash: 'hash-1',
        docx_file_name: 'report.docx',
      },
      {
        sourcePath: 'C:\\workspace\\demo.ipynb',
        createdAt: 200,
      },
    );

    const merged = upsertDocxHistoryEntry(upsertDocxHistoryEntry([], first), second);
    expect(merged).toHaveLength(2);
    expect(merged.map((entry) => entry.id)).toEqual(['artifact:artifact-2', 'artifact:artifact-1']);
  });

  it('merges pdf patches without clobbering the existing DOCX identity', () => {
    const previous = {
      ...createEmptyDocumentState(),
      docxArtifactId: 'artifact-1',
      docxDownloadUrl: '/api/docx/download?artifact_id=artifact-1',
      docxHash: 'docx-hash-1',
      docxSourcePath: 'C:\\workspace\\demo.ipynb',
      docxSourceKind: 'notebook',
    };

    const next = applyDocumentStatePayload(previous, {
      pdf_ref: '/api/pdf/download?token=pdf-1',
      pdf_hash: 'pdf-hash-1',
      pdf_conversion_error: null,
      pdf_attempted: true,
    });

    expect(next.docxArtifactId).toBe('artifact-1');
    expect(next.docxDownloadUrl).toBe('/api/docx/download?artifact_id=artifact-1');
    expect(next.docxHash).toBe('docx-hash-1');
    expect(next.pdfRefUrl).toBe('/api/pdf/download?token=pdf-1');
    expect(next.pdfHash).toBe('pdf-hash-1');
  });

  it('preserves variables when resetting document state explicitly', () => {
    const previous = {
      ...createEmptyDocumentState(),
      variables: { area: 42 },
      docxHash: 'docx-hash-1',
      pdfHash: 'pdf-hash-1',
    };

    const next = resetDocumentState(previous, { preserveVariables: true });

    expect(next.variables).toEqual({ area: 42 });
    expect(next.docxHash).toBeNull();
    expect(next.pdfHash).toBeNull();
  });

  it('hydrates mirrored pdf artifacts with recovered docx provenance metadata', () => {
    const previous = {
      ...createEmptyDocumentState(),
      docxSourcePath: 'C:\\workspace\\demo.ipynb',
      docxSourceKind: 'notebook',
    };

    const next = applyMcpArtifactToDocumentState(previous, {
      kind: 'pdf',
      ref: '/api/pdf/download?token=pdf-1',
      pdf_hash: 'pdf-hash-1',
      docx_artifact_id: 'artifact-1',
      docx_provenance_ref: '/api/docx/provenance?artifact_id=artifact-1',
    });

    expect(next.pdfRefUrl).toBe('/api/pdf/download?token=pdf-1');
    expect(next.pdfHash).toBe('pdf-hash-1');
    expect(next.docxArtifactId).toBe('artifact-1');
    expect(next.docxDownloadUrl).toBe('/api/docx/download?artifact_id=artifact-1');
    expect(next.docxProvenanceAvailable).toBe(true);
    expect(next.docxProvenanceRef).toBe('/api/docx/provenance?artifact_id=artifact-1');
  });

  it('preserves workspace metadata from docx payloads and history entries', () => {
    const next = applyDocumentStatePayload(createEmptyDocumentState(), {
      docx_artifact_id: 'artifact-1',
      docx_download_url: '/api/docx/download?artifact_id=artifact-1',
      workspace_path: 'C:\\workspace\\Docx_Documents\\report.docx',
      workspace_relpath: 'Docx_Documents\\report.docx',
      workspace_warning: 'active_workspace_missing',
    });

    expect(next.docxWorkspacePath).toBe('C:\\workspace\\Docx_Documents\\report.docx');
    expect(next.docxWorkspaceRelpath).toBe('Docx_Documents\\report.docx');
    expect(next.docxWorkspaceWarning).toBe('active_workspace_missing');

    const historyEntry = createDocxHistoryEntry({
      docx_artifact_id: 'artifact-1',
      docx_download_url: '/api/docx/download?artifact_id=artifact-1',
      workspace_path: 'C:\\workspace\\Docx_Documents\\report.docx',
      workspace_relpath: 'Docx_Documents\\report.docx',
    });

    expect(historyEntry.docxWorkspacePath).toBe('C:\\workspace\\Docx_Documents\\report.docx');
    expect(historyEntry.docxWorkspaceRelpath).toBe('Docx_Documents\\report.docx');
  });
});
