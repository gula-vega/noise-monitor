# ADR-004: Plain JavaScript with No Build Step

## Status

Accepted

## Context

Modern web projects commonly use build tools (Webpack, Vite, Rollup, esbuild) and transpilers (TypeScript, Babel). We need to decide whether to introduce a build toolchain for this extension.

Factors:
- The extension consists of **one content script, one CSS file, and a manifest** — approximately 200-400 lines of JavaScript total.
- Chrome's V8 engine natively supports all ES2020+ features we need (async/await, optional chaining, nullish coalescing, etc.).
- There is no npm dependency — we use only browser-native APIs (`Web Audio`, `chrome.storage`, DOM).
- The spec explicitly states: "No build step required (plain JS/CSS)."

## Decision

Use **plain JavaScript and CSS** with no build step, no bundler, and no transpiler.

- All source files are directly loadable by Chrome as-is.
- No `package.json` is required for the extension itself (one may exist for dev tooling like test runners).
- Development workflow: edit files → reload extension in `chrome://extensions`.
- Packaging: `zip -r noise-monitor.zip manifest.json content_script.js overlay.css icons/ popup.html popup.js _locales/`.

## Consequences

**What becomes easier:**
- Zero build configuration to maintain or debug.
- Instant feedback loop: save file → reload extension → test.
- Any developer can contribute without learning a build system.
- No dependency supply chain risk (no `node_modules`).
- Smaller extension package size.

**What becomes harder:**
- No TypeScript — type safety is limited to JSDoc annotations and editor inference. Interfaces documented in `docs/architecture/overview.md` serve as the contract.
- No tree-shaking or minification. Acceptable at this scale (< 500 lines).
- If the codebase grows significantly (e.g., options page, multiple content scripts, shared utilities), a bundler may become justified. This ADR would be superseded at that point.
- No import/export — modules must be organized within a single file or use IIFEs. At current size, a single `content_script.js` with well-separated functions is sufficient.

**Mitigations:**
- Use JSDoc `@typedef` and `@param` annotations to document interfaces in code.
- Keep `content_script.js` under 500 lines by extracting pure logic functions (threshold engine, RMS computation) as clearly named functions at the top of the file.
- A `package.json` with Jest can still be added for unit testing without requiring a build step for the extension itself.
