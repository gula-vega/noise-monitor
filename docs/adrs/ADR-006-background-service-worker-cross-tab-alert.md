# ADR-006: Background Service Worker for Cross-Tab Alerts

## Status

Proposed (supersedes ADR-001 partially — ADR-001's "no service worker" stance is no longer viable)

## Context

When the user switches away from the Meet/Teams tab (to another tab or another window), the in-page red overlay is no longer visible. The user has no way to know they are speaking too loudly because the warning is trapped in a hidden tab.

This is a real usability problem: users often switch tabs during calls (checking email, reading docs, taking notes). The mic is still hot, volume is still being monitored, but the alert is invisible.

Chrome provides several mechanisms to alert the user outside the page context:
1. **Extension badge** — colored icon badge on the extension toolbar icon (visible across all tabs)
2. **Badge text** — short text on the icon (e.g., "LOUD")
3. **Tab title change** — prepend a warning to the tab title (visible in the tab strip)
4. **Desktop notifications** — `chrome.notifications` API
5. **Window focus** — force-focus the Meet/Teams tab (very disruptive)

Options 1-3 are non-intrusive and complementary. Option 4 is useful but can be dismissed and forgotten. Option 5 is too aggressive.

### Why a service worker is now needed

`chrome.action.setBadgeText()` and `chrome.action.setBadgeBackgroundColor()` can only be called from the **extension's background context** (service worker), not from content scripts. Content scripts must send a message to the service worker, which then sets the badge.

## Decision

**Add a background service worker (`background.js`)** that receives volume-alert state from content scripts and manages cross-tab indicators.

### Architecture

```
Content Script (Meet/Teams tab)          Background Service Worker
┌─────────────────────────────┐          ┌──────────────────────────┐
│  tick() detects loud state  │          │                          │
│          │                  │  message  │  onMessage listener      │
│          ├──────────────────┼─────────▶│    │                     │
│          │                  │          │    ├─ setBadgeText        │
│  tick() detects quiet state │          │    ├─ setBadgeColor       │
│          │                  │  message  │    └─ (clear on quiet)   │
│          ├──────────────────┼─────────▶│                          │
│                             │          │  Track per-tab state     │
│  Also: update tab title     │          │  (tabId → alerting)      │
└─────────────────────────────┘          └──────────────────────────┘
```

### Message protocol

Content script sends to background:

```typescript
/** Sent from content script to service worker when alert state changes */
interface VolumeAlertMessage {
  type: 'VOLUME_ALERT_STATE';
  alerting: boolean;
}
```

Service worker action on receive:

| `alerting` | Badge text | Badge color | Action |
|---|---|---|---|
| `true` | `"!"` | Red (`#F44336`) | Set badge to indicate loud |
| `false` | `""` (empty) | — | Clear badge |

### Tab title prefix (content script, no service worker needed)

The content script will also prepend a warning to the tab's `document.title` when the overlay is active:

```
Original:  "Google Meet"
Alerting:  "⚠ LOUD - Google Meet"
```

This is visible in the tab strip even when the tab is not focused. The original title is restored when the alert clears.

### What the service worker does NOT do

- Does NOT capture audio (that stays in the content script)
- Does NOT run the threshold engine (that stays in the content script)
- Does NOT persist state across browser restarts (transient badge only)
- Does NOT use `chrome.alarms` or long-lived connections — just one-shot `chrome.runtime.onMessage`

### Manifest changes

```json
{
  "background": {
    "service_worker": "background.js"
  },
  "permissions": ["storage"]
}
```

No additional permissions needed — `chrome.action.setBadgeText` does not require extra permissions.

### Multi-tab handling

The service worker tracks alert state **per tab** using a `Map<number, boolean>` (tab ID → alerting). The badge shows `"!"` if **any** tracked tab is alerting. When a tab closes (`chrome.tabs.onRemoved`), its entry is cleaned up.

## Consequences

**What becomes easier:**
- Users see a red badge `"!"` on the extension icon no matter what tab they're on.
- Tab title prefix is visible in the tab strip without switching back.
- Both indicators are lightweight, non-intrusive, and require no extra permissions.

**What becomes harder:**
- ADR-001's "no service worker" simplicity is gone. We now have message passing between content script and background.
- MV3 service workers can be terminated by Chrome after ~30 seconds of inactivity. However, badge state set via `chrome.action.setBadgeText` persists even after the worker terminates. The worker only needs to wake on incoming messages, which is exactly how `chrome.runtime.onMessage` works.
- Testing now requires mocking `chrome.runtime.sendMessage` (content script side) and `chrome.runtime.onMessage` (background side).

**What was rejected:**
- **Desktop notifications** (`chrome.notifications`): Adds noise (pun intended). Users may dismiss them, and they stack up. Badge is more subtle and persistent. Can be added later if users request it.
- **Forcing tab focus**: Too disruptive. The user switched tabs intentionally.
- **Offscreen document for audio processing**: Not needed — `getUserMedia` works fine in content scripts and continues running in background tabs.

**Risks:**
- Chrome throttles `setInterval` in background tabs to ~1 per second. This means the volume check frequency drops from 100ms to ~1000ms when the tab is not focused. This is acceptable — we don't need sub-second precision for a "you're too loud" alert. The debounce timers (300ms on, 1000ms off) still work correctly at this reduced frequency.
