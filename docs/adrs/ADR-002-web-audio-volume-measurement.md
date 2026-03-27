# ADR-002: Web Audio API for Volume Measurement

## Status

Accepted

## Context

We need to measure the user's microphone volume in real time to compare against a threshold. Several approaches exist:

1. **Web Audio API (`AudioContext` + `AnalyserNode`)** — standard browser API, well-supported, allows real-time frequency and time-domain analysis.
2. **`AudioWorklet`** — runs audio processing in a dedicated thread. More performant for heavy DSP, but adds complexity (separate worklet file, message passing).
3. **`MediaRecorder` + manual analysis** — captures audio chunks, then analyzes. Introduces latency due to chunk-based processing.
4. **Third-party library** (e.g., Meyda, Tone.js) — adds dependencies and bundle size for features we don't need.

Our requirement is simple: compute RMS amplitude every ~100ms and convert to dBFS. This is a trivial computation that does not warrant heavy infrastructure.

## Decision

Use the **Web Audio API** with `AudioContext`, `MediaStreamSource`, and `AnalyserNode`.

**Pipeline:**
```
getUserMedia({audio:true}) → MediaStream
  → audioContext.createMediaStreamSource(stream)
  → audioContext.createAnalyserNode({fftSize: 2048})
  → getFloatTimeDomainData() every ~100ms via setInterval
  → RMS = sqrt(sum(sample²) / N)
  → dBFS = 20 * log10(RMS)
```

**Configuration:**
- `fftSize`: 2048 (provides ~42ms window at 48kHz — sufficient resolution)
- Polling interval: 100ms via `setInterval`
- No connection to `audioContext.destination` (no playback)

**dBFS scale:**
- 0 dBFS = maximum possible amplitude (sample value of 1.0)
- Typical speech: -30 to -15 dBFS
- Silence: -Infinity (clamped for display)
- Default threshold: -20 dBFS

## Consequences

**What becomes easier:**
- Zero dependencies — Web Audio API is built into all modern browsers.
- Simple, synchronous data retrieval (`getFloatTimeDomainData` fills a pre-allocated buffer).
- Well-understood API with extensive documentation and browser support.
- Lightweight — the `setInterval` + RMS computation costs negligible CPU.

**What becomes harder:**
- `setInterval` is not perfectly precise (can drift under load), but 100ms granularity is more than sufficient for volume alerts.
- If we later need frequency analysis (e.g., detecting specific sounds), we'd use `getFloatFrequencyData` from the same `AnalyserNode` — no architecture change needed.
- Raw dBFS values vary by hardware gain. Users must manually calibrate via the slider. Auto-calibration is deferred (see spec §Calibration).

**Tradeoffs:**
- `AnalyserNode` over `AudioWorklet`: We trade maximum precision/timing for simplicity. An `AudioWorklet` would give per-sample processing, but our 100ms polling is more than adequate for a "you're too loud" alert.
- `setInterval` over `requestAnimationFrame`: We don't need frame-aligned updates. `setInterval` runs even when the tab is backgrounded (important if Meet is in a non-focused tab), though Chrome may throttle it to 1s in background tabs.
