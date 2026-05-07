# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**QuietCue** (formerly "Noise Monitor") is a Manifest V3 Chrome extension that monitors the user's microphone volume during Google Meet and Microsoft Teams calls. The product is positioned as a gentle reminder for people who want to be mindful of colleagues, flatmates, or others sharing their space. When the user speaks above a configurable threshold, a red overlay cue appears on the call tab. All audio processing is local — no audio is recorded or transmitted.

## Architecture

- **Manifest V3 Chrome Extension** — no build step required (plain JS/CSS)
- **Content script** (`content_script.js`) injected into `meet.google.com` pages at `document_end`
- **Web Audio API pipeline**: `getUserMedia` -> `AudioContext` -> `AnalyserNode` -> RMS/dB computation in a polling loop
- **Overlay UI**: floating slider control panel + full-tab red warning overlay (uses `pointer-events: none` for click-through)
- **Storage**: `chrome.storage` for persisting the user's threshold setting (default: -20 dB)
- **No background/service worker required** for core functionality

### Key Files

| File | Purpose |
|------|---------|
| `manifest.json` | Extension manifest (V3), declares `storage` permission, `host_permissions` for `meet.google.com/*`, content script injection |
| `content_script.js` | Main logic: mic capture, audio analysis loop, threshold comparison, overlay toggle, slider UI creation |
| `overlay.css` | Styles for `#vol-control-panel`, slider, labels, and `#vol-overlay` |
| `icons/` | Extension icons (16x16, 48x48, 128x128 PNG) |
| `popup.html` / `popup.js` | Optional toolbar popup for help/instructions |
| `_locales/en/messages.json` | Optional i18n strings |

### Audio Processing Flow

1. `navigator.mediaDevices.getUserMedia({audio: true})` captures mic
2. Audio routed through `AudioContext` -> `AnalyserNode`
3. Interval loop computes RMS amplitude, converts to dB
4. If dB > threshold for debounce duration -> show red overlay
5. If dB drops below threshold -> hide overlay after short delay

## Build & Development

```bash
# No build step — plain JS/CSS
# Load as unpacked extension for development:
#   1. Go to chrome://extensions
#   2. Enable Developer Mode
#   3. Click "Load unpacked" and select this directory

# Package for Chrome Web Store:
zip -r meet-volume-alert.zip manifest.json content_script.js overlay.css icons/ popup.html popup.js
```

## Key Constraints

- Extension runs **only** on `https://meet.google.com/*` pages
- Mic access is requested via `getUserMedia` from the content script (browser prompts user)
- The overlay must use `pointer-events: none` so users can still interact with the Meet UI underneath
- Threshold slider value must persist across page reloads via `chrome.storage`
- Debounce/delay logic required to avoid false alarm flickers

## Reference

The detailed specification is in `deep-research-report.md`, which covers requirements, technical design, calibration, accessibility, testing plans, privacy policy text, and a code generation checklist.
