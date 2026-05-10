import { act, renderHook, waitFor } from '@testing-library/react';
import useStylePreviewPipeline from './hooks/useStylePreviewPipeline';
import useTablePreviewQueue from './hooks/useTablePreviewQueue';

describe('template preview hooks', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.clearAllMocks();
  });

  it('cancels the active style preview on timeout and on unmount', () => {
    const sendMessage = jest.fn();
    const { result, unmount } = renderHook(() => useStylePreviewPipeline({
      sendMessage,
      kernelId: 'kernel-preview',
      normalizePreviewProps: (props) => props,
      buildPreviewKey: (styleName, props) => `${styleName}:${props.version}`,
    }));

    act(() => {
      result.current.handleRequestPreview('Normal', { version: 1 }, { immediate: true });
    });
    act(() => {
      jest.advanceTimersByTime(0);
    });

    const previewRequest = sendMessage.mock.calls.find(([message]) => message.type === 'template_preview_style')[0];
    expect(previewRequest.request_id).toBeTruthy();

    act(() => {
      jest.advanceTimersByTime(45000);
    });

    expect(sendMessage).toHaveBeenCalledWith(expect.objectContaining({
      type: 'template_preview_cancel',
      request_id: previewRequest.request_id,
    }));

    sendMessage.mockClear();

    act(() => {
      result.current.handleRequestPreview('Normal', { version: 2 }, { immediate: true });
    });
    act(() => {
      jest.advanceTimersByTime(0);
    });

    const secondPreviewRequest = sendMessage.mock.calls.find(([message]) => message.type === 'template_preview_style')[0];
    unmount();

    expect(sendMessage).toHaveBeenCalledWith(expect.objectContaining({
      type: 'template_preview_cancel',
      request_id: secondPreviewRequest.request_id,
    }));
  });

  it('marks explicit native Word style preview requests', () => {
    const sendMessage = jest.fn();
    const { result } = renderHook(() => useStylePreviewPipeline({
      sendMessage,
      kernelId: 'kernel-preview',
      normalizePreviewProps: (props) => props,
      buildPreviewKey: (styleName, props) => `${styleName}:${props.version}`,
    }));

    act(() => {
      result.current.handleRequestPreview('Normal', { version: 1 }, {
        immediate: true,
        force: true,
        previewEngine: 'word_native',
      });
    });
    act(() => {
      jest.advanceTimersByTime(0);
    });

    expect(sendMessage).toHaveBeenCalledWith(expect.objectContaining({
      type: 'template_preview_style',
      preview_engine: 'word_native',
      native_word_preview: true,
    }));
  });

  it('associates cached style previews with their preview key', () => {
    const sendMessage = jest.fn();
    const { result } = renderHook(() => useStylePreviewPipeline({
      sendMessage,
      kernelId: 'kernel-preview',
      normalizePreviewProps: (props) => props,
      buildPreviewKey: (styleName, props) => `${styleName}:${props.version}`,
    }));

    act(() => {
      result.current.cachePreview('Normal:1', 'cached-image');
      result.current.handleRequestPreview('Normal', { version: 1 }, { immediate: true });
    });

    expect(result.current.previewImage).toBe('cached-image');
    expect(result.current.previewImageKey).toBe('Normal:1');
    expect(sendMessage).not.toHaveBeenCalledWith(expect.objectContaining({
      type: 'template_preview_style',
    }));
  });

  it('cancels in-flight table previews when leaving direct mode', async () => {
    const sendMessage = jest.fn();
    const onStatusMessage = jest.fn();
    const initialProps = {
      kernelId: 'kernel-table',
      sendMessage,
      tableGridTab: 'direct',
      documentTables: [{ rows: 2, cols: 2 }],
      onStatusMessage,
    };

    const { rerender } = renderHook((props) => useTablePreviewQueue(props), {
      initialProps,
    });

    await waitFor(() => expect(
      sendMessage.mock.calls.some(([message]) => message.type === 'template_table_preview'),
    ).toBe(true));

    const previewRequest = sendMessage.mock.calls.find(([message]) => message.type === 'template_table_preview')[0];

    rerender({
      ...initialProps,
      tableGridTab: 'styles',
    });

    await waitFor(() => expect(
      sendMessage.mock.calls.some(([message]) => (
        message.type === 'template_preview_cancel' && message.request_id === previewRequest.request_id
      )),
    ).toBe(true));
  });

  it('allows explicit retry of a table preview after a transient error', async () => {
    const sendMessage = jest.fn();
    const onStatusMessage = jest.fn();
    const { result } = renderHook(() => useTablePreviewQueue({
      kernelId: 'kernel-table-retry',
      sendMessage,
      tableGridTab: 'direct',
      documentTables: [{ rows: 3, cols: 2 }],
      onStatusMessage,
    }));

    await waitFor(() => expect(
      sendMessage.mock.calls.some(([message]) => message.type === 'template_table_preview'),
    ).toBe(true));

    const firstPreviewRequest = sendMessage.mock.calls.find(([message]) => message.type === 'template_table_preview')[0];

    act(() => {
      result.current.handleTablePreviewMessage({
        type: 'template_table_preview_error',
        request_id: firstPreviewRequest.request_id,
        table_index: 0,
        error: 'fallo transitorio',
      });
    });

    act(() => {
      result.current.requestTablePreview(0, { force: true });
    });

    const previewMessages = sendMessage.mock.calls
      .map(([message]) => message)
      .filter((message) => message.type === 'template_table_preview');

    expect(previewMessages).toHaveLength(2);
    expect(previewMessages[1].request_id).not.toBe(firstPreviewRequest.request_id);
  });
});
