# ADR-008: Cross-Tab Overlay via Direct Script Injection

## Status

Proposed (supersedes the `cross_tab_overlay.js` content script approach)

## Context

The current cross-tab alert system relies on `cross_tab_overlay.js` being declared as a content script matching `<all_urls>` in the manifest. The background service worker broadcasts messages to all tabs, and the content script listens and shows/hides the overlay.

This approach has two critical bugs:

1. **Content scripts only inject into pages loaded after the extension is installed/reloaded.** Tabs the user already had open (e.g., Google Docs, Gmail) never receive the content script, so they never get the overlay. This is the primary reason the feature appears broken.

2. **`chrome.tabs.sendMessage` returns a Promise in MV3, but errors are swallowed by `try/catch` instead of `.catch()`.** Promise rejections from unreachable tabs are silently lost — there's no way to know the message failed.

## Decision

**Replace the broadcast-to-content-script approach with direct injection via `chrome.scripting.executeScript` and `chrome.scripting.insertCSS`.**

When the alert state transitions to active, the background service worker directly injects a small function into the currently active tab that creates the red overlay. When the alert clears, it injects a function that removes it. When the user switches tabs while alerting, the overlay is injected into the newly active tab.

### Key changes

1. **Remove `cross_tab_overlay.js`** from the manifest `content_scripts` and from the project.
2. **Remove `<all_urls>` from `content_scripts`** — no longer needed.
3. **Add `"scripting"` to `permissions`** in `manifest.json`.
4. **Keep `<all_urls>` in `host_permissions`** — required for `chrome.scripting.executeScript` to target arbitrary tabs.
5. **Background service worker** uses `chrome.scripting.executeScript` to inject/remove the overlay on the active tab.

### Background service worker logic

```javascript
// Inject red overlay into a specific tab
async function injectOverlay(tabId) {
  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      func: showCrossTabOverlay,  // defined as a serializable function
    });
  } catch (_) {
    // Tab may be a chrome:// page or otherwise restricted — ignore
  }
}

// Remove red overlay from a specific tab
async function removeOverlay(tabId) {
  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      func: hideCrossTabOverlay,
    });
  } catch (_) {}
}
```

### When to inject/remove

| Event | Action |
|---|---|
| Alert starts (any Meet/Teams tab) | Inject overlay into the current active tab (if it's not a call tab) |
| Alert stops (all call tabs quiet) | Remove overlay from all tracked injected tabs |
| User switches tabs while alerting | Remove overlay from previous tab, inject into new active tab |
| User switches windows while alerting | Inject overlay into the active tab of the newly focused window |

### Tracking injected tabs

The service worker maintains a `Set<number>` of tab IDs where the overlay has been injected, so it can clean them all up when the alert stops.

### Manifest changes

```json
{
  "permissions": ["storage", "scripting"],
  "host_permissions": ["<all_urls>"],
  "content_scripts": [
    {
      "matches": [
        "https://meet.google.com/*",
        "https://teams.microsoft.com/*",
        "https://teams.live.com/*"
      ],
      "js": ["content_script.js"],
      "css": ["overlay.css"],
      "run_at": "document_end"
    }
  ]
}
```

Note: the `<all_urls>` content script entry for `cross_tab_overlay.js` is removed entirely.

## Consequences

**What becomes easier:**
- Works on ALL tabs regardless of when they were opened — no dependency on pre-injected content scripts.
- No message passing required for the overlay — direct injection is simpler and more reliable.
- Fewer moving parts: one file removed (`cross_tab_overlay.js`), no broadcast logic.
- Errors from `chrome.scripting.executeScript` are catchable directly (returns a Promise).

**What becomes harder:**
- Requires `"scripting"` permission — one more permission in the manifest. Chrome Web Store reviewers may scrutinize this, but combined with the clear single purpose ("inject volume alert overlay"), it should pass.
- `chrome.scripting.executeScript` cannot inject into `chrome://` pages, `chrome-extension://` pages, or the Web Store. These are silently skipped (try/catch). The user simply won't see the overlay on those tabs — acceptable.
- The injected function must be self-contained (serializable) — it cannot reference variables from the service worker scope. This is fine since the overlay is just DOM creation.

**What is removed:**
- `src/cross_tab_overlay.js` — deleted
- `<all_urls>` content script entry in manifest — deleted
- `broadcast()` function in background.js — deleted
- `NM_SHOW_OVERLAY` / `NM_HIDE_OVERLAY` message protocol — deleted
