export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
        slab: ['Zilla Slab', 'Georgia', 'serif'],
      },
      colors: {
        // Override white → Parchment throughout
        white: '#f6f2ea',
        // Remap neutral scale:
        //   950–700  → dark greens (backgrounds, surfaces, borders)
        //   600–500  → warm mid-tones (muted text, subtle UI)
        //   400–50   → leather → parchment (secondary → primary text)
        neutral: {
          950: '#080e0d',
          900: '#0f1f1d',
          800: '#172e2b',
          700: '#1e423f',
          600: '#7a6355',
          500: '#9a8070',
          400: '#c29b87',
          300: '#d4b4a0',
          200: '#e2cbbf',
          100: '#ede5db',
          50:  '#f6f2ea',
        },
        // Named palette tokens
        parchment: '#f6f2ea',
        leather:   '#c29b87',
        oak:       '#a97954',
        crimson: {
          DEFAULT: '#34000b',
          light:   '#6b1422',
        },
        binding:   '#532c2e',
      },
    },
  },
  plugins: [],
};
