import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        ink: {
          950: '#0b0d10',
          900: '#12151a',
          800: '#1a1f27',
          700: '#242b35',
          600: '#2a313c',
        },
        brass: {
          400: '#e3b341',
          500: '#d4a017',
          600: '#b8860b',
        },
        forest: {
          400: '#5dce90',
          500: '#3dba7a',
        },
        rust: {
          400: '#f07a6c',
          500: '#e85d4c',
        },
        parchment: {
          100: '#e8e6e1',
          400: '#8b919a',
        },
      },
      fontFamily: {
        sans: ['var(--font-plex-sans)', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        mono: ['var(--font-plex-mono)', 'ui-monospace', 'SFMono-Regular', 'monospace'],
      },
      boxShadow: {
        panel: '0 0 0 1px rgba(212, 160, 23, 0.08)',
      },
    },
  },
  plugins: [],
};

export default config;
