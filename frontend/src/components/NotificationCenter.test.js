import React from 'react';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import NotificationCenter from './NotificationCenter';

const originalResizeObserver = global.ResizeObserver;

const buildNotification = (overrides = {}) => ({
  id: 'notif-1',
  type: 'info',
  title: 'Notificacion extensa',
  message: 'Mensaje '.repeat(40),
  timestamp: new Date('2026-04-06T12:00:00Z'),
  dismissible: true,
  ...overrides,
});

const openNotificationCenter = () => {
  fireEvent.click(screen.getByRole('button', { name: /centro de notificaciones/i }));
};

const triggerOverflowMeasurement = (notificationId, { titleOverflow = true, messageOverflow = true } = {}) => {
  const titleElement = screen.getByTestId(`notification-card-title-${notificationId}`);

  Object.defineProperty(titleElement, 'clientWidth', {
    configurable: true,
    get: () => 120,
  });
  Object.defineProperty(titleElement, 'scrollWidth', {
    configurable: true,
    get: () => (titleOverflow ? 240 : 120),
  });
  Object.defineProperty(titleElement, 'clientHeight', {
    configurable: true,
    get: () => 18,
  });
  Object.defineProperty(titleElement, 'scrollHeight', {
    configurable: true,
    get: () => 18,
  });

  const messageElement = screen.queryByTestId(`notification-card-message-${notificationId}`);
  if (messageElement) {
    Object.defineProperty(messageElement, 'clientHeight', {
      configurable: true,
      get: () => 64,
    });
    Object.defineProperty(messageElement, 'scrollHeight', {
      configurable: true,
      get: () => (messageOverflow ? 128 : 64),
    });
    Object.defineProperty(messageElement, 'clientWidth', {
      configurable: true,
      get: () => 260,
    });
    Object.defineProperty(messageElement, 'scrollWidth', {
      configurable: true,
      get: () => 260,
    });
  }

  act(() => {
    fireEvent(window, new Event('resize'));
  });
};

describe('NotificationCenter', () => {
  beforeEach(() => {
    global.ResizeObserver = undefined;
  });

  afterEach(() => {
    global.ResizeObserver = undefined;
  });

  afterAll(() => {
    global.ResizeObserver = originalResizeObserver;
  });

  it('shows a real "Ver mas" button only for truncated cards and expands inline', async () => {
    const notification = buildNotification({ id: 'long-card' });

    render(<NotificationCenter notifications={[notification]} />);

    openNotificationCenter();
    triggerOverflowMeasurement(notification.id);

    const expandButton = await screen.findByTestId(`notification-card-expand-button-${notification.id}`);
    expect(expandButton.textContent).toContain('Ver mas');
    expect(screen.queryByRole('dialog')).toBeNull();

    fireEvent.click(expandButton);

    const expandedRegion = await screen.findByTestId(`notification-card-expanded-${notification.id}`);
    expect(within(expandedRegion).getByText(notification.title)).not.toBeNull();
    expect(within(expandedRegion).getByText(notification.message.trim())).not.toBeNull();
    expect(expandButton.textContent).toContain('Ver menos');

    fireEvent.click(expandButton);

    await waitFor(() => {
      expect(screen.queryByTestId(`notification-card-expanded-${notification.id}`)).toBeNull();
    });
    expect(expandButton.textContent).toContain('Ver mas');
  });

  it('does not render "Ver mas" when the preview is not truncated', async () => {
    const notification = buildNotification({
      id: 'short-card',
      title: 'Corto',
      message: 'Mensaje corto',
    });

    render(<NotificationCenter notifications={[notification]} />);

    openNotificationCenter();
    triggerOverflowMeasurement(notification.id, { titleOverflow: false, messageOverflow: false });

    await waitFor(() => {
      expect(screen.queryByTestId(`notification-card-expand-button-${notification.id}`)).toBeNull();
    });
  });

  it('keeps navigation separate from expand, dismiss, and custom actions', async () => {
    const actionSpy = jest.fn();
    const navigateSpy = jest.fn();
    const onDismiss = jest.fn();
    const notification = buildNotification({
      id: 'actionable',
      type: 'warning',
      filePath: 'C:\\workspace\\report.ipynb',
      cellId: 'cell-42',
      line: 18,
      actions: [{ label: 'Reintentar', onClick: actionSpy }],
    });

    render(
      <NotificationCenter
        notifications={[notification]}
        onDismiss={onDismiss}
        onNavigate={navigateSpy}
      />
    );

    openNotificationCenter();
    triggerOverflowMeasurement(notification.id);

    const expandButton = await screen.findByTestId(`notification-card-expand-button-${notification.id}`);
    fireEvent.click(expandButton);
    expect(navigateSpy).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Reintentar' }));
    expect(actionSpy).toHaveBeenCalledTimes(1);
    expect(navigateSpy).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: /descartar notificacion/i }));
    expect(onDismiss).toHaveBeenCalledWith(notification.id);
    expect(navigateSpy).not.toHaveBeenCalled();

    fireEvent.click(screen.getByTestId(`notification-card-nav-${notification.id}`));
    expect(navigateSpy).toHaveBeenCalledWith(expect.objectContaining({
      filePath: 'C:\\workspace\\report.ipynb',
      cellId: 'cell-42',
      line: 18,
      column: null,
      symbol: null,
      focusView: null,
      sourceMode: null,
    }), expect.objectContaining({ id: notification.id }));
  });

  it('still clears notifications through the existing dismiss-all flow', () => {
    const onDismissAll = jest.fn();
    const notification = buildNotification({ id: 'dismiss-all' });

    render(
      <NotificationCenter
        notifications={[notification]}
        onDismissAll={onDismissAll}
      />
    );

    openNotificationCenter();
    fireEvent.click(screen.getByRole('button', { name: /limpiar todo/i }));

    expect(onDismissAll).toHaveBeenCalledTimes(1);
    expect(screen.queryByText('Notificaciones')).toBeNull();
  });

  it('renders the dropdown in a viewport-clamped portal instead of inside the titlebar flow', async () => {
    const notification = buildNotification({
      id: 'portal-card',
      title: 'PDF disponible',
      message: 'PDF: disponible (Word/LibreOffice)',
    });

    Object.defineProperty(window, 'innerWidth', {
      configurable: true,
      value: 1280,
    });
    Object.defineProperty(window, 'innerHeight', {
      configurable: true,
      value: 720,
    });

    render(<NotificationCenter notifications={[notification]} />);

    const badge = screen.getByRole('button', { name: /centro de notificaciones/i });
    Object.defineProperty(badge, 'getBoundingClientRect', {
      configurable: true,
      value: () => ({
        x: 1188,
        y: 14,
        left: 1188,
        top: 14,
        right: 1260,
        bottom: 48,
        width: 72,
        height: 34,
        toJSON: () => {},
      }),
    });

    fireEvent.click(badge);

    const dropdown = await screen.findByTestId('notification-dropdown');
    expect(dropdown.parentElement).toBe(document.body);

    await waitFor(() => {
      expect(dropdown.style.position).toBe('fixed');
      expect(dropdown.style.left).not.toBe('');
      expect(dropdown.style.width).not.toBe('');
    });

    const left = Number.parseFloat(dropdown.style.left);
    const width = Number.parseFloat(dropdown.style.width);
    const top = Number.parseFloat(dropdown.style.top);
    const maxHeight = Number.parseFloat(dropdown.style.maxHeight);
    expect(left).toBeGreaterThanOrEqual(12);
    expect(left + width).toBeLessThanOrEqual(1268);
    expect(top).toBeGreaterThanOrEqual(12);
    expect(top + maxHeight).toBeLessThanOrEqual(708);
  });

  it('keeps compatibility with legacy message/type props', async () => {
    render(
      <NotificationCenter
        message="Error de validacion en la plantilla de reporte"
        type="error"
      />
    );

    const badge = await screen.findByRole('button', { name: /centro de notificaciones/i });
    expect(badge).not.toBeNull();

    fireEvent.click(badge);

    expect(await screen.findByText('Error')).not.toBeNull();
    expect(screen.getAllByText(/Error de validacion en la plantilla/i).length).toBeGreaterThan(0);
  });
});
