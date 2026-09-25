# @citolab/qti-convert-cli

Command line tools for converting and preparing QTI packages.

## Install

```sh
npm install @citolab/qti-convert-cli
```

## Commands

Convert a zip package:

```sh
npx --package=@citolab/qti-convert-cli qti-convert-pkg yourpackage.zip
```

Move content that several items share (e.g. a reading passage) into shared stimuli while converting:

```sh
npx --package=@citolab/qti-convert-cli qti-convert-pkg yourpackage.zip --extract-stimuli
```

Convert all zip packages in a folder:

```sh
npx --package=@citolab/qti-convert-cli qti-convert-pkg /path/to/folder-with-zips
```

Convert a QTI 3 zip package (or a folder with zips) back to QTI 2.1:

```sh
npx --package=@citolab/qti-convert-cli qti-convert-pkg-qti21 yourpackage.zip
```

Repair broken file references (images, stylesheets, templates, ...) in a QTI 2.x or 3 zip package (or a folder with
zips); writes `yourpackage-fixed.zip` and lists what was fixed and what wasn't found:

```sh
npx --package=@citolab/qti-convert-cli qti-fix-references-pkg yourpackage.zip
```

Convert a folder:

```sh
npx --package=@citolab/qti-convert-cli qti-convert-folder yourfolder
```

Create or update a manifest:

```sh
npx --package=@citolab/qti-convert-cli qti-create-manifest yourfolder
```

Create an assessment test:

```sh
npx --package=@citolab/qti-convert-cli qti-create-assessment yourfolder
```

Strip media from a package:

```sh
npx --package=@citolab/qti-convert-cli qti-strip-media-pkg yourpackage.zip
```

## License

GPL-3.0-only
