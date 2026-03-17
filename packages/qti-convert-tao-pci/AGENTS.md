# qti-convert-tao-pci — Agent Instructions

## Purpose

This package converts TAO-exported QTI items that contain **Portable Custom Interactions (PCIs)** from TAO's proprietary/legacy format into the **official IMS/1EdTech QTI PCI spec** format, so they can be rendered by the standard `qti-portable-custom-interaction` component in `qti-components` without any TAO-specific knowledge in that component.

## Core principle: convert, don't patch

**Always solve TAO PCI compatibility problems here, in this conversion package.**

The `qti-portable-custom-interaction` component in `qti-components` must only implement the official QTI PCI specification. It must not contain TAO-specific logic, workarounds, or knowledge about legacy TAO internals. Keep it clean and spec-compliant.

## What TAO PCIs look like (old format)

TAO PCIs register using a legacy AMD/RequireJS API that predates the official spec:

- Module registers with `initialize(id, dom, config)` / `getSerializedState()` / `setSerializedState()` / `getResponse()` / `setResponse()`
- Module IDs use TAO-internal paths (e.g. `taoQtiItem/portableLib/...`, `OAT/util/event`)
- Properties are encoded as flat `data-*` attributes on `<qti-portable-custom-interaction>` (e.g. `data-my-property__nested-key="value"`)
- Items may contain Handlebars templates with dot-notation paths
- Items use TAO Bootstrap-derived CSS class names

## What the official spec expects (new format)

The official QTI PCI spec (IMS Global / 1EdTech) expects:

- Module registers via `qtiCustomInteractionContext.register({ getInstance(dom, configuration, state) { ... } })`
- `getInstance` returns an instance object with `getResponse()`, `setResponse()`, `getState()`, `setState()`, `checkValidity()`, `getCustomValidity()`
- Module paths declared in `<qti-interaction-modules>` / `<qti-interaction-module>` child elements
- Configuration passed as a structured `configuration.properties` object (not flat `data-*` attributes)

## How this package bridges the gap

The conversion pipeline in `src/index.ts` performs these steps:

1. **PCI XML upgrade** (`runUpgradePci`) — upgrades `<portableCustomInteraction>` (QTI 2.x) to `<qti-portable-custom-interaction>` (QTI 3) using the upstream `qti-transformer`
2. **Property rehydration** — reconstructs root-scoped `data-*` attributes from nested `<properties>` children
3. **TAO class/style conversion** — maps TAO Bootstrap class names to QTI layout classes (`grid-row` → `qti-layout-row`, etc.)
4. **Handlebars path normalization** — converts dot-notation template paths to `__`-separated flat keys
5. **Legacy config extraction** — collects all non-reserved `data-*` attributes and serialises them into `data-legacy-pci-config` JSON
6. **Module path injection** — injects `<qti-interaction-module>` entries for all known TAO internal library paths
7. **Legacy proxy generation** — emits a generated AMD proxy module (`*.legacy-pci-proxy.N.js`) that wraps the old `initialize()` API in a spec-compliant `getInstance()` facade
8. **Asset injection** — copies bundled TAO runtime assets (RequireJS, Bootstrap, portableLib modules, etc.) alongside each item

## Decision rules for new work

### When a TAO PCI does not work correctly

1. **First: fix it here.** Identify which conversion step is missing or wrong and add/fix logic in `src/index.ts` (or a new helper file in `src/`).
2. **Check if the proxy covers it.** The generated proxy in `createLegacyProxyModuleSource()` bridges the legacy `initialize` API to `getInstance`. If the TAO PCI uses a pattern not yet handled by the proxy, extend the proxy logic here.
3. **Check if bundled assets are missing.** If the TAO PCI references a library not yet bundled, add it to the bundled assets rather than changing `qti-components`.

### When modifying `qti-portable-custom-interaction` might seem necessary

Only proceed if **all** of the following are true:

- The required capability is clearly part of, or a natural extension of, the official QTI PCI spec
- The capability is useful beyond TAO (i.e. it is not TAO-specific)
- There is genuinely no way to achieve the same result through conversion/proxy code

**Always ask for user confirmation before making any changes to `qti-portable-custom-interaction` in `qti-components`.** Describe exactly what you intend to change and why conversion alone cannot solve it.

## Storybook and test rules

- End-to-end TAO PCI render checks belong in this package's Storybook stories, not in low-level unit tests.
- Prefer adding or extending `play` assertions in `src/stories/TaoPciConversion.stories.ts` when fixing runtime regressions that only show up in a browser.
- Keep Storybook CI-safe:
  - do not depend on machine-local absolute paths
  - prefer package-local `node_modules/@citolab/qti-components/{cdn,dist}` assets
  - keep `prepare-storybook-assets.mjs` tolerant of missing local override files
- Unit tests in `src/index.test.ts` should cover conversion output shape; Storybook tests should cover actual rendered PCI behavior.

## File map

| File | Purpose |
|------|---------|
| `src/index.ts` | Main `convert()` function and all conversion helpers |
| `src/bundled-assets.ts` | Inlined TAO runtime assets (RequireJS, Bootstrap, portableLib, etc.) |
| `src/index.test.ts` | Unit tests for the conversion pipeline |
| `src/stories/TaoPciConversion.stories.ts` | Storybook story for end-to-end visual testing |

## Key data-* attributes used on `<qti-portable-custom-interaction>`

These are set by this package during conversion and consumed by `qti-portable-custom-interaction` at runtime:

| Attribute | Meaning |
|-----------|---------|
| `data-legacy-pci-proxy` | `"1"` when the legacy proxy module has been injected |
| `data-legacy-pci-config` | JSON-serialised config built from the original `data-*` property attributes |
| `data-require-paths` | JSON map of AMD module IDs → relative paths |
| `data-use-default-shims` | `"true"` to apply RequireJS shim defaults in the renderer |

If `qti-portable-custom-interaction` does not yet support one of these attributes, add support for it in a generic, spec-aligned way — and only after confirmation (see above).
