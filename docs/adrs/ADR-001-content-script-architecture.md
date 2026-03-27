# ADR-001: Content-Script-Only Architecture (No Background Service Worker)

## Status

Accepted

## Context

Manifest V3 Chrome extensions can use a combination of content scripts, background service workers, popup pages, and options pages. We need to decide which execution contexts to use for the Noise Monitor extension.

The extension's responsibilities are:
1. Capture microphone audio on `meet.google.com` pages
2. Analyze volume in real time
3. Inject and toggle a UI overlay on the Meet page
4. Persist a threshold setting via `chrome.storage`

All of these are **page-scoped** — they only matter while a Meet tab is open and active. There is no cross-tab coordination, no remote server communication, and no event handling outside the page context.

## Decision

Use a **content-script-only architecture** with no background service worker.

- A single `content_script.js` is declared in `manifest.json` with `matches: ["https://meet.google.com/*"]` and `run_at: "document_end"`.
- The content script handles all logic: mic capture, audio analysis, UI injection, overlay toggling, and storage access.
- No `background.js` or service worker is registered.
- An optional `popup.html` may be added for help/instructions but carries no application logic.

## Consequences

**What becomes easier:**
- Simpler mental model — one execution context, no message passing between background and content script.
- No service worker lifecycle management (MV3 service workers can be terminated by Chrome, requiring state restoration logic).
- Smaller extension footprint and faster load.
- `chrome.storage` is accessible directly from content scripts — no need for message relay.

**What becomes harder:**
- If future requirements need cross-tab state (e.g., "mute alerts on all Meet tabs"), a service worker would be needed. This ADR would be superseded at that point.
- No ability to run logic when no Meet tab is open (not a current requirement).
- Cannot intercept network requests or handle `chrome.alarms` (not needed).

**Risks:**
- Content scripts run in an isolated world but share the DOM with `meet.google.com`. CSS conflicts are possible — mitigated by unique ID prefixes (`vol-`).
- If Google Meet uses aggressive CSP changes that affect injected elements, we may need to revisit. Current MV3 content script injection is unaffected by page CSP.
