# Noise Monitor — Architecture Overview

## 1. System Summary

Noise Monitor is a **Manifest V3 Chrome extension** that monitors the local user's microphone volume during Google Meet and Microsoft Teams browser calls. When volume exceeds a configurable threshold for a sustained duration, a red overlay warning appears on the call tab. If the user switches to another tab or window, alerts are surfaced via the extension badge and tab title. All audio processing is local — no audio is recorded or transmitted.

## 2. Supported Platforms

| Platform | URL patterns |
|---|---|
| Google Meet | `https://meet.google.com/*` |
| Microsoft Teams (work) | `https://teams.microsoft.com/*` |
| Microsoft Teams (personal) | `https://teams.live.com/*` |

The content script is **platform-agnostic** — it injects the same UI and runs the same audio pipeline on all platforms. Adding new platforms requires only a manifest change (see [ADR-005](../adrs/ADR-005-multi-platform-meet-teams.md)).

## 3. Execution Contexts

```
┌──────────────────────────────────────────────────────────┐
│                    Chrome Extension                       │
│                                                           │
│  ┌─────────────────────────────────────────────────────┐  │
│  │          Content Script (per Meet/Teams tab)         │  │
│  │                                                      │  │
│  │  ┌──────────┐  ┌───────────┐  ┌─────────────────┐   │  │
│  │  │ Audio    │  │ Threshold │  │ Overlay UI      │   │  │
│  │  │ Pipeline │─▶│ Engine    │─▶│ Controller      │   │  │
│  │  └──────────┘  └───────────┘  └─────────────────┘   │  │
│  │       │              │               │               │  │
│  │       │        ┌───────────┐   ┌───────────────┐     │  │
│  │       └───────▶│ Settings  │   │ Tab Title     │     │  │
│  │                │ Store     │   │ Manager       │     │  │
│  │                └───────────┘   └───────────────┘     │  │
│  └───────────────────────┬─────────────────────────────┘  │
│                          │ chrome.runtime.sendMessage      │
│                          ▼                                 │
│  ┌─────────────────────────────────────────────────────┐  │
│  │         Background Service Worker                    │  │
│  │                                                      │  │
│  │  ┌──────────────────────────────────────────────┐    │  │
│  │  │  Badge Controller                            │    │  │
│  │  │  - Receives alert state per tab              │    │  │
│  │  │  - Sets/clears extension icon badge          │    │  │
│  │  │  - Cleans up on tab close                    │    │  │
│  │  └──────────────────────────────────────────────┘    │  │
│  └─────────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────┘
```

See [ADR-006](../adrs/ADR-006-background-service-worker-cross-tab-alert.md) for why a service worker is now needed (supersedes ADR-001's no-worker stance).

## 4. Modules

### 4.1 Audio Pipeline

**Responsibility:** Capture microphone audio and produce continuous dBFS volume readings.

**Interface:**

```typescript
interface AudioPipeline {
  start(): Promise<void>;
  stop(): void;
  getCurrentVolume(): number;   // dBFS, -Infinity when silent
  readonly isActive: boolean;
  readonly error: AudioPipelineError | null;
}

type AudioPipelineError =
  | { code: 'NOT_FOUND'; message: string }
  | { code: 'NOT_ALLOWED'; message: string }
  | { code: 'UNKNOWN'; message: string };
```

**Implementation:** `getUserMedia` -> `AudioContext` -> `AnalyserNode` (fftSize: 2048) -> `getFloatTimeDomainData` -> RMS -> `20 * log10(rms)`. Not connected to `audioContext.destination`.

### 4.2 Threshold Engine (Debounce Logic)

**Responsibility:** Determine whether the overlay should be visible, given volume and threshold. Implements dual-timer debounce (see [ADR-003](../adrs/ADR-003-overlay-debounce-strategy.md)).

**Current implementation** (inline in `tick()`):
- Tracks `loudStartTime` — when continuous loud speech began
- Activation: volume above threshold for 300ms -> show overlay
- Deactivation: volume below threshold for 1000ms -> hide overlay (via `setTimeout`)

**Interface (logical):**

```typescript
interface ThresholdEngine {
  evaluate(currentDb: number, thresholdDb: number, now: number): boolean;
  reset(): void;
}
```

### 4.3 Overlay UI Controller

**Responsibility:** Manage all injected DOM — control panel, slider, meter, toggle, and red warning overlay.

**DOM elements:**

| Element | Purpose |
|---|---|
| `#vol-control-panel` | Fixed-position floating panel (top-left), dark theme |
| `#vol-threshold` | `<input type="range">` slider, min=-60, max=0, step=1 |
| `#vol-db-value` | `<span>` showing current dB threshold |
| `.vol-meter` / `.vol-meter-fill` | Live volume meter bar (green/red) |
| `.vol-status` | Status text ("Monitoring mic", errors) |
| `.vol-toggle-btn` | ON/OFF toggle button |
| `.vol-minimize-btn` | Collapse/expand panel body |
| `#vol-overlay` | Full-viewport red semi-transparent overlay with warning |

**Constraints:**
- Overlay: `pointer-events: none`, z-index 999998
- Control panel: z-index 999999
- All IDs/classes prefixed with `vol-` to avoid DOM conflicts

### 4.4 Settings Store

**Responsibility:** Persist user preferences via `chrome.storage.sync`.

**Stored keys:**

| Key | Type | Default | Purpose |
|---|---|---|---|
| `threshold` | `number` | `-23` | Volume threshold in dBFS |
| `enabled` | `boolean` | `true` | Whether monitoring is active |
| `minimized` | `boolean` | `false` | Whether the control panel is collapsed |

The `minimized` state is persisted so the panel remembers the user's preference across page loads. First-time users see the panel expanded; once minimized, it stays minimized on subsequent calls. See [ADR-007](../adrs/ADR-007-persist-panel-collapsed-state.md).

### 4.5 Tab Title Manager (NEW)

**Responsibility:** Prepend a warning prefix to `document.title` when the overlay is active, so the user sees an alert in the tab strip even when on another tab.

**Interface:**

```typescript
interface TabTitleManager {
  /** Store the original title and prepend warning prefix */
  setAlerting(): void;

  /** Restore the original title */
  clearAlerting(): void;
}
```

**Behavior:**
- When alerting: `document.title` = `"⚠ LOUD - " + originalTitle`
- When cleared: `document.title` = `originalTitle`
- Must handle Meet/Teams dynamically changing the title (e.g., participant count) — capture `originalTitle` at alert start, not at page load.

### 4.6 Badge Controller (NEW — background service worker)

**Responsibility:** Receive alert state from content scripts and manage the extension icon badge.

**File:** `src/background.js`

**Interface (message protocol):**

```typescript
/** Content script -> Service worker */
interface VolumeAlertMessage {
  type: 'VOLUME_ALERT_STATE';
  alerting: boolean;
}
```

**Behavior:**
- Maintains a `Map<number, boolean>` of `tabId -> alerting` state
- On `alerting: true` from any tab: set badge text `"!"`, badge color red (`#F44336`)
- On `alerting: false` (and no other tab alerting): clear badge text
- On `chrome.tabs.onRemoved`: clean up that tab's entry
- Stateless across service worker restarts — badge state persists natively in Chrome, and the next content script message will re-establish it

## 5. Data Flow

```
┌─────────┐  getUserMedia  ┌────────────┐ currentDb ┌───────────┐ shouldShow
│  Mic    │───────────────▶│ Audio      │──────────▶│ Threshold │──────────┐
│  (HW)   │                │ Pipeline   │           │ Engine    │          │
└─────────┘                └────────────┘           └───────────┘          │
                                                                           │
              ┌────────────────────────────────────────────────────────────┘
              │
              ▼
   ┌─────────────────┐     ┌──────────────┐     ┌──────────────────┐
   │  Main Loop      │────▶│ Overlay UI   │     │ Tab Title Mgr    │
   │  (setInterval   │     │ Controller   │     │ (prefix/restore) │
   │   ~100ms)       │────▶│              │     │                  │
   │                 │     └──────────────┘     └──────────────────┘
   │                 │                                 ▲
   │                 │─────────────────────────────────┘
   │                 │
   │                 │     ┌──────────────┐
   │                 │────▶│ sendMessage  │──── chrome.runtime ───┐
   │                 │     └──────────────┘                       │
   └─────────────────┘                                            ▼
          ▲                                          ┌────────────────────┐
          │         ┌──────────────┐                 │ Background Worker  │
          └─────────│ Settings     │                 │ Badge Controller   │
                    │ Store        │                 │ setBadgeText("!")  │
                    └──────────────┘                 └────────────────────┘
```

### Main loop changes

The `tick()` function gains two new calls when alert state **transitions**:

```
On transition to alerting:
  1. showOverlay()
  2. tabTitleManager.setAlerting()
  3. chrome.runtime.sendMessage({ type: 'VOLUME_ALERT_STATE', alerting: true })

On transition to quiet:
  1. hideOverlay()
  2. tabTitleManager.clearAlerting()
  3. chrome.runtime.sendMessage({ type: 'VOLUME_ALERT_STATE', alerting: false })
```

Messages are sent only on **transitions**, not every tick — avoids flooding the service worker.

## 6. File Structure

```
noise-monitor/
├── src/
│   ├── manifest.json
│   ├── content_script.js       # Entry point — all modules, main loop
│   ├── background.js           # NEW — service worker for badge control
│   ├── overlay.css
│   ├── popup.html
│   ├── popup.js
│   ├── privacy-policy.html      # Privacy policy for Chrome Web Store
│   └── icons/
│       ├── icon16.png
│       ├── icon48.png
│       └── icon128.png
├── docs/
│   ├── architecture/
│   │   └── overview.md
│   └── adrs/
│       ├── ADR-001-content-script-architecture.md
│       ├── ADR-002-web-audio-volume-measurement.md
│       ├── ADR-003-overlay-debounce-strategy.md
│       ├── ADR-004-plain-js-no-build.md
│       ├── ADR-005-multi-platform-meet-teams.md
│       ├── ADR-006-background-service-worker-cross-tab-alert.md
│       └── ADR-007-persist-panel-collapsed-state.md
└── tests/
    ├── threshold-engine.test.js
    └── badge-controller.test.js
```

## 7. Component Relationships

| Producer | Consumer | Interface | Transport |
|---|---|---|---|
| Audio Pipeline | Main Loop | `measureLevel(): number` | Direct call |
| Main Loop | Threshold Engine | debounce logic in `tick()` | Inline |
| Main Loop | Overlay UI | `showOverlay()` / `hideOverlay()` | DOM class toggle |
| Main Loop | Tab Title Manager | `setAlerting()` / `clearAlerting()` | `document.title` |
| Main Loop | Badge Controller | `{ type, alerting }` | `chrome.runtime.sendMessage` |
| Badge Controller | Chrome | `setBadgeText()` / `setBadgeBackgroundColor()` | Chrome API |
| Overlay UI (slider) | Settings Store | `saveThreshold(db)` | `chrome.storage.sync` |
| Settings Store | Main Loop | `loadSettings()` | `chrome.storage.sync` |
| Chrome | Badge Controller | tab closed | `chrome.tabs.onRemoved` |

## 8. Security & Privacy

- **No network calls** — zero outbound requests
- **No audio leaves the device** — only numeric dB values are computed
- **Minimal permissions** — `storage` only; `host_permissions` for the three supported domains
- **Message passing is extension-internal** — `chrome.runtime.sendMessage` stays within the extension, no external recipients
- **Content script isolation** — runs in Chrome's isolated world, no access to page JS globals

## 9. Testing Strategy

| Module | Test Type | Approach |
|---|---|---|
| Threshold Engine (debounce) | Unit (Jest) | Feed known dB sequences with mocked timestamps, assert transitions |
| Audio Pipeline | Unit (Jest) | Mock `navigator.mediaDevices`, `AudioContext`, `AnalyserNode` |
| Settings Store | Unit (Jest) | Mock `chrome.storage.sync` |
| Overlay UI | Unit (Jest/JSDOM) | Verify DOM creation, class toggling, slider events |
| Tab Title Manager | Unit (Jest) | Mock `document.title`, verify prefix/restore |
| Badge Controller | Unit (Jest) | Mock `chrome.runtime.onMessage`, `chrome.action.setBadgeText`, `chrome.tabs.onRemoved` |
| Message passing | Integration | Mock `chrome.runtime.sendMessage` in content script, verify background receives correct messages |
| Cross-tab alert | Manual | Open Meet, trigger loud volume, switch tabs, verify badge appears |
| Teams compatibility | Manual | Load extension, open Teams call, verify injection and alerts work |

## 10. Key Architectural Decisions

| ADR | Decision | Rationale |
|---|---|---|
| [ADR-001](../adrs/ADR-001-content-script-architecture.md) | Content-script-only (**partially superseded by ADR-006**) | Original decision; badge alerts require a service worker |
| [ADR-002](../adrs/ADR-002-web-audio-volume-measurement.md) | Web Audio API with AnalyserNode + RMS->dB | Standard API, no deps, local processing |
| [ADR-003](../adrs/ADR-003-overlay-debounce-strategy.md) | Dual-timer debounce (300ms on, 1000ms off) | Prevents flicker, stable alerts |
| [ADR-004](../adrs/ADR-004-plain-js-no-build.md) | Plain JS/CSS, no build toolchain | Minimal complexity |
| [ADR-005](../adrs/ADR-005-multi-platform-meet-teams.md) | Extend to Teams via manifest patterns | Content script is platform-agnostic |
| [ADR-006](../adrs/ADR-006-background-service-worker-cross-tab-alert.md) | Add service worker for badge + tab title alerts | Cross-tab visibility when user switches away |
| [ADR-007](../adrs/ADR-007-persist-panel-collapsed-state.md) | Persist panel collapsed state in storage | Remember user's minimize preference across sessions |

## 11. Deployment

The extension is published globally via the Chrome Web Store.

**Key files:**
- `src/privacy-policy.html` — privacy policy (must be hosted at a public URL for the store listing)
- `docs/store-listing.md` — store name, description, screenshot captions
- `docs/publishing-checklist.md` — step-by-step checklist for packaging and submission

**Packaging:** `zip -r noise-monitor.zip` of the `src/` directory contents (excluding `docs/`, `tests/`, dev files).

**Privacy declaration:** The extension accesses the microphone but collects zero user data. No analytics, no telemetry, no remote code. This makes the Chrome review straightforward.

## 12. Constraints & Non-Goals

- **No other-participant monitoring** — only local mic
- **No auto-mute** — feedback only, never controls the call platform
- **No server component** — entirely client-side
- **Desktop Chrome only** — mobile Chrome does not support extensions
- **No desktop notifications** (for now) — badge + tab title are sufficient; notifications can be added later
