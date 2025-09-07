import type { Config } from 'tailwindcss'

export default {
  darkMode: 'media',
  content: ['index.html', 'src/**/*.{ts,tsx}'],
  theme: {
    extend: {},
  },
  plugins: [require('tailwindcss-animate'), require('@tailwindcss/typography')],
} satisfies Config
