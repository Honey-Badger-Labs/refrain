/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // Nocturne: the same night palette as MelodyFlow, so the two Honey
        // Badger Labs apps read as siblings.
        night: {
          950: '#0d0f18',
          900: '#161826',
          800: '#1e2133',
          700: '#2a2e45',
          600: '#3a3f5c',
        },
        ember: {
          400: '#f0b357',
          500: '#e39a2f',
        },
        sage: {
          300: '#9fd0be',
          400: '#6fb89e',
        },
      },
      fontFamily: {
        sans: ['ui-sans-serif', 'system-ui', '-apple-system', 'Segoe UI', 'Roboto', 'sans-serif'],
        serif: ['ui-serif', 'Georgia', 'Cambria', 'Times New Roman', 'serif'],
      },
    },
  },
  plugins: [],
};
