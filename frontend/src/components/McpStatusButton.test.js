import { fireEvent, render, screen } from '@testing-library/react';
import McpStatusButton from './McpStatusButton';

describe('McpStatusButton', () => {
  it('renders split controls and toggles mirror mode independently', () => {
    const onTogglePanel = jest.fn();
    const onToggleMirror = jest.fn();

    render(
      <McpStatusButton
        status="running"
        port={8100}
        runningCount={3}
        mirrorEnabled={false}
        onTogglePanel={onTogglePanel}
        onToggleMirror={onToggleMirror}
      />
    );

    fireEvent.click(screen.getByTestId('mcp-mirror-toggle'));
    expect(onToggleMirror).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByTestId('mcp-status-button'));
    expect(onTogglePanel).toHaveBeenCalledTimes(1);
    expect(screen.getByText('3')).toBeTruthy();
    expect(screen.getByText('Agentes')).toBeTruthy();
  });

  it('supports an enabled mirror toggle by default', () => {
    const onToggleMirror = jest.fn();

    render(
      <McpStatusButton
        status="running"
        port={8100}
        runningCount={0}
        mirrorEnabled={false}
        onTogglePanel={jest.fn()}
        onToggleMirror={onToggleMirror}
      />
    );

    const toggle = screen.getByTestId('mcp-mirror-toggle');
    expect(toggle.disabled).toBe(false);

    fireEvent.click(toggle);
    expect(onToggleMirror).toHaveBeenCalledTimes(1);
  });
});
