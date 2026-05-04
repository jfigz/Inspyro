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
});
