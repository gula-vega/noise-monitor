/** QuietCue — Content Script. Local mic volume monitoring for Meet & Teams. */
(() => {
  "use strict";

  // --- Constants ---
  const DEFAULT_THRESHOLD_DB = -23;
  const SLIDER_MIN_DB = -60;
  const SLIDER_MAX_DB = 0;
  const FFT_SIZE = 2048;
  const POLL_INTERVAL_MS = 100;
  const DEBOUNCE_ON_MS = 300;   // ms above threshold before overlay shows
  const DEBOUNCE_OFF_MS = 1000; // ms below threshold before overlay hides
  const STORAGE_KEY = "threshold";
  const ENABLED_KEY = "enabled";
  const MINIMIZED_KEY = "minimized";
  const POSITION_KEY = "panelPosition";
  const TITLE_PREFIX = "\u26A0 LOUD - ";

  // --- State ---
  let thresholdDb = DEFAULT_THRESHOLD_DB;
  let enabled = true;
  let audioContext = null;
  let analyser = null;
  let timeDomainData = null;
  let pollTimer = null;
  let micStream = null;
  let loudStartTime = null;
  let overlayVisible = false;
  let overlayOffTimer = null;
  let originalTitle = null;

  // --- DOM refs (set in buildUI) ---
  let controlPanel = null, overlayEl = null, sliderEl = null;
  let dbValueEl = null, meterFillEl = null, meterThresholdEl = null;
  let levelValueEl = null, statusEl = null, statusDotEl = null;
  let toggleBtn = null, minBtn = null;

  // --- Audio Processing ---

  /** Compute RMS of analyser buffer -> dBFS (negative; 0 = max). */
  function measureLevel() {
    analyser.getFloatTimeDomainData(timeDomainData);

    let sumSquares = 0;
    for (let i = 0; i < timeDomainData.length; i++) {
      const sample = timeDomainData[i];
      sumSquares += sample * sample;
    }

    const rms = Math.sqrt(sumSquares / timeDomainData.length);

    if (rms === 0) return -Infinity;
    return 20 * Math.log10(rms);
  }

  // --- Tab Title Manager (ADR-006) ---

  function setTitleAlerting() {
    if (originalTitle === null) {
      originalTitle = document.title;
    }
    if (!document.title.startsWith(TITLE_PREFIX)) {
      document.title = TITLE_PREFIX + originalTitle;
    }
  }

  function clearTitleAlerting() {
    if (originalTitle !== null) {
      document.title = originalTitle;
      originalTitle = null;
    }
  }

  // --- Badge Messaging (ADR-006) ---

  function sendAlertState(alerting) {
    try {
      chrome.runtime.sendMessage({ type: "VOLUME_ALERT_STATE", alerting }).catch(() => {});
    } catch (_) {
      // Service worker may be inactive
    }
  }

  // --- Overlay Toggle with Debounce ---

  function showOverlay() {
    if (overlayEl) overlayEl.classList.add("visible");
    overlayVisible = true;
    if (statusDotEl) statusDotEl.classList.add("alerting");
    setTitleAlerting();
    sendAlertState(true);
  }

  function hideOverlay() {
    if (overlayEl) overlayEl.classList.remove("visible");
    overlayVisible = false;
    if (statusDotEl) statusDotEl.classList.remove("alerting");
    clearTitleAlerting();
    sendAlertState(false);
  }

  /** Main polling loop — runs every POLL_INTERVAL_MS. */
  function tick() {
    if (!enabled) {
      if (overlayVisible) hideOverlay();
      if (meterFillEl) {
        meterFillEl.style.width = "0%";
        meterFillEl.classList.remove("warn");
      }
      if (levelValueEl) {
        levelValueEl.textContent = "-- dB";
        levelValueEl.classList.remove("warn");
      }
      loudStartTime = null;
      return;
    }

    const dB = measureLevel();
    const isLoud = dB > thresholdDb;

    /* --- Update meter bar --- */
    if (meterFillEl) {
      const pct = Math.max(0, Math.min(100, ((dB - SLIDER_MIN_DB) / (SLIDER_MAX_DB - SLIDER_MIN_DB)) * 100));
      meterFillEl.style.width = pct + "%";
      meterFillEl.classList.toggle("warn", isLoud);
    }

    /* --- Update live level readout --- */
    if (levelValueEl) {
      const displayDb = dB === -Infinity ? "--" : Math.round(dB);
      levelValueEl.textContent = displayDb + " dB";
      levelValueEl.classList.toggle("warn", isLoud);
    }

    /* --- Debounce logic for overlay --- */
    if (isLoud) {
      // Clear any pending hide timer
      if (overlayOffTimer) {
        clearTimeout(overlayOffTimer);
        overlayOffTimer = null;
      }

      if (!loudStartTime) {
        loudStartTime = Date.now();
      }

      if (!overlayVisible && Date.now() - loudStartTime > DEBOUNCE_ON_MS) {
        showOverlay();
      }
    } else {
      loudStartTime = null;

      if (overlayVisible && !overlayOffTimer) {
        overlayOffTimer = setTimeout(() => {
          hideOverlay();
          overlayOffTimer = null;
        }, DEBOUNCE_OFF_MS);
      }
    }
  }

  // --- Mic Initialization ---

  async function initMic() {
    try {
      micStream = await navigator.mediaDevices.getUserMedia({ audio: true });

      audioContext = new AudioContext();
      const source = audioContext.createMediaStreamSource(micStream);

      analyser = audioContext.createAnalyser();
      analyser.fftSize = FFT_SIZE;
      source.connect(analyser);

      timeDomainData = new Float32Array(analyser.fftSize);

      setStatus("Monitoring mic");
      pollTimer = setInterval(tick, POLL_INTERVAL_MS);
    } catch (err) {
      handleMicError(err);
    }
  }

  function handleMicError(err) {
    if (err.name === "NotAllowedError" || err.name === "PermissionDeniedError") {
      setStatus("Microphone access denied. Grant permission and reload.", true);
    } else if (err.name === "NotFoundError") {
      setStatus("No microphone found.", true);
    } else {
      setStatus("Mic error: " + err.message, true);
    }

    if (sliderEl) sliderEl.disabled = true;
  }

  // --- Storage ---

  function loadSettings() {
    chrome.storage.sync.get([STORAGE_KEY, ENABLED_KEY, MINIMIZED_KEY, POSITION_KEY], (result) => {
      if (result[STORAGE_KEY] != null) {
        thresholdDb = Number(result[STORAGE_KEY]);
      }
      if (result[ENABLED_KEY] != null) {
        enabled = result[ENABLED_KEY];
      }
      if (sliderEl) {
        sliderEl.value = thresholdDb;
      }
      updateDbLabel();
      updateToggleUI();

      // ADR-007: restore minimized state
      if (result[MINIMIZED_KEY] && controlPanel && minBtn) {
        controlPanel.classList.add("minimized");
        minBtn.textContent = "+";
      }

      // Restore panel position
      if (result[POSITION_KEY] && controlPanel) {
        const pos = result[POSITION_KEY];
        const maxX = window.innerWidth - 40;
        const maxY = window.innerHeight - 40;
        controlPanel.style.left = Math.max(0, Math.min(pos.x, maxX)) + "px";
        controlPanel.style.top = Math.max(0, Math.min(pos.y, maxY)) + "px";
      }
    });
  }

  function saveThreshold(value) {
    chrome.storage.sync.set({ [STORAGE_KEY]: value });
  }

  function saveEnabled(value) {
    chrome.storage.sync.set({ [ENABLED_KEY]: value });
  }

  function saveMinimized(value) {
    chrome.storage.sync.set({ [MINIMIZED_KEY]: value });
  }

  function savePosition(x, y) {
    chrome.storage.sync.set({ [POSITION_KEY]: { x, y } });
  }

  // --- UI Construction ---

  function updateDbLabel() {
    if (dbValueEl) {
      dbValueEl.textContent = thresholdDb + " dB";
    }
    if (meterThresholdEl) {
      const pct = ((thresholdDb - SLIDER_MIN_DB) / (SLIDER_MAX_DB - SLIDER_MIN_DB)) * 100;
      meterThresholdEl.style.left = Math.max(0, Math.min(100, pct)) + "%";
    }
  }

  function setStatus(msg, isError = false) {
    if (!statusEl) return;
    statusEl.textContent = msg;
    statusEl.classList.toggle("error", isError);
  }

  function updateToggleUI() {
    if (!toggleBtn) return;
    toggleBtn.textContent = enabled ? "ON" : "OFF";
    toggleBtn.classList.toggle("off", !enabled);
    if (controlPanel) {
      controlPanel.classList.toggle("disabled", !enabled);
    }
    if (statusDotEl) {
      statusDotEl.classList.toggle("off", !enabled);
    }
  }

  function buildUI() {
    /* --- Control Panel --- */
    controlPanel = document.createElement("div");
    controlPanel.id = "vol-control-panel";

    const iconUrl = chrome.runtime.getURL("icons/icon16.png");

    controlPanel.innerHTML = `
      <div class="vol-header">
        <span class="vol-title">
          <img class="vol-title-icon" src="${iconUrl}" alt="" />
          <span class="vol-title-text">QuietCue</span>
          <span class="vol-status-dot" title="Monitoring"></span>
        </span>
        <div class="vol-header-actions">
          <button class="vol-toggle-btn" aria-label="Toggle monitoring on or off">ON</button>
          <button class="vol-minimize-btn" aria-label="Minimize panel">&minus;</button>
        </div>
      </div>
      <div class="vol-body">
        <label for="vol-threshold">Threshold</label>
        <div class="vol-slider-row">
          <input
            type="range"
            id="vol-threshold"
            min="${SLIDER_MIN_DB}"
            max="${SLIDER_MAX_DB}"
            step="1"
            value="${thresholdDb}"
            aria-label="Volume threshold in decibels"
          />
          <span class="vol-db-value" id="vol-db-value">${thresholdDb} dB</span>
        </div>
        <div class="vol-slider-hints">
          <span>&#9664; More sensitive</span>
          <span>Less sensitive &#9654;</span>
        </div>
        <div class="vol-recommended">Recommended: ${DEFAULT_THRESHOLD_DB} dB</div>
        <div class="vol-level-row">
          <span class="vol-level-label">Level</span>
          <span class="vol-level-value" id="vol-level-value">-- dB</span>
        </div>
        <div class="vol-meter">
          <div class="vol-meter-fill"></div>
          <div class="vol-meter-threshold"></div>
        </div>
        <div class="vol-status">Initializing&hellip;</div>
      </div>
    `;

    document.body.appendChild(controlPanel);

    /* --- Cache references --- */
    sliderEl = controlPanel.querySelector("#vol-threshold");
    dbValueEl = controlPanel.querySelector("#vol-db-value");
    meterFillEl = controlPanel.querySelector(".vol-meter-fill");
    meterThresholdEl = controlPanel.querySelector(".vol-meter-threshold");
    levelValueEl = controlPanel.querySelector("#vol-level-value");
    statusEl = controlPanel.querySelector(".vol-status");
    statusDotEl = controlPanel.querySelector(".vol-status-dot");

    /* --- Slider event --- */
    sliderEl.addEventListener("input", () => {
      thresholdDb = Number(sliderEl.value);
      updateDbLabel();
      saveThreshold(thresholdDb);
    });

    /* --- On/Off toggle --- */
    toggleBtn = controlPanel.querySelector(".vol-toggle-btn");
    toggleBtn.addEventListener("click", () => {
      enabled = !enabled;
      updateToggleUI();
      saveEnabled(enabled);
    });

    /* --- Minimize toggle (ADR-007: persisted) --- */
    minBtn = controlPanel.querySelector(".vol-minimize-btn");
    minBtn.addEventListener("click", () => {
      const isMinimized = controlPanel.classList.toggle("minimized");
      minBtn.textContent = isMinimized ? "+" : "\u2212";
      saveMinimized(isMinimized);
    });

    /* --- Drag to move --- */
    initDrag();

    /* --- Red Overlay --- */
    overlayEl = document.createElement("div");
    overlayEl.id = "vol-overlay";
    overlayEl.innerHTML = `
      <div class="vol-overlay-bg"></div>
      <div class="vol-overlay-bar-top"></div>
      <div class="vol-overlay-bar-bottom"></div>
      <div class="vol-warning-box">
        <div aria-live="assertive" role="alert">
          You are speaking too loudly
        </div>
        <div class="vol-warning-subtitle">Lower your voice or adjust the threshold</div>
      </div>
    `;

    document.body.appendChild(overlayEl);
  }

  // --- Drag to Move ---

  function initDrag() {
    const header = controlPanel.querySelector(".vol-header");
    let isDragging = false;
    let dragStartX = 0;
    let dragStartY = 0;
    let panelStartX = 0;
    let panelStartY = 0;
    let hasMoved = false;

    header.addEventListener("mousedown", (e) => {
      // Don't drag when clicking buttons
      if (e.target.closest("button")) return;

      isDragging = true;
      hasMoved = false;
      dragStartX = e.clientX;
      dragStartY = e.clientY;

      const rect = controlPanel.getBoundingClientRect();
      panelStartX = rect.left;
      panelStartY = rect.top;

      controlPanel.classList.add("dragging");
      e.preventDefault();
    });

    document.addEventListener("mousemove", (e) => {
      if (!isDragging) return;

      const dx = e.clientX - dragStartX;
      const dy = e.clientY - dragStartY;

      if (!hasMoved && Math.abs(dx) < 3 && Math.abs(dy) < 3) return;
      hasMoved = true;

      const maxX = window.innerWidth - controlPanel.offsetWidth;
      const maxY = window.innerHeight - controlPanel.offsetHeight;
      const newX = Math.max(0, Math.min(panelStartX + dx, maxX));
      const newY = Math.max(0, Math.min(panelStartY + dy, maxY));

      controlPanel.style.left = newX + "px";
      controlPanel.style.top = newY + "px";
    });

    document.addEventListener("mouseup", () => {
      if (!isDragging) return;
      isDragging = false;
      controlPanel.classList.remove("dragging");

      if (hasMoved) {
        const rect = controlPanel.getBoundingClientRect();
        savePosition(rect.left, rect.top);
      }
    });
  }

  // --- Cleanup ---

  function cleanup() {
    if (pollTimer) {
      clearInterval(pollTimer);
      pollTimer = null;
    }
    if (audioContext) {
      audioContext.close().catch(() => {});
      audioContext = null;
    }
    clearTitleAlerting();
    sendAlertState(false);
  }

  // --- Bootstrap ---

  function init() {
    buildUI();
    loadSettings();
    initMic();

    window.addEventListener("beforeunload", cleanup);
  }

  // Ensure the DOM is ready (run_at: document_end should guarantee this)
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
