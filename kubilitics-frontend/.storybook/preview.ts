import type { Preview } from '@storybook/react';
import '../src/index.css';

const preview: Preview = {
  parameters: {
    controls: {
      matchers: {
        color: /(background|color)$/i,
        date: /Date$/i,
      },
    },

    backgrounds: {
      default: 'light',
      values: [
        { name: 'light', value: 'hsl(210 50% 98.5%)' },
        { name: 'dark', value: 'hsl(224 71% 4%)' },
        { name: 'white', value: '#ffffff' },
      ],
    },

    viewport: {
      viewports: {
        mobile: { name: 'Mobile', styles: { width: '375px', height: '812px' } },
        tablet: { name: 'Tablet', styles: { width: '768px', height: '1024px' } },
        desktop: { name: 'Desktop', styles: { width: '1440px', height: '900px' } },
        wide: { name: 'Wide', styles: { width: '1920px', height: '1080px' } },
      },
    },

    layout: 'centered',
  },

  decorators: [
    (Story, context) => {
      // Apply dark class to the root when dark background is selected
      const isDark = context.globals.backgrounds?.value === 'hsl(224 71% 4%)';
      document.documentElement.classList.toggle('dark', isDark);

      return Story();
    },
  ],

  globalTypes: {
    theme: {
      description: 'Color theme',
      toolbar: {
        title: 'Theme',
        icon: 'paintbrush',
        items: [
          { value: 'light', title: 'Light', icon: 'sun' },
          { value: 'dark', title: 'Dark', icon: 'moon' },
        ],
        dynamicTitle: true,
      },
    },
  },

  initialGlobals: {
    theme: 'light',
  },

  tags: ['autodocs'],
};

export default preview;
