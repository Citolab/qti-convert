import { defineConfig } from 'tsup';

export default defineConfig({
  entry: [
    'src/qti-convert-cli/qti-convert-pkg.ts',
    'src/qti-convert-cli/qti-convert-folder.ts',
    'src/qti-convert-cli/qti-package-manifest.ts',
    'src/qti-convert-cli/qti-package-assessment.ts',
    'src/qti-convert-cli/qti-strip-media-pkg.ts',
    'src/qti-convert-cli/qti-create-package.ts',
    'src/qti-convert-cli/qti-create-package-per-item.ts'
  ],
  format: ['esm'],
  target: 'node16',
  dts: false, // Skip DTS for now
  sourcemap: 'inline',
  splitting: true,
  bundle: true,
  clean: true,
  external: ['saxon-js'],
  outExtension() {
    return {
      js: `.mjs`
    };
  },
  define: {
    'process.env.NODE_ENV': JSON.stringify(process.env.NODE_ENV || 'production')
  }
});
