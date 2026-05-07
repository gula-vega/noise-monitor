# Chrome Web Store Publishing Checklist

## Prerequisites

- [ ] Chrome Developer account registered ($5 one-time fee) at https://chrome.google.com/webstore/devconsole
- [ ] Contact email set up for privacy policy and store listing

## Assets Required

### Icons (already in `src/icons/`)
- [x] `icon16.png` — 16x16 px (toolbar)
- [x] `icon48.png` — 48x48 px (extensions management page)
- [x] `icon128.png` — 128x128 px (Web Store listing, install dialog)

### Store Listing Graphics
- [ ] **Screenshots** — at least 1, recommended 3-5 (1280x800 or 640x400 px)
  - Screenshot 1: Control panel with slider on a Google Meet call
  - Screenshot 2: Red overlay warning triggered
  - Screenshot 3: Panel minimized during a call
  - Screenshot 4: Extension badge alert on another tab
  - Screenshot 5: Control panel on Microsoft Teams
- [ ] **Promotional tile** (optional but recommended)
  - Small: 440x280 px
  - Large: 920x680 px
  - Marquee: 1400x560 px

### Text
- [x] Extension name: "QuietCue — Mic Volume Alert for Meet & Teams"
- [x] Short description (see `docs/store-listing.md`)
- [x] Detailed description (see `docs/store-listing.md`)
- [x] Category: Productivity or Communication

### Privacy
- [x] Privacy policy HTML (see `src/privacy-policy.html`)
- [ ] Host privacy policy at a public URL (e.g., GitHub Pages, personal site)
- [ ] Update `contact@example.com` in privacy policy with real contact email

## Manifest Verification

Before packaging, verify `src/manifest.json` has:

- [x] `"manifest_version": 3`
- [ ] `"name"` updated to `"QuietCue — Mic Volume Alert for Meet & Teams"`
- [ ] `"description"` updated to mention Meet + Teams
- [ ] `"version"` set to target release version
- [ ] `"host_permissions"` includes all three domains:
  - `https://meet.google.com/*`
  - `https://teams.microsoft.com/*`
  - `https://teams.live.com/*`
- [ ] `"content_scripts"` matches all three domains
- [ ] `"background"` section with `"service_worker": "background.js"`
- [ ] All referenced files exist (`content_script.js`, `overlay.css`, `background.js`, `popup.html`, `popup.js`, icons)

## Code Verification

- [ ] Extension loads as unpacked without errors (`chrome://extensions`)
- [ ] No console errors on Google Meet page
- [ ] No console errors on Microsoft Teams page
- [ ] Slider adjusts threshold and persists across page reload
- [ ] ON/OFF toggle works and persists
- [ ] Minimize/expand works and persists
- [ ] Red overlay appears when speaking above threshold
- [ ] Red overlay hides when speaking below threshold
- [ ] Overlay does not block clicks (pointer-events: none)
- [ ] Extension badge shows "!" when alerting and user is on another tab
- [ ] Tab title shows warning prefix when alerting
- [ ] Badge clears when alert stops
- [ ] Tab title restores when alert stops
- [ ] Mic error handled gracefully (denied, not found)
- [ ] Panel UI does not visually conflict with Meet's controls
- [ ] Panel UI does not visually conflict with Teams' controls

## Packaging

```bash
cd src/
zip -r ../noise-monitor.zip \
  manifest.json \
  content_script.js \
  background.js \
  overlay.css \
  popup.html \
  popup.js \
  privacy-policy.html \
  icons/
```

- [ ] ZIP does not include `docs/`, `tests/`, `.DS_Store`, or any dev files
- [ ] ZIP size is reasonable (should be < 100 KB without screenshots)

## Chrome Web Store Submission

1. [ ] Go to https://chrome.google.com/webstore/devconsole
2. [ ] Click "New Item" → Upload the ZIP
3. [ ] Fill in store listing fields (copy from `docs/store-listing.md`)
4. [ ] Upload screenshots
5. [ ] Set category to "Productivity"
6. [ ] Set visibility: Public
7. [ ] Set regions: All regions (or select specific)
8. [ ] Privacy tab:
   - [ ] Declare "Uses microphone" under single purpose
   - [ ] State single purpose: "Monitor microphone volume to alert user when speaking too loudly"
   - [ ] Paste privacy policy URL
   - [ ] Declare: does NOT use remote code
   - [ ] Declare: does NOT collect user data (no analytics/telemetry)
   - [ ] Check "host_permissions" justification: "To inject volume monitoring UI into Google Meet and Microsoft Teams call pages"
9. [ ] Submit for review

## Post-Submission

- [ ] Monitor developer dashboard for review status (typically 1-3 business days)
- [ ] If rejected, read rejection reason and address the specific policy violation
- [ ] Once approved, verify listing appears correctly in the Web Store
- [ ] Test installing from the Web Store on a clean Chrome profile

## Common Rejection Reasons to Avoid

| Reason | How we avoid it |
|---|---|
| Missing privacy policy | Privacy policy included and hosted at public URL |
| Excessive permissions | Only `storage` + 3 host origins — minimal |
| Unclear single purpose | Single purpose clearly stated: mic volume alert |
| Remote code execution | No remote scripts, no eval, no CDN imports |
| Misleading description | Description accurately reflects actual functionality |
| Missing functionality | All described features are implemented |
