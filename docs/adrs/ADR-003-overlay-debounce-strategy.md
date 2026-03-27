# ADR-003: Overlay Debounce Strategy

## Status

Accepted

## Context

Microphone volume is noisy. Brief spikes (coughs, plosives, paper shuffling) can momentarily exceed the threshold without meaning the user is "speaking too loudly." Conversely, once the overlay appears, it should not flicker off during brief pauses between words.

Without debounce logic, the overlay would rapidly toggle on/off multiple times per second, creating an unusable and distracting experience.

We need a strategy that:
1. Ignores transient spikes shorter than a human phrase.
2. Keeps the overlay stable once shown.
3. Dismisses the overlay only after sustained quiet.
4. Has no perceptible delay for genuinely sustained loud speech.

## Decision

Use a **dual-timer debounce** with two independent delays:

### Activation delay: 300ms
- Volume must **continuously exceed** the threshold for 300ms before the overlay appears.
- Any dip below threshold during this window resets the timer.
- Rationale: 300ms filters out coughs and transient noise while still feeling responsive for sustained loud speech.

### Deactivation delay: 1000ms
- Once the overlay is showing, volume must stay **continuously below** the threshold for 1000ms before the overlay hides.
- Any spike above threshold during this window resets the deactivation timer.
- Rationale: 1000ms covers natural pauses between sentences, preventing flicker during normal (loud) conversation.

### State machine

```
         volume > threshold
         for 300ms
  IDLE ──────────────────────▶ ALERTING
   ▲                              │
   │    volume < threshold        │
   │    for 1000ms                │
   └──────────────────────────────┘
```

### Implementation approach

```typescript
interface ThresholdEngine {
  evaluate(currentDb: number, thresholdDb: number, now: number): boolean;
  reset(): void;
}
```

Internal state tracked:
- `loudStart: number | null` — timestamp when volume first exceeded threshold
- `quietStart: number | null` — timestamp when volume first dropped below threshold
- `overlayActive: boolean` — current overlay state

The `evaluate()` function is called every ~100ms from the main loop. It is a **pure function of its inputs plus internal state** — no DOM access, no side effects, fully unit-testable.

## Consequences

**What becomes easier:**
- Clean separation: the `ThresholdEngine` is pure logic with no UI coupling.
- Easy to unit test with synthetic timestamp sequences.
- Configurable: both delays are constants that can be tuned without code changes.

**What becomes harder:**
- The 300ms activation delay means very brief shouts (< 300ms) will not trigger the overlay. This is intentional — a sub-300ms spike is likely not sustained loud speech.
- The 1000ms deactivation delay means the overlay lingers slightly after the user quiets down. This is a UX tradeoff: stability over instant dismissal.

**Alternatives rejected:**
- **No debounce**: Causes severe flicker. Unusable.
- **Single shared timer**: Can't independently tune activation vs. deactivation responsiveness.
- **Exponential moving average (EMA) smoothing**: Adds complexity and makes the threshold less intuitive (the slider value no longer maps directly to a dB cutoff). Could be revisited if users report the hard cutoff feels too abrupt.
