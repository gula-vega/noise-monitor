/**
 * QuietCue — Background Service Worker
 *
 * 1. Receives VOLUME_ALERT_STATE from the Meet/Teams content script.
 * 2. Sets the extension badge.
 * 3. Uses chrome.scripting.executeScript to directly inject a red
 *    overlay into the currently active tab (works on tabs opened
 *    BEFORE the extension was installed — no pre-loaded content
 *    script needed).  See ADR-008.
 */
(() => {
  "use strict";

  /** @type {Map<number, boolean>} source tabId -> alerting */
  const tabAlertState = new Map();

  /** @type {Set<number>} tabs where we've injected the overlay */
  const injectedTabs = new Set();

  function isAlerting() {
    return [...tabAlertState.values()].some(Boolean);
  }

  // ---- Badge ----

  function updateBadge() {
    const alert = isAlerting();
    chrome.action.setBadgeText({ text: alert ? "!" : "" });
    if (alert) {
      chrome.action.setBadgeBackgroundColor({ color: "#F44336" });
    }
  }

  // ---- Injected functions (must be self-contained & serializable) ----

  function showCrossTabOverlay() {
    if (document.getElementById("noise-monitor-xtab")) return;
    const overlay = document.createElement("div");
    overlay.id = "noise-monitor-xtab";
    overlay.setAttribute("style",
      "position:fixed;inset:0;z-index:2147483647;pointer-events:none;" +
      "transition:opacity 0.3s ease;opacity:0;"
    );
    overlay.innerHTML =
      '<div style="position:absolute;inset:0;' +
        'background:radial-gradient(ellipse at center,rgba(255,0,0,0.18) 0%,rgba(255,0,0,0.45) 100%);' +
        'animation:nm-xpulse 1.6s ease-in-out infinite;"></div>' +
      '<div style="position:absolute;top:0;left:0;right:0;height:4px;' +
        'background:linear-gradient(90deg,transparent,#f44336,transparent);"></div>' +
      '<div style="position:absolute;bottom:0;left:0;right:0;height:4px;' +
        'background:linear-gradient(90deg,transparent,#f44336,transparent);"></div>' +
      '<div style="position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);' +
        'color:#fff;font-size:1.4em;font-weight:700;text-align:center;' +
        'background:rgba(0,0,0,0.75);padding:16px 32px;border-radius:14px;' +
        'font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,sans-serif;' +
        'line-height:1.4;max-width:80vw;' +
        'box-shadow:0 8px 32px rgba(0,0,0,0.5);' +
        'backdrop-filter:blur(8px);-webkit-backdrop-filter:blur(8px);">' +
        '<div>You are speaking too loudly</div>' +
        '<div style="font-size:0.55em;font-weight:500;color:rgba(255,255,255,0.6);margin-top:6px;">' +
          'Return to your call tab to adjust</div>' +
      '</div>' +
      '<style>@keyframes nm-xpulse{0%,100%{opacity:.75}50%{opacity:1}}</style>';
    document.documentElement.appendChild(overlay);
    requestAnimationFrame(function() { overlay.style.opacity = "1"; });
  }

  function hideCrossTabOverlay() {
    var el = document.getElementById("noise-monitor-xtab");
    if (el) el.remove();
  }

  // ---- Inject / Remove helpers ----

  async function injectOverlay(tabId) {
    if (injectedTabs.has(tabId)) return;
    if (tabAlertState.has(tabId)) return; // source tab has its own overlay
    try {
      await chrome.scripting.executeScript({
        target: { tabId },
        func: showCrossTabOverlay,
      });
      injectedTabs.add(tabId);
    } catch (_) {
      // chrome://, edge://, extensions gallery, etc — can't inject, ignore
    }
  }

  async function removeOverlay(tabId) {
    if (!injectedTabs.has(tabId)) return;
    try {
      await chrome.scripting.executeScript({
        target: { tabId },
        func: hideCrossTabOverlay,
      });
    } catch (_) {}
    injectedTabs.delete(tabId);
  }

  async function removeAllOverlays() {
    const tabs = [...injectedTabs];
    injectedTabs.clear();
    for (const tabId of tabs) {
      try {
        await chrome.scripting.executeScript({
          target: { tabId },
          func: hideCrossTabOverlay,
        });
      } catch (_) {}
    }
  }

  async function injectIntoActiveTab() {
    try {
      const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
      if (tab && tab.id != null && !tabAlertState.has(tab.id)) {
        await injectOverlay(tab.id);
      }
    } catch (_) {}
  }

  // ---- Message listener ----

  chrome.runtime.onMessage.addListener((message, sender) => {
    if (message.type !== "VOLUME_ALERT_STATE") return;
    if (!sender.tab || sender.tab.id == null) return;

    const wasAlerting = isAlerting();
    tabAlertState.set(sender.tab.id, message.alerting);
    updateBadge();
    const nowAlerting = isAlerting();

    if (!wasAlerting && nowAlerting) {
      injectIntoActiveTab();
    } else if (wasAlerting && !nowAlerting) {
      removeAllOverlays();
    }
  });

  // ---- Tab switch: move overlay to the newly active tab ----

  chrome.tabs.onActivated.addListener(async (activeInfo) => {
    if (!isAlerting()) return;
    if (tabAlertState.has(activeInfo.tabId)) return;
    await removeAllOverlays();
    await injectOverlay(activeInfo.tabId);
  });

  // ---- Window focus: inject into active tab of focused window ----

  chrome.windows.onFocusChanged.addListener(async (windowId) => {
    if (windowId === chrome.windows.WINDOW_ID_NONE) return;
    if (!isAlerting()) return;
    try {
      const [tab] = await chrome.tabs.query({ active: true, windowId });
      if (tab && tab.id != null && !tabAlertState.has(tab.id)) {
        await removeAllOverlays();
        await injectOverlay(tab.id);
      }
    } catch (_) {}
  });

  // ---- Tab close cleanup ----

  chrome.tabs.onRemoved.addListener((tabId) => {
    injectedTabs.delete(tabId);
    if (tabAlertState.has(tabId)) {
      tabAlertState.delete(tabId);
      updateBadge();
      if (!isAlerting()) {
        removeAllOverlays();
      }
    }
  });
})();
