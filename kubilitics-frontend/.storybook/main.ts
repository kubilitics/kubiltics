import type { StorybookConfig } from '@storybook/react-vite';
import path from 'path';

const config: StorybookConfig = {
  stories: ['../src/**/*.mdx', '../src/**/*.stories.@(js|jsx|mjs|ts|tsx)'],

  addons: [
    '@storybook/addon-essentials',
    '@storybook/addon-a11y',
    '@storybook/addon-links',
  ],

  framework: {
    name: '@storybook/react-vite',
    options: {},
  },

  viteFinal: async (config) => {
    // Mirror the path aliases from the main vite.config.ts so component
    // imports like `@/lib/utils` resolve correctly inside stories.
    config.resolve ??= {};
    config.resolve.alias = {
      ...config.resolve.alias,
      '@': path.resolve(__dirname, '../src'),
      '@components': path.resolve(__dirname, '../src/components'),
      '@features': path.resolve(__dirname, '../src/features'),
      '@hooks': path.resolve(__dirname, '../src/hooks'),
      '@stores': path.resolve(__dirname, '../src/stores'),
      '@services': path.resolve(__dirname, '../src/services'),
      '@types': path.resolve(__dirname, '../src/types'),
      '@utils': path.resolve(__dirname, '../src/utils'),
      '@lib': path.resolve(__dirname, '../src/lib'),
      '@i18n': path.resolve(__dirname, '../src/i18n'),
      // Mock Tauri APIs in Storybook (browser context)
      '@tauri-apps/api/core': path.resolve(__dirname, '../src/mocks/tauri-core.ts'),
    };

    return config;
  },

  docs: {
    autodocs: 'tag',
  },

  typescript: {
    reactDocgen: 'react-docgen-typescript',
    reactDocgenTypescriptOptions: {
      shouldExtractLiteralValuesFromEnum: true,
      shouldRemoveUndefinedFromOptional: true,
      propFilter: (prop) =>
        prop.parent ? !/node_modules\/(?!@radix-ui)/.test(prop.parent.fileName) : true,
    },
  },
};

export default config;
