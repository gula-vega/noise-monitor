# ADR-005: Multi-Platform Support (Google Meet + Microsoft Teams)

## Status

Proposed

## Context

The extension currently only works on Google Meet (`https://meet.google.com/*`). Users have requested support for Microsoft Teams browser calls as well.

Teams in the browser runs at `https://teams.microsoft.com/*` (and the newer `https://teams.live.com/*` for personal accounts). The core audio monitoring logic is platform-agnostic — it captures the user's mic via `getUserMedia` and measures volume. The only platform-specific parts are:

1. **Manifest `matches` patterns** — which URLs trigger the content script.
2. **`host_permissions`** — which origins the extension declares.
3. **DOM injection** — the overlay and control panel are injected into the page body, which works identically on both platforms.
4. **Extension naming/branding** — "Meet Mic Volume Alert" no longer accurately describes the product.

There are no platform-specific APIs or DOM structures we depend on. The content script does not interact with Meet's or Teams' own UI elements — it only injects its own floating panel and overlay.

## Decision

**Extend the content script to inject on both Meet and Teams** by adding their URL patterns to `manifest.json`. No code branching or platform detection is needed in the content script itself.

### Manifest changes

```json
{
  "host_permissions": [
    "https://meet.google.com/*",
    "https://teams.microsoft.com/*",
    "https://teams.live.com/*"
  ],
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

### Branding update

- Extension name: "Meet Mic Volume Alert" -> "Noise Monitor" (platform-neutral)
- Description updated to mention both Meet and Teams

### No code changes to content_script.js

The content script is already platform-agnostic. `getUserMedia`, `AudioContext`, `AnalyserNode`, DOM injection, and `chrome.storage` all work identically on any HTTPS page.

## Consequences

**What becomes easier:**
- Supporting additional platforms in the future (Zoom web, Webex, etc.) requires only adding URL patterns to `manifest.json` — zero code changes.
- Single codebase, single content script — no platform-specific forks to maintain.

**What becomes harder:**
- The extension now requests `host_permissions` for three origins. Users who only use Meet may question why Teams permissions are needed. Chrome's permission prompt will show all hosts.
- If a future platform requires platform-specific behavior (e.g., different injection timing, or avoiding conflicts with that platform's UI), we would need to introduce platform detection. Not needed today.

**Risks:**
- Teams uses a complex SPA that may re-render the body or use Shadow DOM. If our injected elements disappear, we'd need a `MutationObserver` to re-inject. This should be tested but is unlikely to be an issue since we inject fixed-position elements on `document.body`.
- `teams.live.com` is the personal/free Teams domain. If Microsoft introduces additional domains, we'd add them to the manifest.
