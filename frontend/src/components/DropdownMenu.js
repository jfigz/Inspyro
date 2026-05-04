/**
 * DropdownMenu.js - Menu desplegable para opciones avanzadas
 */

import React, { useState, useRef, useEffect, useCallback, useLayoutEffect } from 'react';
import { createPortal } from 'react-dom';
import { IconSettings, IconCheck } from './Icons';
import './DropdownMenu.css';

const DropdownMenu = ({
    options = [],
    icon = <IconSettings />,
    title = 'Opciones',
    className = '',
    dataTestId = null,
    ariaLabel = null,
    triggerClassName = '',
    panelClassName = '',
}) => {
    const [isOpen, setIsOpen] = useState(false);
    const [panelStyle, setPanelStyle] = useState(null);
    const menuRef = useRef(null);
    const triggerRef = useRef(null);
    const panelRef = useRef(null);

    const updatePanelPosition = useCallback(() => {
        if (!triggerRef.current || !panelRef.current || typeof window === 'undefined') {
            return;
        }

        const triggerRect = triggerRef.current.getBoundingClientRect();
        const panelRect = panelRef.current.getBoundingClientRect();
        const viewportWidth = window.innerWidth || document.documentElement.clientWidth || 0;
        const viewportHeight = window.innerHeight || document.documentElement.clientHeight || 0;
        const margin = 8;

        let left = triggerRect.right - panelRect.width;
        if (left < margin) {
            left = margin;
        }
        if (viewportWidth > 0 && left + panelRect.width > viewportWidth - margin) {
            left = Math.max(margin, viewportWidth - margin - panelRect.width);
        }

        let top = triggerRect.bottom + 4;
        const fitsBelow = viewportHeight <= 0 || (top + panelRect.height <= viewportHeight - margin);
        if (!fitsBelow) {
            const topAbove = triggerRect.top - 4 - panelRect.height;
            if (topAbove >= margin) {
                top = topAbove;
            } else if (viewportHeight > 0) {
                top = Math.max(margin, viewportHeight - margin - panelRect.height);
            }
        }

        setPanelStyle({
            top: `${Math.round(top)}px`,
            left: `${Math.round(left)}px`,
        });
    }, []);

    useEffect(() => {
        const handleClickOutside = (event) => {
            const clickedInsideTrigger = menuRef.current?.contains(event.target);
            const clickedInsidePanel = panelRef.current?.contains(event.target);
            if (!clickedInsideTrigger && !clickedInsidePanel) {
                setIsOpen(false);
            }
        };

        if (isOpen) {
            document.addEventListener('mousedown', handleClickOutside);
        }

        return () => {
            document.removeEventListener('mousedown', handleClickOutside);
        };
    }, [isOpen]);

    useEffect(() => {
        const handleEscape = (event) => {
            if (event.key === 'Escape') {
                setIsOpen(false);
            }
        };

        if (isOpen) {
            document.addEventListener('keydown', handleEscape);
        }

        return () => {
            document.removeEventListener('keydown', handleEscape);
        };
    }, [isOpen]);

    useLayoutEffect(() => {
        if (!isOpen) {
            setPanelStyle(null);
            return undefined;
        }

        updatePanelPosition();

        const handleViewportChange = () => {
            updatePanelPosition();
        };

        window.addEventListener('resize', handleViewportChange);
        window.addEventListener('scroll', handleViewportChange, true);

        return () => {
            window.removeEventListener('resize', handleViewportChange);
            window.removeEventListener('scroll', handleViewportChange, true);
        };
    }, [isOpen, updatePanelPosition]);

    const panel = isOpen ? (
        <div
            className={`dropdown-panel ${panelClassName}`.trim()}
            ref={panelRef}
            style={panelStyle || undefined}
        >
            <div className="dropdown-header">{title}</div>
            <div className="dropdown-options">
                {options.map((option, index) => (
                    <React.Fragment key={option.id || index}>
                        {option.type === 'separator' ? (
                            <div className="dropdown-separator" />
                        ) : option.type === 'toggle' ? (
                            <button
                                className={`dropdown-option toggle ${option.checked ? 'checked' : ''}`}
                                onClick={() => {
                                    option.onChange?.(!option.checked);
                                    if (option.closeOnClick !== false) {
                                        setIsOpen(false);
                                    }
                                }}
                            >
                                <span className="option-icon">{option.icon}</span>
                                <span className="option-label">{option.label}</span>
                                <span className="toggle-indicator">
                                    {option.checked && <IconCheck />}
                                </span>
                            </button>
                        ) : (
                            <button
                                className={`dropdown-option ${option.disabled ? 'disabled' : ''}`}
                                onClick={() => {
                                    if (!option.disabled) {
                                        option.onClick?.();
                                        if (option.closeOnClick !== false) {
                                            setIsOpen(false);
                                        }
                                    }
                                }}
                                disabled={option.disabled}
                                data-testid={option.dataTestId || undefined}
                            >
                                <span className="option-icon">{option.icon}</span>
                                <span className="option-label">{option.label}</span>
                            </button>
                        )}
                    </React.Fragment>
                ))}
            </div>
        </div>
    ) : null;

    return (
        <div className={`dropdown-menu-container ${className}`} ref={menuRef}>
            <button
                className={`dropdown-trigger ${triggerClassName} ${isOpen ? 'active' : ''}`.trim()}
                onClick={() => setIsOpen((prev) => !prev)}
                title={title}
                aria-label={ariaLabel || title}
                aria-haspopup="true"
                aria-expanded={isOpen}
                data-testid={dataTestId || undefined}
                ref={triggerRef}
            >
                {icon}
            </button>

            {panel && typeof document !== 'undefined' ? createPortal(panel, document.body) : panel}
        </div>
    );
};

export default DropdownMenu;
