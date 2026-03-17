# qti-convert-core — Agent Instructions

## Purpose

This package contains the reusable QTI conversion and transformation pipeline shared by the CLI, browser import, and TAO PCI conversion layers.

Exports of interest:

- `qti-convert`
- `qti-convert-node`
- `qti-loader`
- `qti-transformer`
- `qti-helper`
- `qti-helper-node`

## Core principle: keep this layer generic

Changes in this package should represent generic QTI conversion/transform behavior.

Do not move package-hosting quirks, browser cache behavior, or TAO-specific compatibility hacks into this package unless they are truly generic transformation concerns.

Examples:

- TAO legacy PCI conversion belongs in `qti-convert-tao-pci`
- browser ZIP import/runtime-prep issues belong in `qti-browser-import`
- spec-aligned PCI XML transforms belong here

## Decision rules

### When to change `qti-transformer`

Use this package when the fix is about:

- transforming QTI XML structure
- normalizing generic PCI configuration
- object/media/style transformations
- conversion helpers that should behave the same in node and browser consumers

### When not to change it

Do not use this package to solve:

- `/__qti_pkg__/...` URL problems
- service worker / CacheStorage behavior
- ZIP root rebasing
- TAO-only module/runtime asset bundling

Those are higher-level integration concerns.

## Testing rules

- Prefer unit tests next to the transformer being changed.
- If a regression was discovered through a higher-level package, add a narrow test there too, but keep the generic contract covered here when applicable.
- Before widening CI expectations, check whether the relevant package baseline is already green. Do not silently wire a permanently red suite into CI.

## Current caution

This package already has some existing test instability around `configure-pci`. If you touch that area, verify whether failures are new or pre-existing before changing CI or making broad claims about breakage.
