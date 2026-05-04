import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import './NotificationCenter.css';

const Icons = {
  info: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10" />
      <line x1="12" y1="16" x2="12" y2="12" />
      <line x1="12" y1="8" x2="12.01" y2="8" />
    </svg>
  ),
  success: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
      <polyline points="22 4 12 14.01 9 11.01" />
    </svg>
  ),
  warning: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
      <line x1="12" y1="9" x2="12" y2="13" />
      <line x1="12" y1="17" x2="12.01" y2="17" />
    </svg>
  ),
  error: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10" />
      <line x1="15" y1="9" x2="9" y2="15" />
      <line x1="9" y1="9" x2="15" y2="15" />
    </svg>
  ),
  progress: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10" />
      <polyline points="12 6 12 12 16 14" />
    </svg>
  ),
  chevronDown: (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="6 9 12 15 18 9" />
    </svg>
  ),
  chevronUp: (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="18 15 12 9 6 15" />
    </svg>
  ),
  close: (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="18" y1="6" x2="6" y2="18" />
      <line x1="6" y1="6" x2="18" y2="18" />
    </svg>
  ),
  trash: (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="3 6 5 6 21 6" />
      <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
    </svg>
  ),
  bell: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
      <path d="M13.73 21a2 2 0 0 1-3.46 0" />
    </svg>
  ),
  expand: (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M15 3h6v6" />
      <path d="M9 21H3v-6" />
      <path d="M21 3l-7 7" />
      <path d="M3 21l7-7" />
    </svg>
  ),
};

const getRelativeTime = (date) => {
  const now = new Date();
  const diff = now - date;
  const seconds = Math.floor(diff / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);

  if (seconds < 10) return 'ahora';
  if (seconds < 60) return `hace ${seconds}s`;
  if (minutes < 60) return `hace ${minutes} min`;
  if (hours < 24) return `hace ${hours}h`;
  return date.toLocaleDateString();
};

const groupByTime = (notifications) => {
  const now = new Date();
  const groups = {
    now: [],
    recent: [],
    earlier: [],
  };

  notifications.forEach((notif) => {
    const diff = now - notif.timestamp;
    const minutes = Math.floor(diff / 60000);

    if (minutes < 2) {
      groups.now.push(notif);
    } else if (minutes < 30) {
      groups.recent.push(notif);
    } else {
      groups.earlier.push(notif);
    }
  });

  return groups;
};

const getDefaultTitle = (notifType) => {
  switch (notifType) {
    case 'success':
      return 'Operacion exitosa';
    case 'error':
      return 'Error';
    case 'warning':
      return 'Advertencia';
    case 'progress':
      return 'En progreso';
    default:
      return 'Informacion';
  }
};

const getNotificationTitle = (notification) => {
  const title = typeof notification?.title === 'string' ? notification.title.trim() : '';
  const message = typeof notification?.message === 'string' ? notification.message.trim() : '';
  if (title) return title;
  if (message) return message;
  return getDefaultTitle(notification?.type);
};

const getNotificationMessage = (notification) => {
  const message = typeof notification?.message === 'string' ? notification.message : '';
  if (message) return message;
  return getNotificationTitle(notification);
};

const hasOverflow = (element) => {
  if (!element) return false;
  return (
    element.scrollHeight > element.clientHeight + 1
    || element.scrollWidth > element.clientWidth + 1
  );
};

const clampNumber = (value, min, max) => Math.min(Math.max(value, min), max);

const calculateDropdownStyle = (anchorElement) => {
  if (typeof window === 'undefined' || !anchorElement) {
    return null;
  }

  const anchorRect = anchorElement.getBoundingClientRect();
  const viewportWidth = Math.max(document.documentElement?.clientWidth || 0, window.innerWidth || 0);
  const viewportHeight = Math.max(document.documentElement?.clientHeight || 0, window.innerHeight || 0);
  const margin = 12;
  const gap = 8;
  const maxWidth = Math.max(260, viewportWidth - (margin * 2));
  const width = Math.min(380, maxWidth);
  const minHeight = Math.min(220, Math.max(160, viewportHeight - (margin * 2)));
  const availableBelow = viewportHeight - anchorRect.bottom - gap - margin;
  const availableAbove = anchorRect.top - gap - margin;
  const openAbove = availableBelow < minHeight && availableAbove > availableBelow;
  const availableHeight = Math.max(
    160,
    Math.min(450, openAbove ? availableAbove : availableBelow)
  );
  const leftMax = Math.max(margin, viewportWidth - width - margin);
  const left = clampNumber(anchorRect.right - width, margin, leftMax);
  const top = openAbove
    ? clampNumber(anchorRect.top - gap - availableHeight, margin, viewportHeight - availableHeight - margin)
    : clampNumber(anchorRect.bottom + gap, margin, viewportHeight - availableHeight - margin);

  return {
    position: 'fixed',
    top: `${Math.round(top)}px`,
    left: `${Math.round(left)}px`,
    width: `${Math.round(width)}px`,
    maxHeight: `${Math.round(availableHeight)}px`,
  };
};

const trimString = (value) => (typeof value === 'string' && value.trim() ? value.trim() : null);

const resolveNavigationPayload = (notification) => {
  const target = notification?.target;
  if (target && typeof target === 'object') {
    const normalizedType = trimString(target.type);
    if (normalizedType) {
      switch (normalizedType) {
        case 'navigate_code':
          return {
            type: normalizedType,
            filePath: trimString(target.filePath),
            cellId: trimString(target.cellId),
            cellIndex: Number.isInteger(target.cellIndex) ? target.cellIndex : null,
            line: Number.isInteger(target.line) && target.line > 0 ? target.line : null,
            column: Number.isInteger(target.column) && target.column >= 0 ? target.column : null,
            symbol: trimString(target.symbol),
          };
        case 'open_resource':
          return {
            type: normalizedType,
            path: trimString(target.path),
          };
        case 'focus_document':
          return {
            type: normalizedType,
            sourcePath: trimString(target.sourcePath),
            surface: target.surface === 'home' ? 'home' : 'file',
          };
        case 'open_panel':
          return {
            type: normalizedType,
            panel: trimString(target.panel),
          };
        default:
          break;
      }
    }

    const normalizedKind = trimString(target.kind);
    if (normalizedKind) {
      return target;
    }
  }

  const filePath = trimString(notification?.filePath);
  const path = trimString(notification?.path);
  if (!filePath && !path) {
    return null;
  }

  const payload = {
    filePath,
    cellId: trimString(notification?.cellId),
    line: Number.isInteger(notification?.line) && notification.line > 0 ? notification.line : null,
    column: Number.isInteger(notification?.column) && notification.column >= 0 ? notification.column : null,
    symbol: trimString(notification?.symbol),
    focusView: trimString(notification?.focusView),
    sourceMode: trimString(notification?.sourceMode),
  };

  if (path) {
    payload.path = path;
  }

  return payload;
};

const NotificationCard = ({
  notification,
  isExpanded = false,
  onAction,
  onDismiss,
  onNavigate,
  onToggleExpand,
}) => {
  const {
    id,
    type,
    timestamp,
    progress,
    actions,
    dismissible = true,
  } = notification;
  const title = getNotificationTitle(notification);
  const message = getNotificationMessage(notification);
  const shouldRenderMessage = Boolean(message && message !== title);
  const titleRef = useRef(null);
  const messageRef = useRef(null);
  const [canExpand, setCanExpand] = useState(false);
  const navigationPayload = resolveNavigationPayload(notification);
  const hasNavigation = Boolean(navigationPayload);

  const measureOverflow = useCallback(() => {
    if (isExpanded) {
      return;
    }
    const titleOverflow = hasOverflow(titleRef.current);
    const messageOverflow = shouldRenderMessage ? hasOverflow(messageRef.current) : false;
    setCanExpand(titleOverflow || messageOverflow);
  }, [isExpanded, shouldRenderMessage]);

  useLayoutEffect(() => {
    measureOverflow();
  }, [measureOverflow, title, message]);

  useEffect(() => {
    if (isExpanded) {
      return undefined;
    }

    let frameId = 0;
    const scheduleMeasure = () => {
      if (frameId) {
        cancelAnimationFrame(frameId);
      }
      frameId = requestAnimationFrame(() => {
        frameId = 0;
        measureOverflow();
      });
    };

    if (typeof ResizeObserver === 'function') {
      const observer = new ResizeObserver(scheduleMeasure);
      if (titleRef.current) observer.observe(titleRef.current);
      if (messageRef.current) observer.observe(messageRef.current);
      scheduleMeasure();

      return () => {
        if (frameId) cancelAnimationFrame(frameId);
        observer.disconnect();
      };
    }

    window.addEventListener('resize', scheduleMeasure);
    scheduleMeasure();
    return () => {
      if (frameId) cancelAnimationFrame(frameId);
      window.removeEventListener('resize', scheduleMeasure);
    };
  }, [isExpanded, measureOverflow]);

  const handleNavigate = useCallback(() => {
    if (!hasNavigation) return;
    void Promise.resolve(onNavigate?.(navigationPayload, notification));
  }, [hasNavigation, navigationPayload, notification, onNavigate]);

  const handleNavigateKeyDown = useCallback((event) => {
    if (!hasNavigation) return;
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      handleNavigate();
    }
  }, [handleNavigate, hasNavigation]);

  const handleToggleExpand = useCallback((event) => {
    event.preventDefault();
    event.stopPropagation();
    onToggleExpand?.(id);
  }, [id, onToggleExpand]);

  return (
    <div
      className={[
        'notification-card',
        `notification-card--${type || 'info'}`,
        hasNavigation ? 'notification-card--navigable' : '',
      ].join(' ')}
      data-testid={`notification-card-${id}`}
    >
      <div className="notification-card__accent" />

      <div className="notification-card__icon">
        {Icons[type] || Icons.info}
      </div>

      <div
        className={[
          'notification-card__body',
          hasNavigation ? 'notification-card__body--navigable' : '',
        ].join(' ')}
        role={hasNavigation ? 'button' : undefined}
        tabIndex={hasNavigation ? 0 : undefined}
        onClick={handleNavigate}
        onKeyDown={handleNavigateKeyDown}
        aria-label={hasNavigation ? `Ir a la notificacion: ${title}` : undefined}
        data-testid={hasNavigation ? `notification-card-nav-${id}` : undefined}
      >
        <div className="notification-card__content">
          <div className="notification-card__header">
            <span
              className="notification-card__title"
              ref={titleRef}
              data-testid={`notification-card-title-${id}`}
            >
              {title}
            </span>
            <span className="notification-card__time">{getRelativeTime(timestamp)}</span>
          </div>

          {shouldRenderMessage && (
            <p
              className={[
                'notification-card__message',
                'notification-card__message--clamped',
                canExpand && !isExpanded ? 'notification-card__message--expandable' : '',
              ].join(' ')}
              ref={messageRef}
              data-testid={`notification-card-message-${id}`}
            >
              {message}
            </p>
          )}

          {type === 'progress' && progress !== undefined && (
            <div className="notification-card__progress">
              <div
                className="notification-card__progress-bar"
                style={{ width: `${progress}%` }}
              />
            </div>
          )}

          {isExpanded && (
            <div
              className="notification-card__expanded"
              data-testid={`notification-card-expanded-${id}`}
            >
              <p className="notification-card__expanded-title">{title}</p>
              <p className="notification-card__expanded-message">{message}</p>
            </div>
          )}
        </div>

        {(actions?.length > 0 || canExpand || hasNavigation) && (
          <div className="notification-card__footer">
            {actions && actions.length > 0 ? (
              <div className="notification-card__actions">
                {actions.map((action, index) => (
                  <button
                    key={`${id}_action_${index}`}
                    type="button"
                    className="notification-card__action"
                    onClick={(event) => onAction(id, action, event)}
                  >
                    {action.label}
                  </button>
                ))}
              </div>
            ) : (
              <div className="notification-card__actions" />
            )}

            <div className="notification-card__meta-actions">
              {hasNavigation && (
                <span className="notification-card__navigate-hint">
                  <span className="notification-card__navigate-icon">{Icons.expand}</span>
                  <span>Ir al origen</span>
                </span>
              )}

              {canExpand && (
                <button
                  type="button"
                  className="notification-card__expand-button"
                  onClick={handleToggleExpand}
                  aria-expanded={isExpanded}
                  data-testid={`notification-card-expand-button-${id}`}
                >
                  <span className="notification-card__expand-icon">{Icons.expand}</span>
                  <span>{isExpanded ? 'Ver menos' : 'Ver mas'}</span>
                </button>
              )}
            </div>
          </div>
        )}
      </div>

      {dismissible && (
        <button
          type="button"
          className="notification-card__close"
          onClick={(event) => onDismiss(id, event)}
          title="Descartar"
          aria-label="Descartar notificacion"
        >
          {Icons.close}
        </button>
      )}
    </div>
  );
};

const NotificationCenter = ({
  message,
  type = 'info',
  notifications: externalNotifications,
  onDismiss,
  onDismissAll,
  onAction,
  onNavigate,
}) => {
  const [internalNotifications, setInternalNotifications] = useState([]);
  const [expanded, setExpanded] = useState(false);
  const [hasNewNotification, setHasNewNotification] = useState(false);
  const [externalReadIds, setExternalReadIds] = useState(() => new Set());
  const [expandedNotificationId, setExpandedNotificationId] = useState(null);
  const [dropdownStyle, setDropdownStyle] = useState(null);
  const containerRef = useRef(null);
  const badgeRef = useRef(null);
  const dropdownRef = useRef(null);
  const scrollRef = useRef(null);

  const notifications = externalNotifications
    ? externalNotifications.map((notif) => ({
      ...notif,
      read: Boolean(notif.read || externalReadIds.has(notif.id)),
    }))
    : internalNotifications;

  useEffect(() => {
    if (!message || externalNotifications) {
      return undefined;
    }

    const newNotification = {
      id: Date.now(),
      type,
      title: getDefaultTitle(type),
      message,
      timestamp: new Date(),
      read: false,
      dismissible: true,
      target: null,
    };

    setInternalNotifications((prev) => [...prev, newNotification]);
    setHasNewNotification(true);
    const timeoutId = window.setTimeout(() => setHasNewNotification(false), 3000);
    return () => window.clearTimeout(timeoutId);
  }, [externalNotifications, message, type]);

  useEffect(() => {
    if (scrollRef.current && expanded) {
      scrollRef.current.scrollTop = 0;
    }
  }, [expanded, notifications.length]);

  useEffect(() => {
    if (expandedNotificationId === null) return;
    if (!notifications.some((item) => item.id === expandedNotificationId)) {
      setExpandedNotificationId(null);
    }
  }, [expandedNotificationId, notifications]);

  const updateDropdownPosition = useCallback(() => {
    if (!expanded || !badgeRef.current) {
      return;
    }
    setDropdownStyle(calculateDropdownStyle(badgeRef.current));
  }, [expanded]);

  useLayoutEffect(() => {
    updateDropdownPosition();
  }, [notifications.length, updateDropdownPosition]);

  useEffect(() => {
    if (!expanded) {
      setDropdownStyle(null);
      return undefined;
    }

    updateDropdownPosition();
    const handleViewportChange = () => updateDropdownPosition();
    window.addEventListener('resize', handleViewportChange);
    window.addEventListener('scroll', handleViewportChange, true);
    return () => {
      window.removeEventListener('resize', handleViewportChange);
      window.removeEventListener('scroll', handleViewportChange, true);
    };
  }, [expanded, updateDropdownPosition]);

  useEffect(() => {
    const handleClickOutside = (event) => {
      const target = event.target;
      const clickedTrigger = containerRef.current?.contains(target);
      const clickedDropdown = dropdownRef.current?.contains(target);
      if (!clickedTrigger && !clickedDropdown) {
        setExpanded(false);
        setExpandedNotificationId(null);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const markAllAsRead = useCallback(() => {
    if (externalNotifications) {
      setExternalReadIds((prev) => {
        const next = new Set(prev);
        externalNotifications.forEach((notif) => next.add(notif.id));
        return next;
      });
      return;
    }

    setInternalNotifications((prev) => prev.map((item) => ({ ...item, read: true })));
  }, [externalNotifications]);

  const handleToggleDropdown = useCallback(() => {
    setExpanded((prev) => {
      const next = !prev;
      if (next) {
        markAllAsRead();
      } else {
        setExpandedNotificationId(null);
      }
      return next;
    });
  }, [markAllAsRead]);

  const handleDismiss = useCallback((id, event) => {
    event?.stopPropagation();
    if (expandedNotificationId === id) {
      setExpandedNotificationId(null);
    }

    if (onDismiss) {
      onDismiss(id);
      return;
    }

    setInternalNotifications((prev) => prev.filter((item) => item.id !== id));
  }, [expandedNotificationId, onDismiss]);

  const handleDismissAll = useCallback((event) => {
    event?.stopPropagation();
    setExpandedNotificationId(null);

    if (onDismissAll) {
      onDismissAll();
    } else {
      setInternalNotifications([]);
    }

    setExpanded(false);
  }, [onDismissAll]);

  const handleAction = useCallback((notificationId, action, event) => {
    event?.stopPropagation();
    if (onAction) {
      onAction(notificationId, action);
      return;
    }
    if (action?.onClick) {
      action.onClick();
    }
  }, [onAction]);

  const handleNavigate = useCallback(async (navigationPayload, notification) => {
    if (!navigationPayload || typeof onNavigate !== 'function') {
      return false;
    }

    const didNavigate = Boolean(await onNavigate(navigationPayload, notification));
    if (didNavigate) {
      setExpanded(false);
      setExpandedNotificationId(null);
    }
    return didNavigate;
  }, [onNavigate]);

  const handleToggleInlineExpand = useCallback((id) => {
    setExpandedNotificationId((prev) => (prev === id ? null : id));
  }, []);

  const unreadCount = notifications.filter((item) => !item.read).length;
  const lastNotification = notifications.length > 0
    ? notifications[notifications.length - 1]
    : null;
  const groupedNotifications = groupByTime([...notifications].reverse());

  if (notifications.length === 0) {
    return (
      <div className="notification-center notification-center--empty">
        <span className="notification-center__bell">{Icons.bell}</span>
      </div>
    );
  }

  const dropdown = expanded ? createPortal(
    <div
      className="notification-dropdown"
      data-testid="notification-dropdown"
      ref={dropdownRef}
      style={dropdownStyle || undefined}
    >
      <div className="notification-dropdown__header">
        <div className="notification-dropdown__title">
          <span className="notification-dropdown__bell">{Icons.bell}</span>
          <span>Notificaciones</span>
          <span className="notification-dropdown__count">({notifications.length})</span>
        </div>
        <button
          type="button"
          className="notification-dropdown__clear"
          onClick={handleDismissAll}
          title="Limpiar todo"
          aria-label="Limpiar todo"
        >
          {Icons.trash}
          <span>Limpiar</span>
        </button>
      </div>

      <div className="notification-list scroll-surface" ref={scrollRef}>
        {groupedNotifications.now.length > 0 && (
          <div className="notification-group">
            <div className="notification-group__label">Ahora</div>
            {groupedNotifications.now.map((notif) => (
              <NotificationCard
                key={notif.id}
                notification={notif}
                isExpanded={expandedNotificationId === notif.id}
                onAction={handleAction}
                onDismiss={handleDismiss}
                onNavigate={handleNavigate}
                onToggleExpand={handleToggleInlineExpand}
              />
            ))}
          </div>
        )}

        {groupedNotifications.recent.length > 0 && (
          <div className="notification-group">
            <div className="notification-group__label">Hace un momento</div>
            {groupedNotifications.recent.map((notif) => (
              <NotificationCard
                key={notif.id}
                notification={notif}
                isExpanded={expandedNotificationId === notif.id}
                onAction={handleAction}
                onDismiss={handleDismiss}
                onNavigate={handleNavigate}
                onToggleExpand={handleToggleInlineExpand}
              />
            ))}
          </div>
        )}

        {groupedNotifications.earlier.length > 0 && (
          <div className="notification-group">
            <div className="notification-group__label">Antes</div>
            {groupedNotifications.earlier.map((notif) => (
              <NotificationCard
                key={notif.id}
                notification={notif}
                isExpanded={expandedNotificationId === notif.id}
                onAction={handleAction}
                onDismiss={handleDismiss}
                onNavigate={handleNavigate}
                onToggleExpand={handleToggleInlineExpand}
              />
            ))}
          </div>
        )}
      </div>
    </div>,
    document.body
  ) : null;

  return (
    <div
      className={`notification-center ${expanded ? 'notification-center--expanded' : ''}`}
      ref={containerRef}
    >
      <button
        type="button"
        className={`notification-badge notification-badge--${lastNotification?.type || 'info'} ${hasNewNotification ? 'notification-badge--pulse' : ''}`}
        onClick={handleToggleDropdown}
        title="Centro de notificaciones"
        aria-label="Centro de notificaciones"
        ref={badgeRef}
      >
        <span className="notification-badge__icon">
          {Icons[lastNotification?.type] || Icons.info}
        </span>
        <span className="notification-badge__text">
          {lastNotification?.message?.length > 35
            ? `${lastNotification.message.substring(0, 35)}...`
            : lastNotification?.message}
        </span>
        {unreadCount > 0 && (
          <span className="notification-badge__counter">{unreadCount}</span>
        )}
        <span className="notification-badge__chevron">
          {expanded ? Icons.chevronUp : Icons.chevronDown}
        </span>
      </button>

      {dropdown}
    </div>
  );
};

export default NotificationCenter;
