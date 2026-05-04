import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { API_BASE } from '../config/endpoints';
import FileExplorer from './FileExplorer';

const apiUrl = (path) => `${API_BASE}${path}`;

const buildTreeResponse = (workspacePath) => ({
  name: 'workspace',
  path: workspacePath,
  isDirectory: true,
  writable: true,
  hidden: false,
  symlink: false,
  modified: 1,
  relativePath: '.',
  hasChildren: true,
  children: [],
});

const buildTreeResponseWithChildren = (workspacePath, children) => ({
  ...buildTreeResponse(workspacePath),
  children,
});

describe('FileExplorer', () => {
  afterEach(() => {
    jest.restoreAllMocks();
    delete global.fetch;
  });

  it('uses the left explorer title as the expanded toggle and handles clicks from the visible text', async () => {
    const workspacePath = 'C:\\workspace';
    const handleToggleCollapse = jest.fn();
    const fetchMock = jest.fn().mockImplementation((url) => {
      if (url === apiUrl('/api/system/info')) {
        return Promise.resolve({ ok: true, json: async () => ({ active_workspace: workspacePath }) });
      }
      if (url.startsWith(apiUrl('/api/files/tree?path='))) {
        return Promise.resolve({ ok: true, json: async () => buildTreeResponse(workspacePath) });
      }
      return Promise.reject(new Error(`Unexpected fetch URL: ${url}`));
    });

    global.fetch = fetchMock;

    render(
      <FileExplorer
        onFileOpen={jest.fn()}
        onWorkspaceChange={jest.fn()}
        currentWorkspace={workspacePath}
        isCollapsed={false}
        onToggleCollapse={handleToggleCollapse}
      />
    );

    const toggleButton = screen.getByRole('button', { name: 'Ocultar explorador de archivos' });
    expect(toggleButton.querySelector('svg')).not.toBeNull();
    expect(screen.queryByTitle('Ocultar explorador de archivos')).toBe(toggleButton);
    expect(screen.queryAllByRole('button', { name: 'Ocultar explorador de archivos' })).toHaveLength(1);

    fireEvent.click(screen.getByText('EXPLORADOR'));
    expect(handleToggleCollapse).toHaveBeenCalledTimes(1);

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(apiUrl('/api/system/info'));
    });
  });

  it('renders the collapsed explorer toggle with the show label and handles clicks', async () => {
    const workspacePath = 'C:\\workspace';
    const handleToggleCollapse = jest.fn();
    const fetchMock = jest.fn().mockImplementation((url) => {
      if (url === apiUrl('/api/system/info')) {
        return Promise.resolve({ ok: true, json: async () => ({ active_workspace: workspacePath }) });
      }
      if (url.startsWith(apiUrl('/api/files/tree?path='))) {
        return Promise.resolve({ ok: true, json: async () => buildTreeResponse(workspacePath) });
      }
      return Promise.reject(new Error(`Unexpected fetch URL: ${url}`));
    });

    global.fetch = fetchMock;

    render(
      <FileExplorer
        onFileOpen={jest.fn()}
        onWorkspaceChange={jest.fn()}
        currentWorkspace={workspacePath}
        isCollapsed
        onToggleCollapse={handleToggleCollapse}
      />
    );

    const toggleButton = screen.getByRole('button', { name: 'Mostrar explorador de archivos' });
    expect(toggleButton.querySelector('svg')).not.toBeNull();

    fireEvent.click(toggleButton);
    expect(handleToggleCollapse).toHaveBeenCalledTimes(1);

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(apiUrl('/api/system/info'));
    });
  });

  it('renders the rename action as an accessible SVG icon button', async () => {
    const workspacePath = 'C:\\workspace';
    const fetchMock = jest.fn().mockImplementation((url) => {
      if (url === apiUrl('/api/system/info')) {
        return Promise.resolve({ ok: true, json: async () => ({ active_workspace: workspacePath }) });
      }
      if (url.startsWith(apiUrl('/api/files/tree?path='))) {
        return Promise.resolve({ ok: true, json: async () => buildTreeResponse(workspacePath) });
      }
      return Promise.reject(new Error(`Unexpected fetch URL: ${url}`));
    });

    global.fetch = fetchMock;

    render(
      <FileExplorer
        onFileOpen={jest.fn()}
        onWorkspaceChange={jest.fn()}
        currentWorkspace={workspacePath}
        isCollapsed={false}
        onToggleCollapse={jest.fn()}
      />
    );

    const renameButton = screen.getByTestId('explorer-rename');
    expect(renameButton).toBe(screen.getByRole('button', { name: /Renombrar/i }));
    expect(renameButton.querySelector('svg')).not.toBeNull();

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(apiUrl('/api/system/info'));
    });

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        apiUrl('/api/files/tree?path=C%3A%5Cworkspace&depth=1&show_hidden=0')
      );
    });
  });

  it('loads folder children lazily when expanding a child directory', async () => {
    const workspacePath = 'C:\\workspace';
    const srcPath = 'C:\\workspace\\src';
    const fetchMock = jest.fn().mockImplementation((url) => {
      if (url === apiUrl('/api/system/info')) {
        return Promise.resolve({ ok: true, json: async () => ({ active_workspace: workspacePath }) });
      }

      if (url === apiUrl('/api/files/tree?path=C%3A%5Cworkspace&depth=1&show_hidden=0')) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            ...buildTreeResponse(workspacePath),
            children: [
              {
                name: 'src',
                path: srcPath,
                isDirectory: true,
                writable: true,
                hidden: false,
                symlink: false,
                modified: 1,
                relativePath: 'src',
                hasChildren: true,
                children: [],
              },
            ],
          }),
        });
      }

      if (url === apiUrl('/api/files/tree?path=C%3A%5Cworkspace%5Csrc&depth=1&show_hidden=0')) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            name: 'src',
            path: srcPath,
            isDirectory: true,
            writable: true,
            hidden: false,
            symlink: false,
            modified: 1,
            relativePath: 'src',
            hasChildren: true,
            children: [
              {
                name: 'main.py',
                path: `${srcPath}\\main.py`,
                isDirectory: false,
                writable: true,
                hidden: false,
                symlink: false,
                modified: 1,
                relativePath: 'src/main.py',
                hasChildren: false,
                size: 10,
                extension: '.py',
              },
            ],
          }),
        });
      }

      return Promise.reject(new Error(`Unexpected fetch URL: ${url}`));
    });

    global.fetch = fetchMock;

    render(
      <FileExplorer
        onFileOpen={jest.fn()}
        onWorkspaceChange={jest.fn()}
        currentWorkspace={workspacePath}
        isCollapsed={false}
        onToggleCollapse={jest.fn()}
      />
    );

    await screen.findByText('src');
    fireEvent.click(screen.getByText('src'));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        apiUrl('/api/files/tree?path=C%3A%5Cworkspace%5Csrc&depth=1&show_hidden=0')
      );
    });
    expect(await screen.findByText('main.py')).not.toBeNull();
  });

  it('runs quick open search and opens a selected result', async () => {
    const workspacePath = 'C:\\workspace';
    const handleFileOpen = jest.fn();
    const fetchMock = jest.fn().mockImplementation((url) => {
      if (url === apiUrl('/api/system/info')) {
        return Promise.resolve({ ok: true, json: async () => ({ active_workspace: workspacePath }) });
      }

      if (url === apiUrl('/api/files/tree?path=C%3A%5Cworkspace&depth=1&show_hidden=0')) {
        return Promise.resolve({ ok: true, json: async () => buildTreeResponse(workspacePath) });
      }

      if (url.includes('/api/files/search?')) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            results: [
              {
                name: 'main.py',
                path: 'C:\\workspace\\src\\main.py',
                relativePath: 'src/main.py',
                isDirectory: false,
                score: 300,
                extension: '.py',
              },
            ],
          }),
        });
      }

      if (url === apiUrl('/api/files/tree?path=C%3A%5Cworkspace%5Csrc&depth=1&show_hidden=0')) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            name: 'src',
            path: 'C:\\workspace\\src',
            isDirectory: true,
            writable: true,
            hidden: false,
            symlink: false,
            modified: 1,
            relativePath: 'src',
            hasChildren: true,
            children: [],
          }),
        });
      }

      return Promise.reject(new Error(`Unexpected fetch URL: ${url}`));
    });

    global.fetch = fetchMock;

    render(
      <FileExplorer
        onFileOpen={handleFileOpen}
        onWorkspaceChange={jest.fn()}
        currentWorkspace={workspacePath}
        isCollapsed={false}
        onToggleCollapse={jest.fn()}
      />
    );

    fireEvent.change(screen.getByTestId('explorer-search'), { target: { value: 'main' } });

    expect(await screen.findByText('main.py')).not.toBeNull();
    fireEvent.click(screen.getByText('main.py'));

    await waitFor(() => {
      expect(handleFileOpen).toHaveBeenCalledWith(expect.objectContaining({
        path: 'C:\\workspace\\src\\main.py',
        name: 'main.py',
      }));
    });
  });

  it('shows open with default application for file context menus and triggers the callback', async () => {
    const workspacePath = 'C:\\workspace';
    const filePath = `${workspacePath}\\report.pdf`;
    const handleOpenDefaultApplication = jest.fn().mockResolvedValue(true);
    const fetchMock = jest.fn().mockImplementation((url) => {
      if (url === apiUrl('/api/system/info')) {
        return Promise.resolve({ ok: true, json: async () => ({ active_workspace: workspacePath }) });
      }
      if (url.startsWith(apiUrl('/api/files/tree?path='))) {
        return Promise.resolve({
          ok: true,
          json: async () => buildTreeResponseWithChildren(workspacePath, [
            {
              name: 'report.pdf',
              path: filePath,
              isDirectory: false,
              writable: true,
              hidden: false,
              symlink: false,
              modified: 1,
              relativePath: 'report.pdf',
              hasChildren: false,
              size: 128,
              extension: '.pdf',
            },
          ]),
        });
      }
      return Promise.reject(new Error(`Unexpected fetch URL: ${url}`));
    });

    global.fetch = fetchMock;

    render(
      <FileExplorer
        onFileOpen={jest.fn()}
        onOpenDefaultApplication={handleOpenDefaultApplication}
        onWorkspaceChange={jest.fn()}
        currentWorkspace={workspacePath}
        isCollapsed={false}
        onToggleCollapse={jest.fn()}
      />
    );

    const fileNode = await screen.findByText('report.pdf');
    fireEvent.contextMenu(fileNode);
    fireEvent.click(screen.getByRole('button', { name: 'Abrir con aplicacion por defecto' }));

    await waitFor(() => {
      expect(handleOpenDefaultApplication).toHaveBeenCalledWith(expect.objectContaining({
        path: filePath,
        name: 'report.pdf',
        isDirectory: false,
      }));
    });
  });

  it('does not show open with default application for directory context menus', async () => {
    const workspacePath = 'C:\\workspace';
    const srcPath = `${workspacePath}\\src`;
    const fetchMock = jest.fn().mockImplementation((url) => {
      if (url === apiUrl('/api/system/info')) {
        return Promise.resolve({ ok: true, json: async () => ({ active_workspace: workspacePath }) });
      }
      if (url.startsWith(apiUrl('/api/files/tree?path='))) {
        return Promise.resolve({
          ok: true,
          json: async () => buildTreeResponseWithChildren(workspacePath, [
            {
              name: 'src',
              path: srcPath,
              isDirectory: true,
              writable: true,
              hidden: false,
              symlink: false,
              modified: 1,
              relativePath: 'src',
              hasChildren: false,
              children: [],
            },
          ]),
        });
      }
      return Promise.reject(new Error(`Unexpected fetch URL: ${url}`));
    });

    global.fetch = fetchMock;

    render(
      <FileExplorer
        onFileOpen={jest.fn()}
        onOpenDefaultApplication={jest.fn()}
        onWorkspaceChange={jest.fn()}
        currentWorkspace={workspacePath}
        isCollapsed={false}
        onToggleCollapse={jest.fn()}
      />
    );

    const folderNode = await screen.findByText('src');
    fireEvent.contextMenu(folderNode);

    expect(screen.queryByRole('button', { name: 'Abrir con aplicacion por defecto' })).toBeNull();
  });

  it('does not refetch the workspace tree when only the active file changes', async () => {
    const workspacePath = 'C:\\workspace';
    const treeUrl = apiUrl('/api/files/tree?path=C%3A%5Cworkspace&depth=1&show_hidden=0');
    const fetchMock = jest.fn().mockImplementation((url) => {
      if (url === apiUrl('/api/system/info')) {
        return Promise.resolve({ ok: true, json: async () => ({ active_workspace: workspacePath }) });
      }
      if (url === treeUrl) {
        return Promise.resolve({ ok: true, json: async () => buildTreeResponse(workspacePath) });
      }
      return Promise.reject(new Error(`Unexpected fetch URL: ${url}`));
    });

    global.fetch = fetchMock;

    const { rerender } = render(
      <FileExplorer
        onFileOpen={jest.fn()}
        onWorkspaceChange={jest.fn()}
        currentWorkspace={workspacePath}
        activeFilePath={null}
        isCollapsed={false}
        onToggleCollapse={jest.fn()}
      />
    );

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(treeUrl);
    });

    const treeCallsBefore = fetchMock.mock.calls.filter(([url]) => url === treeUrl).length;

    rerender(
      <FileExplorer
        onFileOpen={jest.fn()}
        onWorkspaceChange={jest.fn()}
        currentWorkspace={workspacePath}
        activeFilePath={'C:\\workspace\\main.py'}
        isCollapsed={false}
        onToggleCollapse={jest.fn()}
      />
    );

    await waitFor(() => {
      const treeCallsAfter = fetchMock.mock.calls.filter(([url]) => url === treeUrl).length;
      expect(treeCallsAfter).toBe(treeCallsBefore);
    });
  });

  it('does not refetch the root tree after the initial root-path stabilization', async () => {
    const workspacePath = 'C:\\workspace';
    const treeUrl = apiUrl('/api/files/tree?path=C%3A%5Cworkspace&depth=1&show_hidden=0');
    const fetchMock = jest.fn().mockImplementation((url) => {
      if (url === apiUrl('/api/system/info')) {
        return Promise.resolve({ ok: true, json: async () => ({ active_workspace: workspacePath }) });
      }
      if (url === treeUrl) {
        return Promise.resolve({ ok: true, json: async () => buildTreeResponse(workspacePath) });
      }
      return Promise.reject(new Error(`Unexpected fetch URL: ${url}`));
    });

    global.fetch = fetchMock;

    render(
      <FileExplorer
        onFileOpen={jest.fn()}
        onWorkspaceChange={jest.fn()}
        currentWorkspace={workspacePath}
        activeFilePath={null}
        isCollapsed={false}
        onToggleCollapse={jest.fn()}
      />
    );

    await waitFor(() => {
      const treeCalls = fetchMock.mock.calls.filter(([url]) => url === treeUrl).length;
      expect(treeCalls).toBe(1);
    });
  });

  it('does not refetch the root tree for file-only modified workspace events', async () => {
    const workspacePath = 'C:\\workspace';
    const treeUrl = apiUrl('/api/files/tree?path=C%3A%5Cworkspace&depth=1&show_hidden=0');
    const fetchMock = jest.fn().mockImplementation((url) => {
      if (url === apiUrl('/api/system/info')) {
        return Promise.resolve({ ok: true, json: async () => ({ active_workspace: workspacePath }) });
      }
      if (url === treeUrl) {
        return Promise.resolve({ ok: true, json: async () => buildTreeResponse(workspacePath) });
      }
      return Promise.reject(new Error(`Unexpected fetch URL: ${url}`));
    });

    global.fetch = fetchMock;

    const { rerender } = render(
      <FileExplorer
        onFileOpen={jest.fn()}
        onWorkspaceChange={jest.fn()}
        currentWorkspace={workspacePath}
        activeFilePath={null}
        lastWorkspaceEvent={null}
        isCollapsed={false}
        onToggleCollapse={jest.fn()}
      />
    );

    await waitFor(() => {
      const treeCalls = fetchMock.mock.calls.filter(([url]) => url === treeUrl).length;
      expect(treeCalls).toBe(1);
    });

    rerender(
      <FileExplorer
        onFileOpen={jest.fn()}
        onWorkspaceChange={jest.fn()}
        currentWorkspace={workspacePath}
        activeFilePath={null}
        lastWorkspaceEvent={{
          id: 'evt-1',
          workspace_path: workspacePath,
          events: [
            {
              action: 'modified',
              path: `${workspacePath}\\demo.ipynb`,
              parentPath: workspacePath,
              isDirectory: false,
            },
          ],
        }}
        isCollapsed={false}
        onToggleCollapse={jest.fn()}
      />
    );

    await waitFor(() => {
      const treeCalls = fetchMock.mock.calls.filter(([url]) => url === treeUrl).length;
      expect(treeCalls).toBe(1);
    });
  });
});
