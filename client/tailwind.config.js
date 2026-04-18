export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
        slab: ['Zilla Slab', 'Georgia', 'serif'],
      },
      colors: {
        white: 'rgb(var(--color-parchment) / <alpha-value>)',
        neutral: {
          950: 'rgb(var(--bg-base))',
          900: 'rgb(var(--bg-deep))',
          800: 'rgb(var(--bg-surface))',
          700: 'rgb(var(--bg-manuscript))',
          600: 'rgb(var(--neutral-600) / <alpha-value>)',
          500: 'rgb(var(--neutral-500) / <alpha-value>)',
          400: 'rgb(var(--neutral-300) / <alpha-value>)',
          300: 'rgb(var(--neutral-200) / <alpha-value>)',
          200: 'rgb(var(--neutral-100) / <alpha-value>)',
          100: 'rgb(var(--color-parchment) / <alpha-value>)',
          50:  'rgb(var(--color-parchment) / <alpha-value>)',
        },
        parchment: 'rgb(var(--color-parchment) / <alpha-value>)',
        leather:   'rgb(var(--color-leather) / <alpha-value>)',
        oak:       'rgb(var(--color-oak) / <alpha-value>)',
        card:      'rgb(var(--bg-elev-1) / <alpha-value>)',
        base:      'rgb(var(--bg-base))',
        surface:   'rgb(var(--bg-surface))',
        crimson: {
          DEFAULT: 'rgb(var(--color-crimson) / <alpha-value>)',
          light:   'rgb(var(--color-crimson-light) / <alpha-value>)',
        },
        binding:   'rgb(var(--color-binding) / <alpha-value>)',
        warn:      'rgb(var(--color-warn) / <alpha-value>)',
      },
    },
  },
  plugins: [require('@tailwindcss/typography')],
};
