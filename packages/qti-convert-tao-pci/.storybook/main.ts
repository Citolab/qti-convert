import fs from 'node:fs';
import path from 'node:path';
import type { StorybookConfig } from '@storybook/web-components-vite';

const defaultComponentsCdnDir = '/Users/marcelhoekstra/repos/qti-components/cdn';
const defaultComponentsDistDir = '/Users/marcelhoekstra/repos/qti-components/dist';
const localComponentsCdnDir = process.env.QTI_COMPONENTS_CDN_DIR || defaultComponentsCdnDir;
const localComponentsDistDir = process.env.QTI_COMPONENTS_DIST_DIR || defaultComponentsDistDir;

const staticDirs: NonNullable<StorybookConfig['staticDirs']> = [
  { from: '../public', to: '/' },
  { from: '../storybook-assets', to: '/external-pci' },
];

if (localComponentsCdnDir && fs.existsSync(localComponentsCdnDir)) {
  staticDirs.push({ from: localComponentsCdnDir, to: '/local-qti-components-cdn' });
}
if (localComponentsDistDir && fs.existsSync(localComponentsDistDir)) {
  staticDirs.push({ from: localComponentsDistDir, to: '/local-qti-components-dist' });
}

const config: StorybookConfig = {
  stories: ['../src/**/*.stories.@(ts|tsx|js|jsx|mjs)'],
  addons: ['@storybook/addon-docs', '@storybook/addon-a11y', '@storybook/addon-vitest'],
  framework: {
    name: '@storybook/web-components-vite',
    options: {},
  },
  staticDirs,
  docs: {
    defaultName: 'Docs',
  },
  viteFinal: async (cfg) => {
    cfg.resolve = cfg.resolve || {};
    cfg.resolve.alias = {
      ...(cfg.resolve.alias || {}),
      path: path.resolve(process.cwd(), '../../node_modules/path-browserify/index.js'),
    };
    return cfg;
  },
};

export default config;
