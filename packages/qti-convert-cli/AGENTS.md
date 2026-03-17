# qti-convert-cli — Agent Instructions

## Purpose

This package exposes the command-line entry points around `@citolab/qti-convert`.

Main commands:

- `qti-convert-pkg`
- `qti-convert-folder`
- `qti-create-manifest`
- `qti-create-assessment`
- `qti-strip-media-pkg`

## Core principle: keep the CLI thin

The CLI should mainly:

- parse command arguments
- call the right core APIs
- report useful errors
- write files in the expected layout

Do not duplicate conversion logic here if the behavior belongs in `qti-convert-core`, `qti-convert-tao-pci`, or `qti-browser-import`.

## Decision rules

- If a fix is about XML transformation or package semantics, change the underlying library package.
- If a fix is about command shape, file IO, argument handling, or user-facing error reporting, change this package.

## Testing rules

- Add small focused tests for dependency/entry-point behavior when the CLI wiring changes.
- Avoid coupling CLI tests to large end-to-end fixture packages unless the CLI boundary itself is what you are validating.
