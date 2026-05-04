const ADDIN_VERSION = "0.1.0";
const STORAGE_KEYS = {
  backendUrl: "inspyro.wordlive.backendUrl",
  documentPath: "inspyro.wordlive.documentPath",
  sessionId: "inspyro.wordlive.sessionId",
};

const state = {
  backendUrl: "http://localhost:8000",
  documentPath: "",
  sessionId: null,
  session: null,
  flushTimer: null,
  dirtyControlIds: new Set(),
  eventContexts: [],
  eventsAttached: false,
};

const els = {};

function $(id) {
  return document.getElementById(id);
}

function setStatus(message, tone = "info") {
  els.status.textContent = message;
  els.status.className = tone === "warn" ? "status warn" : "status";
}

function rememberState() {
  localStorage.setItem(STORAGE_KEYS.backendUrl, state.backendUrl);
  localStorage.setItem(STORAGE_KEYS.documentPath, state.documentPath);
  if (state.sessionId) {
    localStorage.setItem(STORAGE_KEYS.sessionId, state.sessionId);
  } else {
    localStorage.removeItem(STORAGE_KEYS.sessionId);
  }
}

function hydrateState() {
  state.backendUrl = localStorage.getItem(STORAGE_KEYS.backendUrl) || state.backendUrl;
  state.documentPath = localStorage.getItem(STORAGE_KEYS.documentPath) || "";
  state.sessionId = localStorage.getItem(STORAGE_KEYS.sessionId);
}

function apiUrl(path) {
  return new URL(path, state.backendUrl).toString();
}

async function apiRequest(path, options = {}) {
  const init = {
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
    ...options,
  };
  const response = await fetch(apiUrl(path), init);
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const detail = typeof payload.detail === "string" ? payload.detail : JSON.stringify(payload);
    throw new Error(detail || `HTTP ${response.status}`);
  }
  return payload;
}

function guessRegionKind(control, ooxml) {
  if (/<w:tbl[\s>]/i.test(ooxml)) return "table";
  if (/<m:oMath(?:Para)?[\s>]/i.test(ooxml)) return "math";
  if (/<w:(?:drawing|pict)[\s>]/i.test(ooxml)) return "image";
  const paragraphCount = (ooxml.match(/<w:p[\s>]/gi) || []).length;
  return paragraphCount > 1 ? "section-block" : "text";
}

function opsForKind(kind) {
  return kind === "text" ? ["update_text"] : ["replace_fragment"];
}

async function scanWordRegions(filterIds = null) {
  return Word.run(async (context) => {
    const controls = context.document.contentControls;
    controls.load("items/id,tag,title,text,cannotEdit");
    await context.sync();

    const selected = new Set(Array.isArray(filterIds) ? filterIds.map((id) => Number(id)) : []);
    const pending = [];
    for (const control of controls.items) {
      if (selected.size && !selected.has(Number(control.id))) {
        continue;
      }
      pending.push({
        control,
        ooxml: control.getOoxml(),
      });
    }

    await context.sync();

    return pending.map(({ control, ooxml }) => {
      const tag = String(control.tag || `cc-${control.id}`);
      const kind = guessRegionKind(control, ooxml.value || "");
      return {
        region_id: tag,
        kind,
        content_control_tag: tag,
        title: String(control.title || tag),
        allowed_ops: opsForKind(kind),
        supports_ooxml_replace: kind !== "text",
        locked: Boolean(control.cannotEdit),
        word_control_id: control.id,
        text_preview: control.text ? String(control.text).trim() : null,
        source: "word",
      };
    });
  });
}

async function getSelectedControlSnapshot() {
  return Word.run(async (context) => {
    const selection = context.document.getSelection();
    const controls = selection.getContentControls();
    controls.load("items/id,tag,title,text,cannotEdit");
    await context.sync();
    if (!controls.items.length) {
      return null;
    }
    const control = controls.items[0];
    const ooxml = control.getOoxml();
    await context.sync();
    const kind = guessRegionKind(control, ooxml.value || "");
    return {
      region_id: String(control.tag || `cc-${control.id}`),
      kind,
      content_control_tag: String(control.tag || `cc-${control.id}`),
      title: String(control.title || control.tag || `cc-${control.id}`),
      allowed_ops: opsForKind(kind),
      supports_ooxml_replace: kind !== "text",
      locked: Boolean(control.cannotEdit),
      word_control_id: control.id,
      text_preview: control.text ? String(control.text).trim() : null,
      ooxml: ooxml.value || "",
    };
  });
}

async function wrapSelectionAsTextControl() {
  const seedTag = els.regionTag.value.trim() || `region-${Date.now()}`;
  const seedTitle = els.regionTitle.value.trim() || seedTag;
  await Word.run(async (context) => {
    const selection = context.document.getSelection();
    const control = selection.insertContentControl();
    control.tag = seedTag;
    control.title = seedTitle;
    control.appearance = Word.ContentControlAppearance.boundingBox;
    await context.sync();
  });
  setStatus(`Wrapped selection as content control '${seedTag}'.`);
  await refreshRegions();
  await attachContentControlEvents();
}

async function openSession() {
  state.backendUrl = els.backendUrl.value.trim() || state.backendUrl;
  state.documentPath = els.documentPath.value.trim();
  rememberState();
  const regions = await scanWordRegions();
  const payload = await apiRequest("/api/word-live/session/open", {
    method: "POST",
    body: JSON.stringify({
      document_path: state.documentPath || null,
      addin_version: ADDIN_VERSION,
      host: "word-desktop",
      regions,
    }),
  });
  state.sessionId = payload.session_id;
  state.session = payload;
  rememberState();
  renderSession(payload);
  setStatus("Word Live session opened.");
  await attachContentControlEvents();
}

async function refreshSessionState() {
  if (!state.sessionId) {
    return;
  }
  const payload = await apiRequest(`/api/word-live/session/state?session_id=${encodeURIComponent(state.sessionId)}`);
  state.session = payload;
  renderSession(payload);
}

async function resyncSession() {
  if (!state.sessionId) {
    setStatus("Open a session first.", "warn");
    return;
  }
  state.backendUrl = els.backendUrl.value.trim() || state.backendUrl;
  state.documentPath = els.documentPath.value.trim();
  rememberState();
  const regions = await scanWordRegions();
  const payload = await apiRequest("/api/word-live/session/resync", {
    method: "POST",
    body: JSON.stringify({
      session_id: state.sessionId,
      document_path: state.documentPath || null,
      addin_version: ADDIN_VERSION,
      regions,
    }),
  });
  state.session = payload;
  renderSession(payload);
  setStatus("Session resynced.");
}

async function refreshRegions() {
  const regions = await scanWordRegions();
  renderRegions(regions);
  setStatus(`Scanned ${regions.length} content controls.`);
}

async function syncSelectedControl() {
  if (!state.sessionId) {
    setStatus("Open a session first.", "warn");
    return;
  }
  const control = await getSelectedControlSnapshot();
  if (!control) {
    setStatus("Select a content control first.", "warn");
    return;
  }
  const payload = await apiRequest("/api/word-live/session/resync", {
    method: "POST",
    body: JSON.stringify({
      session_id: state.sessionId,
      addin_version: ADDIN_VERSION,
      regions: [control],
    }),
  });
  state.session = payload;
  renderSession(payload);
  setStatus(`Synced '${control.region_id}'.`);
}

async function applyTextToSelected() {
  if (!state.sessionId) {
    setStatus("Open a session first.", "warn");
    return;
  }
  const text = els.textPayload.value;
  if (!text.trim()) {
    setStatus("Text payload is empty.", "warn");
    return;
  }
  const control = await getSelectedControlSnapshot();
  if (!control) {
    setStatus("Select a text content control first.", "warn");
    return;
  }
  if (control.kind !== "text") {
    setStatus("Selected control is not a text region.", "warn");
    return;
  }
  await Word.run(async (context) => {
    const selection = context.document.getSelection();
    const controls = selection.getContentControls();
    controls.load("items/id");
    await context.sync();
    if (!controls.items.length) {
      throw new Error("No selected content control");
    }
    const selectedControl = controls.items[0];
    selectedControl.insertText(text, Word.InsertLocation.replace);
    await context.sync();
  });
  const payload = await apiRequest("/api/word-live/region/update-text", {
    method: "POST",
    body: JSON.stringify({
      session_id: state.sessionId,
      region_id: control.region_id,
      text,
      addin_version: ADDIN_VERSION,
    }),
  });
  state.session = payload;
  renderSession(payload);
  setStatus(`Updated '${control.region_id}' through the bridge.`);
}

async function replaceSelectedFragment() {
  if (!state.sessionId) {
    setStatus("Open a session first.", "warn");
    return;
  }
  const fragment = els.ooxmlPayload.value.trim();
  if (!fragment) {
    setStatus("OOXML fragment is empty.", "warn");
    return;
  }
  const control = await getSelectedControlSnapshot();
  if (!control) {
    setStatus("Select a content control first.", "warn");
    return;
  }
  if (control.kind === "text") {
    setStatus("Use text update for text regions.", "warn");
    return;
  }
  await Word.run(async (context) => {
    const selection = context.document.getSelection();
    const controls = selection.getContentControls();
    controls.load("items");
    await context.sync();
    if (!controls.items.length) {
      throw new Error("No selected content control");
    }
    const range = controls.items[0].getRange();
    range.insertOoxml(fragment, Word.InsertLocation.replace);
    await context.sync();
  });
  const payload = await apiRequest("/api/word-live/region/replace-fragment", {
    method: "POST",
    body: JSON.stringify({
      session_id: state.sessionId,
      region_id: control.region_id,
      fragment_ooxml: fragment,
      addin_version: ADDIN_VERSION,
    }),
  });
  state.session = payload;
  renderSession(payload);
  setStatus(`Replaced fragment in '${control.region_id}'.`);
}

function renderRegions(regions) {
  els.regionCount.textContent = String(regions.length);
  if (!regions.length) {
    els.regionsList.innerHTML = "<div class='region-card'><p class='meta'>No content controls found.</p></div>";
    return;
  }
  els.regionsList.innerHTML = regions.map((region) => `
    <article class="region-card">
      <h3>${escapeHtml(region.title || region.region_id)}</h3>
      <p class="meta">${escapeHtml(region.region_id)} · ${escapeHtml(region.kind)} · ops: ${escapeHtml((region.allowed_ops || []).join(", "))}</p>
      <p class="preview">${escapeHtml(region.text_preview || "(No text preview)")}</p>
    </article>
  `).join("");
}

function renderSession(session) {
  els.sessionChip.textContent = session.session_id ? `v${session.document_version}` : "No session";
  els.sessionJson.textContent = JSON.stringify(session, null, 2);
  renderRegions(session.regions || []);
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function markControlsDirty(ids) {
  if (!Array.isArray(ids)) {
    return;
  }
  ids.forEach((id) => state.dirtyControlIds.add(Number(id)));
  if (state.flushTimer) {
    clearTimeout(state.flushTimer);
  }
  state.flushTimer = setTimeout(() => {
    flushDirtyControls().catch((error) => setStatus(error.message || String(error), "warn"));
  }, 600);
}

async function flushDirtyControls() {
  if (!state.sessionId || !state.dirtyControlIds.size) {
    return;
  }
  const ids = Array.from(state.dirtyControlIds);
  state.dirtyControlIds.clear();
  const regions = await scanWordRegions(ids);
  if (!regions.length) {
    await resyncSession();
    return;
  }
  for (const region of regions.filter((item) => item.kind === "text")) {
    await apiRequest("/api/word-live/region/update-text", {
      method: "POST",
      body: JSON.stringify({
        session_id: state.sessionId,
        region_id: region.region_id,
        text: region.text_preview || "",
        addin_version: ADDIN_VERSION,
      }),
    });
  }
  const richRegions = regions.filter((item) => item.kind !== "text");
  if (richRegions.length) {
    await apiRequest("/api/word-live/session/resync", {
      method: "POST",
      body: JSON.stringify({
        session_id: state.sessionId,
        addin_version: ADDIN_VERSION,
        regions: richRegions,
      }),
    });
  }
  await refreshSessionState();
}

async function attachContentControlEvents() {
  if (state.eventsAttached) {
    return;
  }
  try {
    await Word.run(async (context) => {
      const controls = context.document.contentControls;
      controls.load("items/id");
      await context.sync();
      for (const control of controls.items) {
        state.eventContexts.push(control.onDataChanged.add((event) => markControlsDirty(event.ids)));
        state.eventContexts.push(control.onDeleted.add((event) => markControlsDirty(event.ids)));
        control.track();
      }
      await context.sync();
    });
    state.eventsAttached = true;
    setStatus("Content control live events attached.");
  } catch (error) {
    setStatus(`Live events unavailable, falling back to manual resync: ${error.message || error}`, "warn");
  }
}

function bindUi() {
  els.backendUrl = $("backend-url");
  els.documentPath = $("document-path");
  els.regionTag = $("region-tag");
  els.regionTitle = $("region-title");
  els.textPayload = $("text-payload");
  els.ooxmlPayload = $("ooxml-payload");
  els.sessionChip = $("session-chip");
  els.sessionJson = $("session-json");
  els.regionsList = $("regions-list");
  els.regionCount = $("region-count");
  els.status = $("status");

  els.backendUrl.value = state.backendUrl;
  els.documentPath.value = state.documentPath;

  $("open-session").addEventListener("click", () => openSession().catch((error) => setStatus(error.message || String(error), "warn")));
  $("resync-session").addEventListener("click", () => resyncSession().catch((error) => setStatus(error.message || String(error), "warn")));
  $("refresh-regions").addEventListener("click", () => refreshRegions().catch((error) => setStatus(error.message || String(error), "warn")));
  $("insert-text-control").addEventListener("click", () => wrapSelectionAsTextControl().catch((error) => setStatus(error.message || String(error), "warn")));
  $("sync-selected").addEventListener("click", () => syncSelectedControl().catch((error) => setStatus(error.message || String(error), "warn")));
  $("apply-text").addEventListener("click", () => applyTextToSelected().catch((error) => setStatus(error.message || String(error), "warn")));
  $("replace-fragment").addEventListener("click", () => replaceSelectedFragment().catch((error) => setStatus(error.message || String(error), "warn")));
}

Office.onReady(async (info) => {
  hydrateState();
  bindUi();
  setStatus(`Office ready: ${info.host}`);
  if (state.sessionId) {
    try {
      await refreshSessionState();
    } catch (error) {
      setStatus(`Stored session could not be restored: ${error.message || error}`, "warn");
    }
  }
  try {
    await refreshRegions();
  } catch (error) {
    setStatus(`Initial region scan failed: ${error.message || error}`, "warn");
  }
});
