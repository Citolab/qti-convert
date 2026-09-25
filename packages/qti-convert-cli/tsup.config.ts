import { defineConfig } from 'tsup';

export default defineConfig({
  entry: [
    'src/qti-convert-cli/qti-convert-pkg.ts',
    'src/qti-convert-cli/qti-convert-pkg-qti21.ts',
    'src/qti-convert-cli/qti-fix-references-pkg.ts',
    'src/qti-convert-cli/qti-convert-folder.ts',
    'src/qti-convert-cli/qti-package-manifest.ts',
    'src/qti-convert-cli/qti-package-assessment.ts',
    'src/qti-convert-cli/qti-strip-media-pkg.ts',
    'src/qti-convert-cli/qti-package.ts',
    'src/qti-convert-cli/qti-package-per-item.ts',
    'src/qti-convert-cli/qti-export-docx.ts'
  ],
  format: ['esm'],
  target: 'node16',
  dts: false, // Skip DTS for now
  sourcemap: 'inline',
  splitting: true,
  bundle: true,
  clean: true,
  external: ['@citolab/qti-convert', '@citolab/qti-convert-export'],
  outExtension() {
    return {
      js: `.mjs`
    };
  },
  define: {
    'process.env.NODE_ENV': JSON.stringify(process.env.NODE_ENV || 'production')
  }
});
