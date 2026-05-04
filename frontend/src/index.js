import React from 'react';
import ReactDOM from 'react-dom/client';
import '@fontsource/source-code-pro/400.css';
import '@fontsource/source-code-pro/500.css';
import '@fontsource/source-code-pro/700.css';
import '@fontsource/source-sans-3/400.css';
import '@fontsource/source-sans-3/500.css';
import '@fontsource/source-sans-3/700.css';
import './index.css';
import RendererRoot from './boot/RendererRoot';
import { installRendererErrorHandlers, reportRendererPhase } from './boot/rendererDesktopBridge';

installRendererErrorHandlers();
reportRendererPhase('renderer_bootstrap_ready', {
  phase: 'renderer_bootstrap_ready',
  href: window.location.href,
});

const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(
  <RendererRoot />
);
