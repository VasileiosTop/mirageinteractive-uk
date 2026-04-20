import { defineConfig } from 'astro/config';
import tailwind from '@astrojs/tailwind';
import sitemap from '@astrojs/sitemap';

export default defineConfig({
  site: 'https://mirageinteractive.uk',
  integrations: [
    tailwind({ applyBaseStyles: false }),
    sitemap({ filter: (page) => !page.includes('/products/mirage-lumen-thanks') }),
  ],
  build: { format: 'file' },
  compressHTML: true,
});
