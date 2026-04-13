# Changelog

## 0.4.11 (qti-convert-local-ai)

### Fixed

- **Google Forms parser**: Updated extraction logic to support multiple data patterns. Google Forms HTML no longer consistently uses `FB_PUBLIC_LOAD_DATA_` variable. The parser now tries multiple extraction patterns including:
  - `FB_PUBLIC_LOAD_DATA_ = [...]` (original pattern)
  - `var FB_PUBLIC_LOAD_DATA_ = [...]` (with var keyword)
  - Fallback pattern that searches for the form data structure directly
- Improved error message when form data cannot be extracted

## 0.4.0

This release introduces a multi-package publish setup for the `qti-convert` repository and updates the recommended installation and CLI usage.

### Highlights

- The repository is now published as 4 packages:
  - `@citolab/qti-convert`
  - `@citolab/qti-convert-cli`
  - `@citolab/qti-browser-import`
  - `@citolab/qti-convert-tao-pci`
- Package versions are now aligned and intended to be released together.
- A workspace publish flow was added for synchronized versioning and publishing.

### Package changes

- `@citolab/qti-convert`
  - remains the core API package for QTI conversion, transformation, loader utilities, and helper modules
- `@citolab/qti-convert-cli`
  - is now the package that publishes the CLI commands
- `@citolab/qti-browser-import`
  - provides browser-side QTI package import, cache URL rewriting, and PCI-related browser helpers
- `@citolab/qti-convert-tao-pci`
  - provides TAO PCI conversion helpers and bundled runtime assets

### CLI usage change

CLI commands should now be run from `@citolab/qti-convert-cli` instead of `@citolab/qti-convert`.

Old:

```sh
npx -p=@citolab/qti-convert qti-convert-pkg yourpackage.zip
```

New:

```sh
npx --package=@citolab/qti-convert-cli qti-convert-pkg yourpackage.zip
```

The same applies to:

- `qti-convert-folder`
- `qti-create-manifest`
- `qti-create-assessment`
- `qti-strip-media-pkg`

### Tooling

- Added `publish:all` to publish all packages with the same version
- Added `publish:all:dry-run` for release validation
- Removed `np` from the release workflow

### Documentation

- Updated the root README to reflect the multi-package setup
- Added missing README files for all published packages
