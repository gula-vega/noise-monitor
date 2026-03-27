# ADR-007: Persist Panel Collapsed State

## Status

Proposed

## Context

The control panel currently opens fully expanded every time a Meet or Teams page loads. During a call, the panel takes up screen space and is rarely needed after the user has set their threshold. Most users will minimize the panel and only expand it to re-adjust.

Currently the minimize button works within a session, but the state resets on every page load — the user must re-minimize every time they join a call.

The question is: should the panel default to collapsed, or should it remember the user's last choice?

**Option A — Always collapsed by default:** Simple, but first-time users won't see the slider and may not know the panel expands.

**Option B — Remember last state:** Respects user intent. First-time users see it expanded (no stored state = expanded default), and after they minimize it, it stays minimized on subsequent loads.

## Decision

**Persist the minimized state in `chrome.storage.sync`** (Option B).

### Storage key

| Key | Type | Default | Purpose |
|---|---|---|---|
| `minimized` | `boolean` | `false` | Whether the control panel body is collapsed |

This joins the existing `threshold` and `enabled` keys. All three are loaded together in a single `chrome.storage.sync.get()` call.

### Behavior

1. **First install / no stored value:** Panel is **expanded** (minimized = false). The user sees the full UI — slider, meter, status — and can orient themselves.
2. **User clicks minimize:** State saved immediately via `chrome.storage.sync.set({ minimized: true })`. Panel collapses.
3. **User clicks expand:** State saved as `false`. Panel expands.
4. **Next page load:** `loadSettings()` reads `minimized` and applies the class before the panel is visible, avoiding a flash of expanded→collapsed.

### Implementation detail

The `loadSettings()` function already loads `threshold` and `enabled`. Add `minimized` to the same `get()` call:

```javascript
const MINIMIZED_KEY = "minimized";

// In loadSettings:
chrome.storage.sync.get([STORAGE_KEY, ENABLED_KEY, MINIMIZED_KEY], (result) => {
  // ... existing threshold/enabled logic ...
  if (result[MINIMIZED_KEY]) {
    controlPanel.classList.add("minimized");
    minBtn.textContent = "+";
  }
});

// In minimize button handler:
minBtn.addEventListener("click", () => {
  const isMinimized = controlPanel.classList.toggle("minimized");
  minBtn.textContent = isMinimized ? "+" : "\u2212";
  chrome.storage.sync.set({ [MINIMIZED_KEY]: isMinimized });
});
```

## Consequences

**What becomes easier:**
- Users who prefer the panel collapsed don't have to re-minimize every call.
- Consistent with how `threshold` and `enabled` are already persisted — same pattern, same storage call.
- First-time experience remains discoverable (panel starts expanded).

**What becomes harder:**
- Nothing significant. One more key in storage, one more line in `loadSettings()`.

**Tradeoff:**
- Using `chrome.storage.sync` means the collapsed state syncs across devices. A user who minimizes on their laptop will also see it minimized on their desktop. This is intentional — it's a UI preference, not a per-device setting.
