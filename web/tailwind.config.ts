import type { Config } from 'tailwindcss'

export default {
  darkMode: false,
  content: ['index.html', 'src/**/*.{ts,tsx}'],
  theme: {
    extend: {},
  },
  plugins: [require('tailwindcss-animate'), require('@tailwindcss/typography')],
} satisfies Config
