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

Convert all zip packages in a folder:

```sh
npx --package=@citolab/qti-convert-cli qti-convert-pkg /path/to/folder-with-zips
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

Apache-2.0
