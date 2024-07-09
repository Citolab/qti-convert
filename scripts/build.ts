import * as fs from 'fs';
import chalk from 'chalk';
import { execSync } from 'child_process';
import { existsSync, promises as fsPromises } from 'fs';
import tsup, { Options } from 'tsup';

const command = process.argv[2];
const buildType = command === 'watch' ? 'watch' : 'build';

console.log('Building the project...');

const outdir = 'dist';

// import pkgJson from '../package.json' assert { type: 'json' };
// const peerdependencies: string[] = [];
// for (const property in pkgJson.peerDependencies) {
//   peerdependencies.push(property);
// }

// ---- the options ----

const cliOptions = {
  clean: false,
  target: 'node16',
  dts: true,
  format: ['esm'],
  sourcemap: 'inline',
  // tsconfig: '../tsconfig.node.json',
  entryPoints: [
    './src/lib/qti-convert-cli/qti-convert-pkg.ts',
    './src/lib/qti-convert-cli/qti-convert-folder.ts',
    './src/lib/qti-convert-cli/qti-package-manifest.ts',
    './src/lib/qti-convert-cli/qti-package-assessment.ts',
    './src/lib/qti-convert-cli/qti-strip-media-pkg.ts'
  ],
  splitting: true,
  bundle: true,
  skipNodeModulesBundle: false,
  outExtension() {
    return {
      js: `.mjs`
    };
  },
  esbuildPlugins: [],
  define: {
    'process.env.NODE_ENV': command == 'watch' ? '"development"' : '"production"'
  }
} as Options;

const convertOptions = {
  clean: false,
  target: 'es2017',
  dts: true,
  format: ['esm'],
  sourcemap: 'inline',
  // tsconfig: '../tsconfig.node.json',
  entry: [
    './src/lib/qti-converter/index.ts',
    './src/lib/qti-transformer/index.ts',
    './src/lib/qti-loader/index.ts',
    './src/lib/qti-helper/index.ts'
  ],
  // outDir: 'dist',
  external: ['cheerio'], // peerdependencies
  splitting: true,
  define: {
    'process.env.NODE_ENV': command == 'watch' ? '"development"' : '"production"'
  }
} as Options;

// ---- the build ----

(async () => {
  try {
    // make sure the folder is clean
    if (existsSync(outdir)) {
      await fsPromises.rm(outdir, { recursive: true });
    }
    await fsPromises.mkdir(outdir);
  } catch (err) {
    console.error(chalk.red(err));
    process.exit(1);
  }

  await buildTS(convertOptions);
  await buildTS(cliOptions);
})();

async function buildTS(options: Options) {
  return tsup
    .build(options)
    .catch(err => {
      console.error(chalk.red(err));
      process.exit(1);
    })
    .then(result => {
      console.log(result);
      console.log(chalk.green(`qti-convert has been generated at ${outdir}\n`));
    });
}
