import { defineConfig } from 'tsup';

export default defineConfig({
  entry: [
    'src/qti-converter/index.ts',
    'src/qti-converter-node/index.ts',
    'src/qti-transformer/index.ts',
    'src/qti-loader/index.ts',
    'src/qti-helper/index.ts',
    'src/qti-helper-node/index.ts'
  ],
  format: ['esm'],
  target: 'ES2022',
  dts: true,
  sourcemap: 'inline',
  external: ['cheerio', 'saxon-js'],
  splitting: true,
  clean: true,
  define: {
    'process.env.NODE_ENV': JSON.stringify(process.env.NODE_ENV || 'production')
  }
});
