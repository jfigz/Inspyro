/**
 * MonacoEditor - Wrapper que integra el editor con LSP
 * 
 * Este módulo re-exporta MonacoEditorLSP como componente por defecto,
 * manteniendo compatibilidad con todos los imports existentes.
 */

import React from 'react';
import MonacoEditorLSP from './MonacoEditorLSP';

/**
 * Componente Monaco Editor con soporte LSP integrado.
 * 
 * Props:
 * - value: contenido del editor
 * - onChange: callback cuando cambia el contenido
 * - language: lenguaje (default: 'python')
 * - height: altura del editor
 * - minHeight: altura mínima
 * - lspEnabled: habilitar/deshabilitar LSP (default: true)
 */
const MonacoEditor = (props) => {
  return <MonacoEditorLSP {...props} />;
};

export default MonacoEditor;