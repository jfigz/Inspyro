/**
 * Icons.js - Iconos SVG monotono para Inspyro
 * 
 * Todos los iconos son paths SVG de un solo color (currentColor)
 * para que se adapten al tema automáticamente.
 */

import React from 'react';

const iconProps = {
    width: 16,
    height: 16,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 2,
    strokeLinecap: "round",
    strokeLinejoin: "round"
};

// Agregar código
export const IconCode = (props) => (
    <svg {...iconProps} {...props}>
        <polyline points="16 18 22 12 16 6" />
        <polyline points="8 6 2 12 8 18" />
    </svg>
);

// Agregar texto/markdown
export const IconText = (props) => (
    <svg {...iconProps} {...props}>
        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
        <polyline points="14 2 14 8 20 8" />
        <line x1="16" y1="13" x2="8" y2="13" />
        <line x1="16" y1="17" x2="8" y2="17" />
        <polyline points="10 9 9 9 8 9" />
    </svg>
);

// Ejecutar todo
export const IconPlayAll = (props) => (
    <svg {...iconProps} {...props}>
        <polygon points="5 3 19 12 5 21 5 3" />
        <line x1="19" y1="5" x2="19" y2="19" />
    </svg>
);

// Detener/Interrumpir
export const IconStop = (props) => (
    <svg {...iconProps} {...props}>
        <rect x="6" y="6" width="12" height="12" rx="1" />
    </svg>
);

// Reset/Reiniciar
export const IconRefresh = (props) => (
    <svg {...iconProps} {...props}>
        <polyline points="23 4 23 10 17 10" />
        <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
    </svg>
);

export const IconZoomIn = (props) => (
    <svg {...iconProps} {...props}>
        <circle cx="11" cy="11" r="6" />
        <line x1="11" y1="8" x2="11" y2="14" />
        <line x1="8" y1="11" x2="14" y2="11" />
        <line x1="16" y1="16" x2="21" y2="21" />
    </svg>
);

export const IconZoomOut = (props) => (
    <svg {...iconProps} {...props}>
        <circle cx="11" cy="11" r="6" />
        <line x1="8" y1="11" x2="14" y2="11" />
        <line x1="16" y1="16" x2="21" y2="21" />
    </svg>
);

export const IconFitWidth = (props) => (
    <svg {...iconProps} {...props}>
        <rect x="4" y="6" width="16" height="12" rx="2" />
        <line x1="8" y1="12" x2="16" y2="12" />
        <polyline points="10 10 8 12 10 14" />
        <polyline points="14 10 16 12 14 14" />
    </svg>
);

export const IconOutline = (props) => (
    <svg {...iconProps} {...props}>
        <line x1="9" y1="7" x2="19" y2="7" />
        <line x1="9" y1="12" x2="19" y2="12" />
        <line x1="9" y1="17" x2="19" y2="17" />
        <circle cx="5" cy="7" r="1" />
        <circle cx="5" cy="12" r="1" />
        <circle cx="5" cy="17" r="1" />
    </svg>
);

export const IconSource = (props) => (
    <svg {...iconProps} {...props}>
        <polyline points="9 18 3 12 9 6" />
        <polyline points="15 6 21 12 15 18" />
        <line x1="13" y1="5" x2="11" y2="19" />
    </svg>
);

export const IconQuality = (props) => (
    <svg {...iconProps} {...props}>
        <path d="M12 3l7 3v5c0 4.4-2.8 8.3-7 10-4.2-1.7-7-5.6-7-10V6l7-3z" />
        <polyline points="9 12 11 14 15 10" />
    </svg>
);

export const IconKebab = (props) => (
    <svg {...iconProps} {...props}>
        <circle cx="12" cy="5" r="1.5" fill="currentColor" stroke="none" />
        <circle cx="12" cy="12" r="1.5" fill="currentColor" stroke="none" />
        <circle cx="12" cy="19" r="1.5" fill="currentColor" stroke="none" />
    </svg>
);

export const IconDownload = (props) => (
    <svg {...iconProps} {...props}>
        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
        <polyline points="7 10 12 15 17 10" />
        <line x1="12" y1="15" x2="12" y2="3" />
    </svg>
);

export const IconFolderOpen = (props) => (
    <svg {...iconProps} {...props}>
        <path d="M3 7a2 2 0 0 1 2-2h5l2 2h7a2 2 0 0 1 2 2v1" />
        <path d="M3 10h18l-2 9a2 2 0 0 1-2 1H7a2 2 0 0 1-2-1l-2-9z" />
    </svg>
);

export const IconX = (props) => (
    <svg {...iconProps} {...props}>
        <line x1="18" y1="6" x2="6" y2="18" />
        <line x1="6" y1="6" x2="18" y2="18" />
    </svg>
);

export const IconTable = (props) => (
    <svg {...iconProps} {...props}>
        <rect x="3" y="4" width="18" height="16" rx="2" />
        <line x1="3" y1="10" x2="21" y2="10" />
        <line x1="9" y1="4" x2="9" y2="20" />
        <line x1="15" y1="4" x2="15" y2="20" />
    </svg>
);

export const IconEye = (props) => (
    <svg {...iconProps} {...props}>
        <path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z" />
        <circle cx="12" cy="12" r="3" />
    </svg>
);

// Guardar
export const IconSave = (props) => (
    <svg {...iconProps} {...props}>
        <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z" />
        <polyline points="17 21 17 13 7 13 7 21" />
        <polyline points="7 3 7 8 15 8" />
    </svg>
);

// Documento/DOCX
export const IconDocument = (props) => (
    <svg {...iconProps} {...props}>
        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
        <polyline points="14 2 14 8 20 8" />
    </svg>
);

// Word/DOCX - Documento con líneas de texto
export const IconDocx = (props) => (
    <svg {...iconProps} {...props}>
        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
        <polyline points="14 2 14 8 20 8" />
        <line x1="8" y1="13" x2="16" y2="13" />
        <line x1="8" y1="17" x2="14" y2="17" />
    </svg>
);

export const IconPdf = (props) => (
    <svg {...iconProps} {...props}>
        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
        <polyline points="14 2 14 8 20 8" />
        <path d="M8 10h3" />
        <path d="M8 14h8" />
        <path d="M8 18h6" />
    </svg>
);

export const IconHistory = (props) => (
    <svg {...iconProps} {...props}>
        <path d="M3 12a9 9 0 1 0 3-6.7" />
        <polyline points="3 4 3 9 8 9" />
        <path d="M12 7v5l3 2" />
    </svg>
);

export const IconTemplate = (props) => (
    <svg {...iconProps} {...props}>
        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2V8z" />
        <polyline points="14 2 14 8 20 8" />
        <path d="M18 11l.7 1.8L20.5 13l-1.8.7L18 15.5l-.7-1.8L15.5 13l1.8-.2z" />
        <path d="M8 12h4" />
        <path d="M8 16h4" />
    </svg>
);

// Configuración/Settings
export const IconSettings = (props) => (
    <svg {...iconProps} {...props}>
        <circle cx="12" cy="12" r="3" />
        <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </svg>
);

// Cargar/Upload
export const IconUpload = (props) => (
    <svg {...iconProps} {...props}>
        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
        <polyline points="17 8 12 3 7 8" />
        <line x1="12" y1="3" x2="12" y2="15" />
    </svg>
);

// Apagar/Power off
export const IconPower = (props) => (
    <svg {...iconProps} {...props}>
        <path d="M18.36 6.64a9 9 0 1 1-12.73 0" />
        <line x1="12" y1="2" x2="12" y2="12" />
    </svg>
);

// Plus/Agregar
export const IconPlus = (props) => (
    <svg {...iconProps} {...props}>
        <line x1="12" y1="5" x2="12" y2="19" />
        <line x1="5" y1="12" x2="19" y2="12" />
    </svg>
);

// Kernel/Terminal
export const IconTerminal = (props) => (
    <svg {...iconProps} {...props}>
        <polyline points="4 17 10 11 4 5" />
        <line x1="12" y1="19" x2="20" y2="19" />
    </svg>
);

// Mover arriba
export const IconChevronUp = (props) => (
    <svg {...iconProps} {...props}>
        <polyline points="18 15 12 9 6 15" />
    </svg>
);

// Mover abajo
export const IconChevronDown = (props) => (
    <svg {...iconProps} {...props}>
        <polyline points="6 9 12 15 18 9" />
    </svg>
);

// Eliminar/Trash
export const IconTrash = (props) => (
    <svg {...iconProps} {...props}>
        <polyline points="3 6 5 6 21 6" />
        <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
    </svg>
);

// Ejecutar celda
export const IconPlay = (props) => (
    <svg {...iconProps} {...props}>
        <polygon points="5 3 19 12 5 21 5 3" />
    </svg>
);

// Check/Tick para toggles activos
export const IconCheck = (props) => (
    <svg {...iconProps} {...props}>
        <polyline points="20 6 9 17 4 12" />
    </svg>
);

// Menú dropdown
export const IconMenu = (props) => (
    <svg {...iconProps} {...props}>
        <line x1="3" y1="12" x2="21" y2="12" />
        <line x1="3" y1="6" x2="21" y2="6" />
        <line x1="3" y1="18" x2="21" y2="18" />
    </svg>
);

// Chevron para dropdown
export const IconChevronRight = (props) => (
    <svg {...iconProps} {...props}>
        <polyline points="9 18 15 12 9 6" />
    </svg>
);

// Menos/Minimizar
export const IconMinus = (props) => (
    <svg {...iconProps} {...props}>
        <line x1="5" y1="12" x2="19" y2="12" />
    </svg>
);

// Cuadrado/Maximizar
export const IconSquare = (props) => (
    <svg {...iconProps} {...props}>
        <rect x="5" y="5" width="14" height="14" rx="1" />
    </svg>
);

// Grafo de dependencias (3 nodos conectados)
export const IconDependencies = (props) => (
    <svg {...iconProps} {...props}>
        <circle cx="6" cy="6" r="3" />
        <circle cx="18" cy="6" r="3" />
        <circle cx="12" cy="18" r="3" />
        <line x1="8" y1="8" x2="10" y2="16" />
        <line x1="16" y1="8" x2="14" y2="16" />
    </svg>
);

// Variables/datos numéricos
export const IconVariables = (props) => (
    <svg {...iconProps} {...props}>
        <rect x="3" y="5" width="18" height="14" rx="2" />
        <line x1="7" y1="9" x2="17" y2="9" />
        <line x1="7" y1="13" x2="13" y2="13" />
        <line x1="16" y1="13" x2="17" y2="13" />
    </svg>
);

// MCP/AI Connection (hub con 3 nodos radiantes)
export const IconMcp = (props) => (
    <svg {...iconProps} {...props}>
        <circle cx="12" cy="12" r="3" />
        <circle cx="5" cy="5" r="2" />
        <circle cx="19" cy="5" r="2" />
        <circle cx="12" cy="20" r="2" />
        <line x1="10" y1="10" x2="6.5" y2="6.5" />
        <line x1="14" y1="10" x2="17.5" y2="6.5" />
        <line x1="12" y1="15" x2="12" y2="18" />
    </svg>
);

const Icons = {
    IconCode,
    IconText,
    IconPlayAll,
    IconStop,
    IconRefresh,
    IconZoomIn,
    IconZoomOut,
    IconFitWidth,
    IconSave,
    IconDocument,
    IconDocx,
    IconPdf,
    IconHistory,
    IconTemplate,
    IconSettings,
    IconUpload,
    IconPower,
    IconPlus,
    IconTerminal,
    IconChevronUp,
    IconChevronDown,
    IconTrash,
    IconPlay,
    IconCheck,
    IconMenu,
    IconKebab,
    IconDownload,
    IconFolderOpen,
    IconX,
    IconTable,
    IconEye,
    IconChevronRight,
    IconMinus,
    IconSquare,
    IconDependencies,
    IconVariables,
    IconOutline,
    IconSource
};

export default Icons;
