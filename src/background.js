/**
 * Noise Monitor — Background Service Worker
 *
 * Receives volume-alert state from content scripts and manages the
 * extension icon badge.  Shows a red "!" badge when any monitored tab
 * is alerting, clears it when all tabs are quiet.
 *
 * See ADR-006 for design rationale.
 */

(() => {
  "use strict";

  /** @type {Map<number, boolean>} tabId -> alerting */
  const tabAlertState = new Map();

  const BADGE_TEXT_ALERT = "!";
  const BADGE_TEXT_CLEAR = "";
  const BADGE_COLOR_ALERT = "#F44336";

  /* ------------------------------------------------------------------ */
  /*  Badge Management                                                    */
  /* ------------------------------------------------------------------ */

  function updateBadge() {
    const anyAlerting = [...tabAlertState.values()].some(Boolean);

    chrome.action.setBadgeText({ text: anyAlerting ? BADGE_TEXT_ALERT : BADGE_TEXT_CLEAR });

    if (anyAlerting) {
      chrome.action.setBadgeBackgroundColor({ color: BADGE_COLOR_ALERT });
    }
  }

  /* ------------------------------------------------------------------ */
  /*  Message Listener                                                    */
  /* ------------------------------------------------------------------ */

  chrome.runtime.onMessage.addListener((message, sender) => {
    if (message.type !== "VOLUME_ALERT_STATE") return;
    if (!sender.tab || sender.tab.id == null) return;

    const tabId = sender.tab.id;

    tabAlertState.set(tabId, message.alerting);
    updateBadge();
  });

  /* ------------------------------------------------------------------ */
  /*  Tab Cleanup                                                         */
  /* ------------------------------------------------------------------ */

  chrome.tabs.onRemoved.addListener((tabId) => {
    if (tabAlertState.has(tabId)) {
      tabAlertState.delete(tabId);
      updateBadge();
    }
  });
})();
