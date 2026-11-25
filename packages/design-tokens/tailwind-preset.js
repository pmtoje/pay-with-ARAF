/** Shared Tailwind preset: maps design tokens (CSS variables) to utilities. */
const c = (name) => `rgb(var(--color-${name}) / <alpha-value>)`;
module.exports = {
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        bg: c('bg'),
        surface: c('surface'),
        'surface-2': c('surface-2'),
        border: c('border'),
        'border-strong': c('border-strong'),
        fg: c('text'),
        muted: c('text-muted'),
        subtle: c('text-subtle'),
        ink: c('ink'),
        'ink-contrast': c('ink-contrast'),
        gold: { DEFAULT: c('gold'), strong: c('gold-strong'), soft: c('gold-soft') },
        success: { DEFAULT: c('success'), soft: c('success-soft') },
        warning: { DEFAULT: c('warning'), soft: c('warning-soft') },
        danger: { DEFAULT: c('danger'), soft: c('danger-soft') },
        info: { DEFAULT: c('info'), soft: c('info-soft') },
        focus: c('focus'),
      },
      fontFamily: {
        sans: ['"Inter Variable"', 'Inter', 'ui-sans-serif', 'system-ui', '-apple-system', '"Segoe UI"', 'Roboto', 'Arial', 'sans-serif'],
        mono: ['ui-monospace', 'SFMono-Regular', 'Menlo', 'Consolas', 'monospace'],
      },
      borderRadius: { sm: 'var(--radius-sm)', md: 'var(--radius-md)', lg: 'var(--radius-lg)' },
      boxShadow: { sm: 'var(--shadow-sm)', md: 'var(--shadow-md)' },
      fontSize: { '2xs': ['0.6875rem', { lineHeight: '1rem' }] },
    },
  },
};
