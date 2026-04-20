import { defineConfig } from 'astro/config';
import tailwind from '@astrojs/tailwind';

export default defineConfig({
  site: 'https://mirageinteractive.uk',
  integrations: [tailwind({ applyBaseStyles: false })],
  build: { format: 'file' },
  compressHTML: true,
});
