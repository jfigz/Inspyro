# Inspyro Word Live Add-in

Companion add-in for Word Desktop that talks to the local Inspyro `word-live`
bridge.

## Scope

- Word Desktop on Windows
- Structured editing regions based on `ContentControl`
- Native Word APIs first; OOXML fragment replacement only for rich controls
- No direct package patching while Word holds the document open

## Local URLs

- Task pane: `http://localhost:8000/word-addin/taskpane.html`
- Manifest: `http://localhost:8000/word-addin/manifest.xml`

If your Word installation rejects `http://localhost`, front the backend with a
trusted local HTTPS proxy and replace the origin inside `manifest.xml`.

## Typical flow

1. Start Inspyro backend on `localhost:8000`.
2. Sideload `word-addin/manifest.xml` in Word Desktop.
3. Open the task pane from the Inspyro ribbon button.
4. Open or resync a `word-live` session.
5. Wrap editable regions as content controls and let the add-in mirror changes
   into `/api/word-live/*`.
