import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import FileTabs from './FileTabs';

const files = [
  { path: 'C:/workspace/demo_dependency_analyzer.ipynb', name: 'demo_dependency_analyzer.ipynb' },
  { path: 'C:/workspace/analysis.py', name: 'analysis.py' },
  { path: 'C:/workspace/README.md', name: 'README.md' },
];

const renderTabs = (props = {}) => {
  const defaultProps = {
    openFiles: files,
    activeFile: files[0],
    onFileSelect: jest.fn(),
    onFileClose: jest.fn(),
    onFileSave: jest.fn(),
    modifiedFiles: new Set(),
  };

  return {
    ...render(<FileTabs {...defaultProps} {...props} />),
    props: { ...defaultProps, ...props },
  };
};

describe('FileTabs', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('renders open files with the shared explorer SVG icons', () => {
    const { container } = renderTabs();

    expect(screen.getAllByRole('tab')).toHaveLength(3);
    expect(container.querySelectorAll('.tab-icon .explorer-svg-icon')).toHaveLength(3);
    expect(screen.getByText('demo_dependency_analyzer.ipynb')).toBeTruthy();
    expect(screen.getByText('analysis.py')).toBeTruthy();
    expect(screen.getByText('README.md')).toBeTruthy();
  });

  it('selects tabs by click and keyboard activation', () => {
    const onFileSelect = jest.fn();
    renderTabs({ onFileSelect });

    const pythonTab = screen.getByText('analysis.py').closest('.file-tab');
    fireEvent.click(pythonTab);
    expect(onFileSelect).toHaveBeenCalledWith(files[1]);

    fireEvent.keyDown(pythonTab, { key: 'Enter' });
    expect(onFileSelect).toHaveBeenLastCalledWith(files[1]);

    fireEvent.keyDown(pythonTab, { key: ' ' });
    expect(onFileSelect).toHaveBeenLastCalledWith(files[1]);
  });

  it('confirms before closing modified files', () => {
    const onFileClose = jest.fn();
    const confirmMock = jest.spyOn(window, 'confirm').mockReturnValue(false);
    renderTabs({
      onFileClose,
      modifiedFiles: new Set([files[0].path]),
    });

    fireEvent.click(screen.getByRole('button', { name: 'Cerrar demo_dependency_analyzer.ipynb' }));
    expect(confirmMock).toHaveBeenCalledTimes(1);
    expect(onFileClose).not.toHaveBeenCalled();

    confirmMock.mockReturnValue(true);
    fireEvent.click(screen.getByRole('button', { name: 'Cerrar demo_dependency_analyzer.ipynb' }));
    expect(onFileClose).toHaveBeenCalledWith(files[0]);
  });

  it('saves only modified files through the save all action', () => {
    const onFileSave = jest.fn();
    renderTabs({
      onFileSave,
      modifiedFiles: new Set([files[1].path, files[2].path]),
    });

    fireEvent.click(screen.getByRole('button', { name: 'Guardar todos' }));

    expect(onFileSave).toHaveBeenCalledTimes(2);
    expect(onFileSave).toHaveBeenNthCalledWith(1, files[1]);
    expect(onFileSave).toHaveBeenNthCalledWith(2, files[2]);
  });

  it('keeps active and modified state classes on their tabs', () => {
    renderTabs({
      activeFile: files[1],
      modifiedFiles: new Set([files[1].path]),
    });

    const pythonTab = screen.getByText('analysis.py').closest('.file-tab');
    expect(pythonTab.classList.contains('active')).toBe(true);
    expect(pythonTab.classList.contains('modified')).toBe(true);
    expect(pythonTab.getAttribute('aria-selected')).toBe('true');
    expect(pythonTab.querySelector('.modified-indicator-dot')).not.toBeNull();
  });
});
