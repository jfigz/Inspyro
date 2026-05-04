const { ipcRenderer } = require('electron');

const applyBootStage = (payload = {}) => {
  const cardNode = document.getElementById('boot-card');
  const stageNode = document.getElementById('boot-stage');
  const detailNode = document.getElementById('boot-detail');
  const diagnosticNode = document.getElementById('boot-diagnostic');
  const actionsNode = document.getElementById('boot-actions');
  if (stageNode) {
    stageNode.textContent = payload.stage || 'Inicializando shell';
  }
  if (detailNode) {
    detailNode.textContent = payload.detail || 'Preparando Inspyro...';
  }
  if (cardNode) {
    cardNode.dataset.status = payload.status || 'loading';
  }
  if (diagnosticNode) {
    const diagnostic = typeof payload.diagnostic === 'string' ? payload.diagnostic.trim() : '';
    diagnosticNode.textContent = diagnostic;
    diagnosticNode.dataset.visible = diagnostic ? 'true' : 'false';
  }
  if (actionsNode) {
    const canRetry = Boolean(payload.actions?.canRetry);
    const canQuit = payload.actions?.canQuit !== false;
    actionsNode.dataset.visible = canRetry || canQuit ? 'true' : 'false';

    const retryButton = document.getElementById('boot-retry');
    const quitButton = document.getElementById('boot-quit');
    if (retryButton) {
      retryButton.disabled = !canRetry;
      retryButton.style.display = canRetry ? 'inline-flex' : 'none';
    }
    if (quitButton) {
      quitButton.disabled = !canQuit;
      quitButton.style.display = canQuit ? 'inline-flex' : 'none';
    }
  }
};

window.addEventListener('DOMContentLoaded', () => {
  ipcRenderer.on('desktop:boot-stage', (_event, payload) => {
    applyBootStage(payload);
  });

  document.getElementById('boot-retry')?.addEventListener('click', () => {
    ipcRenderer.send('desktop:splash-action', 'retry');
  });
  document.getElementById('boot-quit')?.addEventListener('click', () => {
    ipcRenderer.send('desktop:splash-action', 'quit');
  });
});
