/**
 * =============================================================================
 * StatusBar.js - CENTRO DE NOTIFICACIONES DE INSPYRO
 * =============================================================================
 * 
 * Este componente es el ÚNICO punto de entrada para mostrar mensajes,
 * alertas e información al usuario en la aplicación.
 * 
 * IMPORTANTE PARA FUTUROS DESARROLLOS:
 * ------------------------------------
 * Todos los mensajes que necesiten ser mostrados al usuario deben canalizarse
 * a través de este componente usando la prop `onStatusMessage` que se pasa
 * desde App.js a los componentes hijos.
 * 
 * Ejemplo de uso desde cualquier componente hijo:
 * ```javascript
 * // En el componente padre (App.js), se define:
 * const handleStatusMessage = (message, type) => {
 *   setStatusMessage(message);
 *   setStatusType(type);
 * };
 * 
 * // Se pasa como prop:
 * <MiComponente onStatusMessage={handleStatusMessage} />
 * 
 * // En el componente hijo:
 * onStatusMessage?.('Operación completada', 'success');
 * onStatusMessage?.('Error al guardar', 'error');
 * onStatusMessage?.('Procesando...', 'info');
 * onStatusMessage?.('Conexión inestable', 'warning');
 * ```
 * 
 * Tipos de mensaje disponibles:
 * - 'info'    : Información general (azul)
 * - 'success' : Operación exitosa (verde)
 * - 'warning' : Advertencia (amarillo)
 * - 'error'   : Error (rojo, no desaparece automáticamente)
 * 
 * Características:
 * - Historial persistente (los mensajes no desaparecen)
 * - Vista expandible con scroll para ver todos los mensajes
 * - Iconos SVG inline para evitar problemas de encoding
 * - Click para expandir/colapsar
 * 
 * @module StatusBar
 * @version 2.0.0
 */

import React, { useState, useEffect, useRef } from 'react';
import './StatusBar.css';

// SVG Icons inline para evitar problemas de encoding
const Icons = {
    info: (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="10"></circle>
            <line x1="12" y1="16" x2="12" y2="12"></line>
            <line x1="12" y1="8" x2="12.01" y2="8"></line>
        </svg>
    ),
    success: (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path>
            <polyline points="22 4 12 14.01 9 11.01"></polyline>
        </svg>
    ),
    warning: (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path>
            <line x1="12" y1="9" x2="12" y2="13"></line>
            <line x1="12" y1="17" x2="12.01" y2="17"></line>
        </svg>
    ),
    error: (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="10"></circle>
            <line x1="15" y1="9" x2="9" y2="15"></line>
            <line x1="9" y1="9" x2="15" y2="15"></line>
        </svg>
    ),
    chevronDown: (
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="6 9 12 15 18 9"></polyline>
        </svg>
    ),
    trash: (
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="3 6 5 6 21 6" />
            <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
        </svg>
    )
};

const StatusBar = ({ message, type = 'info' }) => {
    const [history, setHistory] = useState([]);
    const [expanded, setExpanded] = useState(false);
    const scrollRef = useRef(null);
    const containerRef = useRef(null);

    // Agregar nuevo mensaje al historial
    useEffect(() => {
        if (message) {
            const newItem = {
                id: Date.now(),
                text: message,
                type: type,
                timestamp: new Date().toLocaleTimeString()
            };
            setHistory(prev => [...prev, newItem]);
        }
    }, [message, type]);

    // Auto-scroll al fondo cuando llega un mensaje
    useEffect(() => {
        if (scrollRef.current) {
            scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
        }
    }, [history, expanded]);

    // Cerrar al hacer clic fuera
    useEffect(() => {
        const handleClickOutside = (event) => {
            if (containerRef.current && !containerRef.current.contains(event.target)) {
                setExpanded(false);
            }
        };
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, []);

    const handleClear = (e) => {
        e.stopPropagation();
        setHistory([]);
    };

    const toggleExpand = () => {
        setExpanded(!expanded);
    };

    const lastMessage = history.length > 0 ? history[history.length - 1] : null;

    if (history.length === 0) {
        return <div className="status-bar status-bar-empty" />;
    }

    return (
        <div
            className={`status-bar-container ${expanded ? 'expanded' : ''}`}
            ref={containerRef}
            onClick={toggleExpand}
            title="Click para ver historial"
        >
            <div className="status-bar-content scroll-surface" ref={scrollRef}>
                {/* Si está expandido mostramos todo el historial */}
                {expanded ? (
                    <div className="status-history-list">
                        <div className="status-history-header">
                            <span className="history-title">Notificaciones ({history.length})</span>
                            <button className="clear-history-btn" onClick={handleClear} title="Limpiar">
                                {Icons.trash}
                            </button>
                        </div>
                        {history.map((item) => (
                            <div key={item.id} className={`status-item item-${item.type}`}>
                                <span className="item-time">[{item.timestamp}]</span>
                                <span className="item-icon">{Icons[item.type] || Icons.info}</span>
                                <span className="item-text">{item.text}</span>
                            </div>
                        ))}
                    </div>
                ) : (
                    /* Vista compacta: solo el último mensaje */
                    <div className={`status-item-compact item-${lastMessage?.type || 'info'}`}>
                        <span className="item-icon">{Icons[lastMessage?.type || 'info']}</span>
                        <span className="item-text">{lastMessage?.text}</span>
                        <span className="expand-hint">{Icons.chevronDown}</span>
                    </div>
                )}
            </div>
        </div>
    );
};

export default StatusBar;
