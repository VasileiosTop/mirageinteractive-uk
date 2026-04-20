/** @type {import('tailwindcss').Config} */
export default {
  content: ['./src/**/*.{astro,html,js,jsx,ts,tsx,md,mdx,svelte,vue}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['"Inter Variable"', 'Inter', 'system-ui', 'sans-serif'],
        display: ['"Space Grotesk Variable"', '"Space Grotesk"', 'system-ui', 'sans-serif'],
        mono: ['"JetBrains Mono Variable"', '"JetBrains Mono"', 'ui-monospace', 'monospace'],
      },
      colors: {
        mi: {
          50: '#f5f3ef',
          100: '#e8e4dc',
          200: '#cdc5b4',
          300: '#aa9e82',
          400: '#8c7c5d',
          500: '#726346',
          600: '#5a4e37',
          700: '#433b2b',
          800: '#2e281e',
          900: '#1c1913',
          950: '#0d0b08',
        },
        ink: {
          50: '#f6f7fb',
          100: '#eceef6',
          200: '#d4d8e8',
          300: '#a7aec8',
          400: '#717a9d',
          500: '#4f587a',
          600: '#3a4264',
          700: '#2b3350',
          800: '#1a2037',
          900: '#0e1222',
          950: '#05070f',
        },
      },
      animation: {
        'fade-up': 'fade-up 700ms ease-out both',
      },
      keyframes: {
        'fade-up': {
          from: { opacity: '0', transform: 'translateY(12px)' },
          to: { opacity: '1', transform: 'translateY(0)' },
        },
      },
    },
  },
  plugins: [],
};
