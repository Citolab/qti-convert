# qti-browser-import — Agent Instructions

## Purpose

This package imports QTI ZIP packages directly in the browser, stores their files in CacheStorage under `/__qti_pkg__/...`, and prepares imported QTI items/tests so they can render correctly with `qti-components`.

## Core principle: fix browser-hosted package behavior here

If a package works when hosted on a server but fails after browser-side import, the fix usually belongs here.

Typical responsibilities of this package:

- ZIP path rebasing and cache key generation
- preserving source XML during browser-side repair/parsing
- deciding when QTI 2 to QTI 3 conversion should or should not run
- browser-side PCI preparation for already-QTI-3 packages
- materializing runtime assets for iframe-based PCI rendering
- making package-root, item-root, and item-stem module resolution work in browser-hosted `/__qti_pkg__/...` URLs

Do not push these browser-import quirks down into `qti-components` unless the behavior is truly generic renderer behavior.

## Important rules

### 1. Do not corrupt source XML while "repairing" it

The bare-attribute repair is a compatibility shim. It must not rewrite:

- XML comments
- XML declarations
- CDATA
- doctype declarations

If a new repair rule would touch those areas, stop and redesign it.

### 2. Do not run QTI 2→3 conversion on already-QTI-3 content

QTI 3 packages should bypass the upgrader. Detection mistakes here can silently break valid packages.

### 3. Browser import must preserve package-relative path semantics

Imported ZIPs may contain a top-level folder. Cache keys must be rebased relative to the actual `imsmanifest.xml` directory, not the raw ZIP root.

### 4. PCI runtime prep must be idempotent

If this package expands PCI configuration into explicit `qti-interaction-module` entries, avoid leaving markers that cause later runtime code to overwrite the prepared result again.

### 5. Missing primary-path is not always fatal

If a module has a valid `fallback-path`, do not fail the whole import just because the `primary-path` asset is missing.

## Debugging rules

- When debugging PCI failures, inspect the prepared cached XML actually served from `/__qti_pkg__/...` before making more speculative fixes.
- Be suspicious of URL joining. Double slashes and wrong base selection are common failure modes.
- Distinguish package prep bugs from renderer bugs:
  - if the cached XML is already wrong, fix this package
  - if the cached XML is correct but the renderer still breaks, investigate `qti-components`

## Tests

Keep the focused regression tests in this package up to date. Add tests for:

- XML comment preservation
- nested package root rebasing
- QTI 3 detection
- module resolution URL joining
- `.js`/`.json` config fallback behavior
- aliased nested `module_resolution` handling

Primary files:

- `src/import-qti-package.ts`
- `src/pci-helpers.ts`
- `src/import-qti-package.test.ts`
- `src/pci-helpers.test.ts`
