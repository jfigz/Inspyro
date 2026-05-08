import { renderHook } from '@testing-library/react';
import useTemplateMessageHandler from './useTemplateMessageHandler';
import { WS_MESSAGE_TYPES as WS_MSG } from '../contracts/wsMessageTypes.generated';

describe('useTemplateMessageHandler', () => {
  it('hydrates template info on document defaults updates', () => {
    const setTemplateInfo = jest.fn();
    const setTemplateBlob = jest.fn();
    const onStatusMessage = jest.fn();
    const template = {
      document_defaults: {
        font: { font_name: 'Century Gothic' },
      },
    };

    renderHook(() => useTemplateMessageHandler({
      lastMessage: {
        type: WS_MSG.TEMPLATE_DOCUMENT_DEFAULTS_UPDATED,
        template,
      },
      setTemplateInfo,
      setTemplateBlob,
      onStatusMessage,
    }));

    expect(setTemplateInfo).toHaveBeenCalledWith(template);
    expect(onStatusMessage).toHaveBeenCalledWith(
      'Configuración global del documento actualizada',
      'success'
    );
  });

  it('routes template updates only to the owning notebook session', () => {
    const updateNotebookSession = jest.fn();
    const onStatusMessage = jest.fn();
    const template = {
      document_defaults: {
        font: { font_name: 'Century Gothic' },
      },
    };

    renderHook(() => useTemplateMessageHandler({
      messageQueue: [
        {
          id: 1,
          path: 'C:\\workspace\\a.ipynb',
          message: {
            type: WS_MSG.TEMPLATE_DOCUMENT_DEFAULTS_UPDATED,
            kernel_id: 'kernel-a',
            template,
          },
        },
      ],
      resolveMessagePath: () => 'C:\\workspace\\a.ipynb',
      updateNotebookSession,
      activeNotebookPath: 'C:\\workspace\\b.ipynb',
      onStatusMessage,
    }));

    expect(updateNotebookSession).toHaveBeenCalledWith(
      'C:\\workspace\\a.ipynb',
      expect.any(Function),
    );
    expect(onStatusMessage).not.toHaveBeenCalled();
  });

  it('marks token attaches as attached instead of clearing the reattach latch', () => {
    const updateNotebookSession = jest.fn();
    const template = { styles: [] };

    renderHook(() => useTemplateMessageHandler({
      messageQueue: [
        {
          id: 1,
          path: 'C:\\workspace\\a.ipynb',
          message: {
            type: WS_MSG.TEMPLATE_UPLOADED,
            kernel_id: 'kernel-a',
            request_id: 'tpl_attach_1',
            template_token: 'token-a',
            template,
          },
        },
      ],
      resolveMessagePath: () => 'C:\\workspace\\a.ipynb',
      updateNotebookSession,
      activeNotebookPath: 'C:\\workspace\\a.ipynb',
      onStatusMessage: jest.fn(),
    }));

    const updater = updateNotebookSession.mock.calls[0][1];
    const next = updater({
      templateBlob: { templateToken: 'token-a' },
      lastTemplateAttach: { kernelId: 'kernel-a', attachKey: 'token:token-a', status: 'pending' },
    });

    expect(next.lastTemplateAttach).toEqual(expect.objectContaining({
      kernelId: 'kernel-a',
      attachKey: 'token:token-a',
      status: 'attached',
      requestId: 'tpl_attach_1',
    }));
  });

  it('hydrates template payloads from table style mutations', () => {
    const updateNotebookSession = jest.fn();
    const template = { styles: [{ name: 'Table Grid' }] };

    renderHook(() => useTemplateMessageHandler({
      messageQueue: [
        {
          id: 1,
          path: 'C:\\workspace\\a.ipynb',
          message: {
            type: WS_MSG.TEMPLATE_FORMAT_APPLIED,
            kernel_id: 'kernel-a',
            request_id: 'tpl_apply_1',
            template,
          },
        },
      ],
      resolveMessagePath: () => 'C:\\workspace\\a.ipynb',
      updateNotebookSession,
      activeNotebookPath: 'C:\\workspace\\a.ipynb',
      onStatusMessage: jest.fn(),
    }));

    const updater = updateNotebookSession.mock.calls[0][1];
    expect(updater({ templateInfo: null }).templateInfo).toBe(template);
  });

  it('hydrates template_binding from authoritative template mutation ACKs', () => {
    const updateNotebookSession = jest.fn();
    const template = { styles: [{ name: 'Normal' }] };
    const templateBinding = {
      status: 'updated',
      path: 'report.inspyro-template.json',
      template_json_path: 'C:\\workspace\\report.inspyro-template.json',
    };

    renderHook(() => useTemplateMessageHandler({
      messageQueue: [
        {
          id: 1,
          path: 'C:\\workspace\\report.ipynb',
          message: {
            type: WS_MSG.TEMPLATE_STYLE_UPDATED,
            kernel_id: 'kernel-a',
            style_name: 'Normal',
            template,
            template_binding: templateBinding,
          },
        },
      ],
      resolveMessagePath: () => 'C:\\workspace\\report.ipynb',
      updateNotebookSession,
      activeNotebookPath: 'C:\\workspace\\report.ipynb',
      onStatusMessage: jest.fn(),
    }));

    const updater = updateNotebookSession.mock.calls[0][1];
    const next = updater({ templateInfo: null, templateBinding: null });
    expect(next.templateInfo).toBe(template);
    expect(next.templateBinding).toBe(templateBinding);
  });

  it('clears pending template attach state on correlated template errors', () => {
    const updateNotebookSession = jest.fn();

    renderHook(() => useTemplateMessageHandler({
      messageQueue: [
        {
          id: 1,
          path: 'C:\\workspace\\a.ipynb',
          message: {
            type: WS_MSG.TEMPLATE_ERROR,
            kernel_id: 'kernel-a',
            request_id: 'tpl_upload_1',
            error: 'attach failed',
          },
        },
      ],
      resolveMessagePath: () => 'C:\\workspace\\a.ipynb',
      updateNotebookSession,
      activeNotebookPath: 'C:\\workspace\\a.ipynb',
      onStatusMessage: jest.fn(),
    }));

    const updater = updateNotebookSession.mock.calls[0][1];
    const next = updater({
      lastTemplateAttach: {
        kernelId: 'kernel-a',
        attachKey: 'token:token-a',
        status: 'pending',
        requestId: 'tpl_upload_1',
      },
    });

    expect(next.lastTemplateAttach).toBeNull();
  });
});
